import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createGeminiClient, GeminiServiceError, GEMINI_BUDGET_MS } from '../../server/gemini-client.js'

const key = 'super-secret-test-key'
const model = (name, methods = ['generateContent'], description = 'Text model') => ({ name: `models/${name}`, supportedGenerationMethods: methods, description })
const response = (status, payload) => ({ ok: status >= 200 && status < 300, status, json: async () => payload })

function fakeClient(sequence, extraEnv = {}) {
  const calls = []; const logs = []
  const client = createGeminiClient({ quota: { reserve: async () => ({ allowed: true }), block: async () => {} },
    env: { GEMINI_API_KEY: key, ...extraEnv },
    fetchImpl: async (url, init) => { calls.push({ url, init }); const next = sequence.shift(); return typeof next === 'function' ? next(url, init) : next },
    logger: (...args) => { if (!args[0].endsWith(':gemini-usage]')) logs.push(args) }
  })
  return { client, calls, logs }
}

test('discovers and caches the newest regular stable Flash model', async () => {
  const { client, calls } = fakeClient([response(200, { models: [model('gemini-2.0-flash'), model('gemini-3.0-flash-lite'), model('gemini-2.5-flash')] })])
  assert.equal(await client.resolveModel('test'), 'gemini-2.5-flash')
  assert.equal(await client.resolveModel('test'), 'gemini-2.5-flash')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.headers['x-goog-api-key'], key)
  assert.ok(!calls[0].url.includes(key))
})

test('configured stable text model generates directly, normalized, and caches success', async () => {
  const { client, calls } = fakeClient([response(200, { candidates: [] }), response(200, { candidates: [] })], { GEMINI_MODEL: ' models/gemini-2.5-flash ' })
  for (let i = 0; i < 2; i++) assert.equal((await client.generate({ endpoint: 'weather-chat', stage: 'test', body: {} })).model, 'gemini-2.5-flash')
  assert.equal(calls.length, 2)
  assert.ok(calls.every(call => call.init.method === 'POST' && call.url.endsWith('gemini-2.5-flash:generateContent')))
})

for (const name of ['gemini-missing-flash', 'gemini-2.5-flash-preview', 'gemini-2.5-flash-image', 'gemini-2.5-flash/audio', 'https://private.example', '../gemini-2.5-pro']) {
  test(`incompatible or unsafe configured model fails before HTTP: ${name}`, async () => {
    const { client, calls } = fakeClient([], { GEMINI_MODEL: name })
    await assert.rejects(client.generate({ endpoint: 'weather-chat', stage: 'test', body: {} }), error => error instanceof GeminiServiceError && error.code === 'configured-model-unavailable')
    assert.equal(calls.length, 0)
  })
}

test('filters unsupported and non-text or preview-only models', async () => {
  const { client } = fakeClient([response(200, { models: [
    model('gemini-9.0-flash-preview'), model('gemini-8.0-flash-image'), model('gemini-7.0-flash', ['countTokens']),
    model('text-embedding-004'), model('gemini-2.0-flash')
  ] })])
  assert.equal(await client.resolveModel('test'), 'gemini-2.0-flash')
})

test('invalidates a 404 model, refreshes discovery, and retries exactly once', async () => {
  const { client, calls } = fakeClient([
    response(200, { models: [model('gemini-2.5-flash'), model('gemini-2.0-flash')] }),
    response(404, { error: { status: 'NOT_FOUND', message: 'gone' } }),
    response(200, { models: [model('gemini-2.5-flash'), model('gemini-2.0-flash')] }),
    response(200, { candidates: [] })
  ])
  const result = await client.generate({ endpoint: 'weather-chat', stage: 'gemini-understanding', body: { contents: [] } })
  assert.equal(result.model, 'gemini-2.0-flash')
  assert.equal(calls.length, 4)
  assert.match(calls[1].url, /gemini-2\.5-flash/)
  assert.match(calls[3].url, /gemini-2\.0-flash/)
})

test('returns a controlled error when discovery has no compatible model', async () => {
  const { client } = fakeClient([response(200, { models: [model('gemini-live-flash'), model('gemini-2.5-pro')] })])
  await assert.rejects(client.resolveModel('test'), error => error.code === 'no-compatible-model')
})

