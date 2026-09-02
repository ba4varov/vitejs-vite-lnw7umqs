import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createGeminiClient, GeminiServiceError } from './gemini-client.js'

const key = 'super-secret-test-key'
const model = (name, methods = ['generateContent'], description = 'Text model') => ({ name: `models/${name}`, supportedGenerationMethods: methods, description })
const response = (status, payload) => ({ ok: status >= 200 && status < 300, status, json: async () => payload })

function fakeClient(sequence, extraEnv = {}) {
  const calls = []; const logs = []
  const client = createGeminiClient({
    env: { GEMINI_API_KEY: key, ...extraEnv },
    fetchImpl: async (url, init) => { calls.push({ url, init }); return sequence.shift() },
    logger: (...args) => logs.push(args)
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

test('normalizes and uses an available configured GEMINI_MODEL', async () => {
  const { client } = fakeClient([response(200, { models: [model('gemini-2.0-flash'), model('gemini-2.5-flash')] })], { GEMINI_MODEL: ' models/gemini-2.0-flash ' })
  assert.equal(await client.resolveModel('test'), 'gemini-2.0-flash')
})

test('returns a controlled error for an unavailable configured model', async () => {
  const { client } = fakeClient([response(200, { models: [model('gemini-2.5-flash')] })], { GEMINI_MODEL: 'models/gemini-missing-flash' })
  await assert.rejects(client.resolveModel('test'), error => error instanceof GeminiServiceError && error.code === 'configured-model-unavailable')
})

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
  const [chat, advice] = await Promise.all([readFile(new URL('./weather-chat.ts', import.meta.url), 'utf8'), readFile(new URL('./weather-advice.ts', import.meta.url), 'utf8')])
  assert.match(chat, /import \{ geminiClient \} from '\.\/gemini-client\.js'/)
  assert.doesNotMatch(advice, /gemini|generativelanguage/i)
  assert.match(chat, /parseDeterministicQuestion\(input\.message.*\)[\s\S]+if \(!understood\) understood = await optionalGeminiUnderstanding/)
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
