import assert from 'node:assert/strict'
import test from 'node:test'
import { createGeminiClient, geminiClient, GEMINI_BUDGET_MS } from '../../server/gemini-client.js'
import { handler, forecast } from '../helpers/weather-chat-harness.mjs'
import { semanticFixture } from '../helpers/bobi-language-corpus.mjs'

let minute = 0
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const advance = async (t, ms) => { t.mock.timers.tick(ms); await flush() }
const value = semanticFixture({ intent: 'rain', timeScope: 'tomorrow', timeSource: 'explicit' })
const success = () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] })

function setup(t, fetchImpl, configured = true) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2026-10-08T09:00:00Z') + minute++ * 60000 })
  const previous = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'private-test-key'
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous })
  const logs = [], calls = [], weatherCalls = []
  t.mock.method(console, 'info', (...args) => logs.push(args))
  const client = createGeminiClient({ quota: { reserve: async () => ({ allowed: true }), block: async () => {} },
    env: { GEMINI_API_KEY: 'private-test-key', ...(configured ? { GEMINI_MODEL: 'gemini-2.5-flash' } : {}) },
    now: () => Date.now(), logger: (...args) => logs.push(args),
    fetchImpl: async (url, init) => { calls.push({ url, init }); return fetchImpl(url, init) }
  })
  t.mock.method(geminiClient, 'generate', client.generate)
  t.mock.method(globalThis, 'fetch', async url => { weatherCalls.push(new URL(url)); return Response.json(forecast) })
  let body
  const response = { status(code) { assert.equal(code, 200); return this }, json(value) { body = value } }
  const run = () => handler({ method: 'POST', body: { message: 'Можеш ли да ми кажеш дали ще вали утре?', city: 'София', latitude: 42.7, longitude: 23.3, lang: 'bg' } }, response)
  const check = (source, reason) => {
    assert.equal(body.intent, 'rain')
    assert.equal(body.targetDate, '2026-10-09')
    assert.equal(body.needsClarification, false)
    const result = logs.find(([prefix, entry]) => prefix === '[weather-chat:understanding]' && entry.phase === 'result')[1]
    assert.equal(result.reason, reason)
    const decision = logs.find(([prefix]) => prefix === '[weather-chat:decision]')[1]
    assert.equal(decision.source, source)
    assert.equal(decision.outcome, 'answer')
    assert.ok(logs.every(([, entry]) => entry.requestId === decision.requestId))
    assert.match(decision.requestId, /^[0-9a-f-]{36}$/)
    assert.ok(weatherCalls.length > 0 && weatherCalls.every(url => url.hostname.endsWith('open-meteo.com')))
    assert.doesNotMatch(JSON.stringify(logs), /private|Ще вали|София|latitude|longitude|42\.7|23\.3|gemini-2\.5/)
  }
  return { run, check, calls, logs }
}

test('real handler uses Gemini after six-second direct generation, with correlated stage timing', async t => {
  const { run, check, calls, logs } = setup(t, async () => new Promise(resolve => setTimeout(() => resolve(success()), 6000)))
  const pending = run()
  await flush(); await advance(t, 6000); await pending
  check('gemini', 'gemini_valid')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.method, 'POST')
  const stage = logs.find(([prefix]) => prefix === '[weather-chat:gemini-stage]')[1]
  assert.deepEqual([stage.phase, stage.durationMs, stage.code], ['generation', 6000, 'ok'])
})

for (const phase of ['discovery', 'generation']) test(`real handler falls back after slow ${phase}`, async t => {
  const { run, check, calls, logs } = setup(t, async () => new Promise(() => {}), phase === 'generation')
  const pending = run()
  await flush(); await advance(t, GEMINI_BUDGET_MS[phase]); await pending
  check('local', 'timeout')
  assert.equal(calls.length, 1)
  assert.ok(calls[0].init.signal.aborted)
  const stage = logs.find(([prefix]) => prefix === '[weather-chat:gemini-stage]')[1]
  assert.deepEqual([stage.phase, stage.durationMs, stage.code], [phase, GEMINI_BUDGET_MS[phase], 'timeout'])
})

for (const phase of ['discovery', 'generation']) for (const [status, reason] of [[400, phase === 'discovery' ? 'discovery_failed' : 'upstream_http'], [401, 'authentication'], [403, 'permission'], [429, 'quota'], [500, phase === 'discovery' ? 'discovery_failed' : 'upstream_http']]) {
  test(`real handler ${phase} HTTP ${status} has accurate fallback reason`, async t => {
    const { run, check, calls } = setup(t, async () => Response.json({ error: { message: 'private-test-key private user data' } }, { status }), phase === 'generation')
    await run()
    check('local', reason)
    assert.equal(calls.length, 1)
  })
}