test('Gemini remains optional and weather advice is deterministic', async () => {
  const [chat, advice] = await Promise.all([readFile(new URL('../../api/weather-chat.ts', import.meta.url), 'utf8'), readFile(new URL('../../api/weather-advice.ts', import.meta.url), 'utf8')])
  assert.match(chat, /import \{ geminiClient \} from '\.\.\/server\/gemini-client\.js'/)
  assert.doesNotMatch(advice, /gemini|generativelanguage/i)
  assert.match(chat, /await optionalGeminiUnderstanding\(input, requestId\)[\s\S]+ai \? resolveSemanticTurn[\s\S]+semanticTurn \?\? clarificationTurn/)
  assert.doesNotMatch(`${chat}\n${advice}`, /models\/gemini-[^'"`]+:generateContent/)
})

test('secrets never appear in diagnostics or thrown errors', async () => {
  const { client, logs } = fakeClient([
    response(200, { models: [model('gemini-2.5-flash')] }),
    response(500, { error: { status: 'INTERNAL', message: `failure key=${key}\nfull details` } })
  ])
  let thrown
  try { await client.generate({ endpoint: 'weather-advice', stage: 'gemini-advice', body: { secretPrompt: key } }) } catch (error) { thrown = error }
  assert.equal(thrown.code, 'upstream-http')
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(key))
  assert.doesNotMatch(JSON.stringify({ error: 'AI service is unavailable' }), new RegExp(key))
})

test('Gemini diagnostics omit untrusted model/status/prose even when they contain personal data', async () => {
  const { client, logs } = fakeClient([
    response(200, { models: [model('gemini-2.5-flash')] }),
    response(500, { error: { status: 'PERSONAL_STATUS', message: 'User Jane at 42.14, 24.75' } })
  ])
  await assert.rejects(client.generate({ endpoint: 'weather-chat', stage: 'gemini-understanding', body: { message: 'PRIVATE_PROMPT' } }))
  assert.deepEqual(logs.at(-1), ['[weather-chat]', { endpoint: 'weather-chat', stage: 'gemini-understanding', status: 500, code: 'upstream-http' }])
  assert.deepEqual(logs.slice(0, 2).map(([, data]) => [data.phase, data.code]), [['discovery', 'ok'], ['generation', 'upstream-http']])
  for (const [, data] of logs.slice(0, 2)) assert.ok(Number.isInteger(data.durationMs) && data.durationMs >= 0)
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_PROMPT|PERSONAL_STATUS|Jane|42\.14|24\.75|gemini-2\.5|super-secret/)
})

const generate = client => client.generate({ endpoint: 'weather-chat', stage: 'test', body: {}, requestId: 'trace-id' })
const models = response(200, { models: [model('gemini-2.5-flash'), model('gemini-2.0-flash')] })
const ok = response(200, { candidates: [] })
const missing = response(404, { error: { status: 'NOT_FOUND' } })

// Advance simulated latency, including asynchronous fetch/body continuations.
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const advance = async (t, ms) => { t.mock.timers.tick(ms); await flush() }
const delayed = (ms, value) => (_url, { signal }) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(value), ms)
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
})
function timedClient(t, sequence, extraEnv = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const calls = []; const logs = []
  const client = createGeminiClient({ quota: { reserve: async () => ({ allowed: true }), block: async () => {} },
    env: { GEMINI_API_KEY: key, ...extraEnv }, now: () => Date.now(), logger: (...args) => { if (!args[0].endsWith(':gemini-usage]')) logs.push(args) },
    fetchImpl: async (url, init) => { calls.push({ url, init }); const next = sequence.shift(); return typeof next === 'function' ? next(url, init) : next }
  })
  return { client, calls, logs }
}

test('direct generation may take 6 seconds without the old 5-second timeout', async t => {
  const { client, calls, logs } = timedClient(t, [delayed(6000, ok)], { GEMINI_MODEL: 'gemini-2.5-flash' })
  const result = generate(client)
  await flush(); await advance(t, 6000)
  assert.equal((await result).model, 'gemini-2.5-flash')
  assert.equal(calls.length, 1)
  assert.deepEqual(logs.map(([, data]) => [data.phase, data.durationMs, data.code, data.requestId]), [['generation', 6000, 'ok', 'trace-id']])
})

test('cold discovery 1 second plus generation 6 seconds succeeds within the 8-second budget', async t => {
  const { client, calls, logs } = timedClient(t, [delayed(1000, models), delayed(6000, ok)])
  const result = generate(client)
  await flush(); await advance(t, 1000); await advance(t, 6000)
  assert.equal((await result).model, 'gemini-2.5-flash')
  assert.deepEqual(logs.map(([, data]) => [data.phase, data.durationMs, data.code]), [['discovery', 1000, 'ok'], ['generation', 6000, 'ok']])
  assert.equal(calls.length, 2)
})

test('slow discovery is aborted at 1.5 seconds and never attempts generation', async t => {
  const { client, calls, logs } = timedClient(t, [delayed(4000, models)])
  const result = assert.rejects(generate(client), error => error.code === 'timeout' && !error.httpStatus)
  await flush(); await advance(t, GEMINI_BUDGET_MS.discovery); await result
  assert.equal(calls.length, 1)
  assert.ok(calls[0].init.signal.aborted)
  assert.deepEqual([logs[0][1].phase, logs[0][1].durationMs, logs[0][1].code], ['discovery', 1500, 'timeout'])
})

