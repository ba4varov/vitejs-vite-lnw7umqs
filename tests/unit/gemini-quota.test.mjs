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
  t.mock.timers.tick(3000)
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

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
for (const phase of ['headers', 'body']) test(`RPC accepts a 1500ms ${phase} delay beyond the old deadline`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let rpcSignal, calls = 0
  const logs = []
  const guard = createGeminiQuota({ env, logger: (_, data) => logs.push(data), fetchImpl: async (_url, init) => {
    calls++; rpcSignal = init.signal
    const delay = () => new Promise(resolve => setTimeout(resolve, 1500))
    if (phase === 'headers') await delay()
    return { ok: true, status: 200, json: async () => { if (phase === 'body') await delay(); return { allowed: true, reason: 'reserved' } } }
  } })
  const pending = guard.reserve()
  await flush()
  t.mock.timers.tick(1000); await flush()
  assert.equal(logs.length, 0)
  t.mock.timers.tick(500)
  assert.deepEqual(await pending, { allowed: true, reason: 'reserved' })
  assert.equal(calls, 1)
  assert.equal(rpcSignal.aborted, false)
  assert.equal(logs[0].code, 'reserved')
  t.mock.timers.tick(3000)
  assert.equal(rpcSignal.aborted, false, 'deadline cleared after success')
})

for (const phase of ['headers', 'body']) test(`RPC timeout aborts ${phase}, never retries, and ignores late success`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let rpcSignal, complete, calls = 0
  const logs = []
  const guard = createGeminiQuota({ env, logger: (_, data) => logs.push(data), fetchImpl: async (_url, init) => {
    calls++; rpcSignal = init.signal
    const pending = new Promise(resolve => { complete = resolve })
    return phase === 'headers' ? pending : { ok: true, status: 200, json: () => pending }
  } })
  const result = guard.reserve(); await flush()
  t.mock.timers.tick(3000)
  assert.deepEqual(await result, { allowed: false, reason: 'quota_unavailable' })
  assert.equal(rpcSignal.aborted, true)
  assert.equal(logs[0].code, 'timeout')
  assert.equal(logs[0].status, phase === 'headers' ? null : 200)
  complete(phase === 'headers' ? Response.json({ allowed: true, reason: 'reserved' }) : { allowed: true, reason: 'reserved' })
  await flush()
  assert.equal(calls, 1)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].code, 'timeout')
})

for (const status of [401, 403, 404, 429, 500, 503]) test(`RPC logs HTTP ${status} without reading error body`, async () => {
  const logs = []
  let reads = 0
  const guard = createGeminiQuota({ env, logger: (_, data) => logs.push(data), fetchImpl: async () => ({ ok: false, status, json: () => { reads++; throw Error('secret') } }) })
  assert.deepEqual(await guard.reserve(), { allowed: false, reason: 'quota_unavailable' })
  assert.equal(reads, 0)
  assert.equal(logs[0].status, status)
  assert.equal(logs[0].code, 'http_error')
  assert.ok(logs[0].durationMs >= 0)
})

for (const type of ['json', 'shape', 'network', 'body-network']) test(`RPC safely distinguishes ${type}`, async () => {
  const logs = []
  const guard = createGeminiQuota({ env, logger: (...args) => logs.push(args), fetchImpl: async () => {
    if (type === 'network') throw Error('https://private.example?token=private-service-key')
    if (type === 'body-network') return { ok: true, status: 200, json: async () => { throw TypeError('private message') } }
    return type === 'json' ? new Response('private invalid JSON', { status: 200 }) : Response.json({ allowed: true, reason: 'wrong', message: 'private' })
  } })
  assert.equal((await guard.reserve()).allowed, false)
  assert.equal(logs[0][1].code, type.includes('network') ? 'network_error' : 'invalid_response')
  assert.doesNotMatch(JSON.stringify(logs), /private|token|https|message/)
})

for (const extra of [{ SUPABASE_URL: '' }, { SUPABASE_URL: 'https://user:secret@example.com?token=secret' }, { SUPABASE_SERVICE_ROLE_KEY: '' }, { GEMINI_DAILY_REQUEST_LIMIT: 'invalid' }]) test(`RPC configuration fails closed: ${Object.keys(extra)[0]}`, async () => {
  const logs = []
  const guard = createGeminiQuota({ env: { ...env, ...extra }, logger: (_, data) => logs.push(data), fetchImpl: () => assert.fail('invalid configuration contacted Supabase') })
  assert.equal((await guard.reserve()).allowed, false)
  assert.equal(logs[0].code, 'configuration_error')
  assert.doesNotMatch(JSON.stringify(logs), /secret|example|invalid.*token/)
})

test('parent cancellation interrupts body and clears listeners/deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const parent = new AbortController(), logs = []
  let signal
  const guard = createGeminiQuota({ env, logger: (_, data) => logs.push(data), fetchImpl: async (_url, init) => {
    signal = init.signal; return { ok: true, status: 200, json: () => new Promise(() => {}) }
  } })
  const pending = guard.reserve(parent.signal); await flush(); parent.abort('private reason')
  assert.equal((await pending).allowed, false)
  assert.equal(signal.aborted, true)
  assert.equal(logs[0].code, 'aborted')
  t.mock.timers.tick(3000)
  assert.equal(logs.length, 1)
})