test('real handler falls back when 404 recovery has no available model', async t => {
  const { run, check, calls } = setup(t, async (_url, init) => init.method === 'POST' ? Response.json({}, { status: 404 }) : Response.json({ models: [] }))
  await run()
  check('local', 'model_unavailable')
  assert.deepEqual(calls.map(call => call.init.method), ['POST', 'GET'])
})

const envelope = (parts, finishReason = 'STOP', extra = {}) => ({ candidates: [{ finishReason, content: { parts } }], ...extra })
for (const [name, payload, source, reason, extraction] of [
  ['MAX_TOKENS with valid JSON', envelope([{ text: JSON.stringify(value) }], 'MAX_TOKENS'), 'local', 'invalid_json', 'incomplete_or_blocked'],
  ['MAX_TOKENS with partial JSON', envelope([{ text: '{"intent":' }], 'MAX_TOKENS'), 'local', 'invalid_json', 'incomplete_or_blocked'],
  ['missing finish reason', { candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }, 'local', 'invalid_json', 'incomplete_or_blocked'],
  ['empty response', {}, 'local', 'invalid_json', 'missing_candidate'],
  ['empty parts', envelope([]), 'local', 'invalid_json', 'missing_text'],
  ['thought only', envelope([{ thought: true, text: 'private thought' }]), 'local', 'invalid_json', 'missing_text'],
  ['multiple text parts', envelope([{ thought: true, text: 'private thought' }, { text: JSON.stringify(value).slice(0, 40) }, { text: JSON.stringify(value).slice(40) }]), 'gemini', 'gemini_valid', 'ok'],
  ['nontext first part', envelope([{ thoughtSignature: 'private signature' }, { text: JSON.stringify(value) }]), 'gemini', 'gemini_valid', 'ok'],
  ['invalid JSON', envelope([{ text: '{broken' }]), 'local', 'invalid_json', 'malformed_json'],
  ['two JSON objects', envelope([{ text: JSON.stringify(value) }, { text: JSON.stringify(value) }]), 'local', 'invalid_json', 'malformed_json'],
  ['safety termination', envelope([{ text: JSON.stringify(value) }], 'SAFETY'), 'local', 'invalid_json', 'incomplete_or_blocked'],
  ['valid structured interpretation', envelope([{ text: JSON.stringify(value) }]), 'gemini', 'gemini_valid', 'ok'],
  ['invalid semantics', envelope([{ text: JSON.stringify({ ...value, intent: 'invented' }) }]), 'local', 'invalid_structure', 'ok'],
  ['unknown finish reason', envelope([{ text: JSON.stringify(value) }], 'private finish'), 'local', 'invalid_json', 'incomplete_or_blocked'],
  ['null JSON', envelope([{ text: 'null' }]), 'local', 'invalid_json', 'ok'],
]) test(`Gemini response: ${name}`, async t => {
  const { run, check, calls, logs } = setup(t, async () => Response.json(payload))
  await run()
  check(source, reason)
  assert.equal(calls.length, 1, 'no generation retry on invalid output')
  const diagnostic = logs.find(([prefix]) => prefix === '[weather-chat:gemini-response]')[1]
  assert.equal(diagnostic.extractionReason, extraction)
  assert.equal(diagnostic.textPartCount, payload.candidates?.[0].content.parts.filter(part => typeof part.text === 'string' && part.thought !== true).length ?? 0)
  assert.equal(diagnostic.outputTokens, null)
  assert.equal(diagnostic.thoughtTokens, null)
  const config = JSON.parse(calls[0].init.body).generationConfig
  assert.equal(config.maxOutputTokens, 1024)
  assert.deepEqual(config.thinkingConfig, { thinkingBudget: 0 })
  assert.equal(config.responseMimeType, 'application/json')
  assert.ok(config.responseSchema)
})

test('safe diagnostics expose Google token counts without payload fields', async t => {
  const payload = envelope([{ text: JSON.stringify(value) }], 'STOP', {
    usageMetadata: { candidatesTokenCount: 145, thoughtsTokenCount: 320, promptTokenCount: 900 },
    promptFeedback: { blockReasonMessage: 'private user data' }
  })
  const { run, check, logs } = setup(t, async () => Response.json(payload))
  await run(); check('gemini', 'gemini_valid')
  const diagnostic = logs.find(([prefix]) => prefix === '[weather-chat:gemini-response]')[1]
  assert.equal(diagnostic.outputTokens, 145)
  assert.equal(diagnostic.thoughtTokens, 320)
  assert.deepEqual(Object.keys(diagnostic).sort(), ['requestId', 'finishReason', 'candidateCount', 'partCount', 'textPartCount', 'hasText', 'outputTokens', 'thoughtTokens', 'extractionReason'].sort())
})

test('HTTP 200 with malformed outer response falls back without retry', async t => {
  const { run, check, calls } = setup(t, async () => new Response('broken', { status: 200 }))
  await run(); check('local', 'invalid_json')
  assert.equal(calls.length, 1)
})
