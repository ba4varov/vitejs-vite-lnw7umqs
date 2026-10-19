import assert from 'node:assert/strict'
import test from 'node:test'
import { createGeminiClient, geminiClient } from '../../server/gemini-client.js'
import { handler, forecast } from '../helpers/weather-chat-harness.mjs'
import { simulateLatency } from '../helpers/gemini-latency-simulation.mjs'

for (const scenario of [
  { name: 'normal success', quotaMs: 1533, googleMs: 6000, elapsed: 7533, source: 'gemini' },
  { name: 'bounded late success', quotaMs: 1533, googleMs: 6800, elapsed: 8333, source: 'gemini' },
  { name: 'generation timeout fallback', quotaMs: 1533, googleMs: Infinity, elapsed: 8500, source: 'local' },
  { name: 'hanging body fallback', quotaMs: 1533, googleMs: 100, bodyMs: Infinity, elapsed: 8500, source: 'local' },
  { name: 'quota timeout fallback', quotaMs: 3100, googleMs: 100, elapsed: 3000, source: 'local' },
  { name: 'clear local bypass', quotaMs: 1533, googleMs: Infinity, elapsed: 0, source: 'local', local: true }
]) test(`real handler simulated latency: ${scenario.name}`, async t => {
  const previous = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'synthetic-key'
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous })
  const logs = [], weather = []
  t.mock.method(console, 'info', (...args) => logs.push(args))
  t.mock.method(globalThis, 'fetch', async url => {
    const parsed = new URL(url)
    assert.ok(parsed.hostname.endsWith('open-meteo.com'))
    weather.push(parsed)
    return { ok: true, json: async () => forecast }
  })
  let body
  const response = { status(code) { assert.equal(code, 200); return this }, json(value) { body = value } }
  const result = await simulateLatency(t.mock.timers, createGeminiClient, scenario, client => {
    t.mock.method(geminiClient, 'generate', client.generate)
    return handler({ method: 'POST', body: {
      message: scenario.local ? 'Ще вали ли утре?' : 'Можеш ли да ми кажеш дали ще вали утре?',
      city: 'София', latitude: 42.7, longitude: 23.3, lang: 'bg'
    } }, response)
  })
  assert.equal(result.elapsedMs, scenario.elapsed)
  assert.equal(body.intent, 'rain')
  assert.equal(body.targetDate, '2026-10-09')
  assert.equal(body.needsClarification, false)
  assert.equal(body.context.latitude, 42.7)
  assert.equal(body.context.longitude, 23.3)
  assert.ok(weather.length > 0)
  assert.ok(weather.every(url => url.searchParams.get('latitude') === '42.7' && url.searchParams.get('longitude') === '23.3'))
  const decision = logs.find(([prefix]) => prefix === '[weather-chat:decision]')[1]
  assert.equal(decision.source, scenario.source)
  assert.equal(logs.some(([prefix]) => prefix === '[weather-chat:gemini-response]'), scenario.source === 'gemini')
  assert.equal(result.quotaCalls, scenario.local ? 0 : 1)
  assert.equal(result.googleCalls, scenario.local || scenario.quotaMs >= 3000 ? 0 : 1)
  if (scenario.source === 'gemini') assert.ok(result.logs.every(([, data]) => data.requestId === decision.requestId || data.action === 'reserve'))
})
