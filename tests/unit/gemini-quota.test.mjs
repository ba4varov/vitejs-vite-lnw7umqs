import assert from 'node:assert/strict'
import test from 'node:test'
import { createGeminiClient } from '../../server/gemini-client.js'
import { createGeminiQuota } from '../../server/gemini-quota.js'

const env = { GEMINI_API_KEY: 'private-key', GEMINI_MODEL: 'gemini-2.5-flash', SUPABASE_URL: 'https://quota.example', SUPABASE_SERVICE_ROLE_KEY: 'private-service-key' }
const generate = client => client.generate({ endpoint: 'weather-chat', stage: 'understanding', body: { contents: [{ text: 'private personal message' }] }, requestId: 'trace' })
const make = options => createGeminiClient({ logger: () => {}, env, ...options })

test('missing shared quota configuration fails closed before any Google request', async () => {
  let calls = 0
  const client = make({ env: { GEMINI_API_KEY: env.GEMINI_API_KEY }, fetchImpl: async () => { calls++; assert.fail() } })
  await assert.rejects(generate(client), { code: 'quota_unavailable' })
  assert.equal(calls, 0)
})

test('separate cold clients share the cap, rather than each receiving a daily allowance', async () => {
  let used = 0, googleCalls = 0
  const requests = []
  const fetchImpl = async (url, init) => {
    if (url.startsWith(env.SUPABASE_URL)) {
      requests.push(JSON.parse(init.body))
      return Response.json(++used <= 20 ? { allowed: true, reason: 'reserved' } : { allowed: false, reason: 'daily_limit' })
    }
    googleCalls++; return Response.json({ candidates: [] })
  }
  const clients = Array.from({ length: 40 }, () => make({ fetchImpl }))
  const results = await Promise.allSettled(clients.map(generate))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 20)
  assert.equal(googleCalls, 20)
  assert.ok(requests.every(p => JSON.stringify(p) === '{"action":"reserve","daily_limit":20}'))
  assert.doesNotMatch(JSON.stringify(requests), /private|message|contents|trace/)
})

for (const phase of ['discovery', 'generation']) test(`HTTP 429 in ${phase} skips the body, retries and other instances`, async () => {
  let blocked = false, googleCalls = 0, bodyReads = 0
  const fetchImpl = async (url, init) => {
    if (url.startsWith(env.SUPABASE_URL)) {
      const p = JSON.parse(init.body)
      if (p.action === 'block') blocked = true
      return Response.json({ allowed: !blocked, reason: blocked ? 'cooldown' : 'reserved' })
    }
    googleCalls++
    return { status: 429, ok: false, json() { bodyReads++; return new Promise(() => {}) } }
  }
  const client = make({ env: { ...env, GEMINI_MODEL: phase === 'discovery' ? '' : env.GEMINI_MODEL }, fetchImpl })
  await assert.rejects(generate(client), { httpStatus: 429 })
  await assert.rejects(generate(client), { code: 'cooldown' })
  await assert.rejects(generate(make({ fetchImpl })), { code: 'cooldown' })
  assert.equal(googleCalls, 1)
  assert.equal(bodyReads, 0)
})

test('local 429 breaker survives a failed shared block and resets at Pacific day rollover', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-18T06:59:00Z') })
  let calls = 0
  const client = make({ quota: { reserve: async () => ({ allowed: true }), block: async () => { throw new Error('offline') } }, fetchImpl: async () => { calls++; return calls === 1 ? new Response(null, { status: 429 }) : Response.json({}) } })
  await assert.rejects(generate(client), { httpStatus: 429 })
  client.invalidate() // Clearing model discovery cannot clear a quota breaker.
  await assert.rejects(generate(client), { code: 'cooldown' })
  t.mock.timers.tick(60000) // Midnight PDT, not midnight UTC/Sofia.
  await generate(client)
  assert.equal(calls, 2)
})

test('disabled AI, zero allowance, quota failure and malformed payloads never call Google', async () => {
  for (const extra of [{ GEMINI_DISABLED: 'true' }, { GEMINI_DAILY_REQUEST_LIMIT: '0' }, { GEMINI_DAILY_REQUEST_LIMIT: '-1' }, {}]) {
    let calls = 0
    const client = make({ env: { ...env, ...extra }, fetchImpl: async (url, init) => {
      assert.ok(url.startsWith(env.SUPABASE_URL)); calls++
      assert.equal(init.headers.Authorization, 'Bearer private-service-key')
      return extra.GEMINI_DAILY_REQUEST_LIMIT === '0' ? Response.json({ allowed: false, reason: 'daily_limit' }) : Response.json({ private: 'not a quota response' })
    } })
    await assert.rejects(generate(client), e => ['quota_unavailable', 'daily_limit', 'ai_disabled'].includes(e.code))
    assert.ok(calls <= 1)
  }
})

for (const failure of ['http', 'network', 'body']) test(`quota ${failure} error is private and fails closed`, async () => {
  const logs = []
  const client = make({ logger: (...args) => logs.push(args), fetchImpl: async url => {
    assert.ok(url.startsWith(env.SUPABASE_URL))
    if (failure === 'network') throw new Error('private-service-key')
    return failure === 'http' ? new Response(null, { status: 503 }) : { ok: true, json: async () => { throw new Error('private-key') } }
  } })
  await assert.rejects(generate(client), { code: 'quota_unavailable' })
  assert.ok(logs.some(([, data]) => data.savedGeminiCalls === 1 && data.geminiCalls === 0))
  assert.doesNotMatch(JSON.stringify(logs), /private|quota.example|message|contents/)
})

test('quota response body is bounded even if a transport ignores cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const guard = createGeminiQuota({ env, fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }) })
  const result = guard.reserve()
  for (let i = 0; i < 10; i++) await Promise.resolve()
  t.mock.timers.tick(1000)
  assert.deepEqual(await result, { allowed: false, reason: 'quota_unavailable' })
})

test('404 recovery reserves a second call; quota denial prevents replacement generation', async () => {
  let used = 0, calls = 0
  const quota = { reserve: async () => ({ allowed: ++used === 1, reason: used === 1 ? 'reserved' : 'daily_limit' }), block: async () => {} }
  const client = make({ quota, fetchImpl: async (_url, init) => {
    calls++
    return init.method === 'POST' ? new Response(null, { status: 404 }) : Response.json({ models: [{ name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] }] })
  } })
  await assert.rejects(generate(client), { code: 'daily_limit' })
  assert.equal(calls, 2)
  assert.equal(used, 2)
})