test('slow generation is aborted at 6.5 seconds without retry', async t => {
  const { client, calls, logs } = timedClient(t, [models, delayed(9000, ok)])
  const result = assert.rejects(generate(client), error => error.code === 'timeout' && !error.httpStatus)
  await flush(); await advance(t, GEMINI_BUDGET_MS.generation); await result
  assert.equal(calls.length, 2)
  assert.ok(calls[1].init.signal.aborted)
  assert.equal(logs[1][1].durationMs, 6500)
  assert.equal(logs[1][1].phase, 'generation')
})

test('404 recovery shares the total deadline instead of resetting the budget', async t => {
  const { client, calls, logs } = timedClient(t, [delayed(5000, missing), delayed(1000, models), delayed(4000, ok)], { GEMINI_MODEL: 'gemini-2.5-flash' })
  const result = assert.rejects(generate(client), error => error.code === 'timeout')
  await flush(); await advance(t, 5000); await advance(t, 1000); await advance(t, 2000); await result
  assert.equal(calls.length, 3)
  assert.ok(calls[2].init.signal.aborted)
  assert.deepEqual(logs.slice(0, 3).map(([, data]) => [data.phase, data.durationMs, data.code]), [['generation', 5000, 'upstream-http'], ['discovery', 1000, 'ok'], ['generation', 2000, 'timeout']])
})

for (const status of [200, 401]) test(`deadline includes hanging HTTP ${status} response body`, async t => {
  const { calls } = timedClient(t, [response(status, {})], { GEMINI_MODEL: 'gemini-2.5-flash' })
  // Even a faulty transport/body that never settles cannot hang the handler.
  const hanging = new Promise(() => {})
  const custom = createGeminiClient({ quota: { reserve: async () => ({ allowed: true }), block: async () => {} }, env: { GEMINI_API_KEY: key, GEMINI_MODEL: 'gemini-2.5-flash' }, logger: () => {}, fetchImpl: async (url, init) => { calls.push({ url, init }); return { ...response(status, {}), json: () => hanging } } })
  const result = assert.rejects(generate(custom), error => error.code === 'timeout' && !error.httpStatus)
  await flush(); await advance(t, 6500); await result
  assert.ok(calls[0].init.signal.aborted)
})

test('configured missing model discovers a compatible replacement once and caches it', async () => {
  const { client, calls } = fakeClient([missing, models, ok, ok], { GEMINI_MODEL: 'gemini-9.0-flash' })
  assert.equal((await generate(client)).model, 'gemini-2.5-flash')
  await generate(client)
  assert.deepEqual(calls.map(call => call.init.method), ['POST', 'GET', 'POST', 'POST'])
  assert.match(calls[2].url, /gemini-2\.5-flash/)
  assert.match(calls[3].url, /gemini-2\.5-flash/)
})

test('second generation 404 ends recovery without further calls', async () => {
  const { client, calls } = fakeClient([missing, models, missing], { GEMINI_MODEL: 'gemini-2.5-flash' })
  await assert.rejects(generate(client), error => error.code === 'upstream-http' && error.httpStatus === 404)
  assert.equal(calls.length, 3)
})

for (const phase of ['discovery', 'generation']) for (const status of [400, 401, 403, 429, 500]) {
  test(`${phase} HTTP ${status} preserves status and never retries`, async () => {
    const { client, calls, logs } = fakeClient([response(status, { error: { status: 'PRIVATE', message: key } })], phase === 'generation' ? { GEMINI_MODEL: 'gemini-2.5-flash' } : {})
    await assert.rejects(generate(client), error => error.code === (phase === 'generation' || status === 429 ? 'upstream-http' : 'models-list-failed') && error.httpStatus === status)
    assert.equal(calls.length, 1)
    assert.equal(logs[0][1].phase, phase)
    assert.equal(logs[0][1].status, status)
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|super-secret/)
  })
}

for (const phase of ['discovery', 'generation']) test(`${phase} network failure has no invented authentication status`, async () => {
  const { client, calls } = fakeClient([() => { throw new Error('private socket data') }], phase === 'generation' ? { GEMINI_MODEL: 'gemini-2.5-flash' } : {})
  await assert.rejects(generate(client), error => error.code === (phase === 'generation' ? 'network-error' : 'models-list-failed') && error.httpStatus === undefined)
  assert.equal(calls.length, 1)
})

test('missing key makes no network request', async () => {
  const { client, calls } = fakeClient([], { GEMINI_API_KEY: '' })
  await assert.rejects(generate(client), error => error.code === 'missing-configuration')
  assert.equal(calls.length, 0)
})
