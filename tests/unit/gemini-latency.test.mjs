import assert from 'node:assert/strict'
import test from 'node:test'
import { createGeminiClient } from '../../server/gemini-client.js'
import { latencyCases, simulateLatency } from '../helpers/gemini-latency-simulation.mjs'

for (const scenario of latencyCases) test(`latency budget: ${scenario.name}`, async t => {
  const result = await simulateLatency(t.mock.timers, createGeminiClient, scenario)
  const preparation = scenario.quotaMs + (scenario.quotaBodyMs ?? 0) + (scenario.discoveryMs ?? 0)
  const duration = preparation + scenario.googleMs + (scenario.bodyMs ?? 0)
  const quotaTimeout = scenario.quotaMs + (scenario.quotaBodyMs ?? 0) >= 3000
  const discoveryTimeout = (scenario.discoveryMs ?? 0) >= 1500
  const success = !quotaTimeout && !discoveryTimeout && duration < 8500 && scenario.googleMs + (scenario.bodyMs ?? 0) < 7000
  assert.equal(result.outcome, quotaTimeout ? 'quota_unavailable' : success ? 'ok' : 'timeout')
  const expectedTime = quotaTimeout ? 3000 : discoveryTimeout ? scenario.quotaMs + 1500 : Math.min(duration, preparation + 7000, 8500)
  assert.equal(result.elapsedMs, expectedTime)
  assert.equal(result.quotaCalls, 1)
  assert.equal(result.googleCalls, quotaTimeout || discoveryTimeout ? 0 : 1)
  if (result.outcome === 'timeout') assert.ok(result.calls.at(-1).signal.aborted)
  if (!quotaTimeout && !discoveryTimeout) {
    const stage = result.logs.find(([prefix, data]) => prefix.endsWith(':gemini-stage]') && data.phase === 'generation')[1]
    assert.equal(stage.preparationMs, preparation)
    assert.equal(stage.availableMs, Math.min(7000, 8500 - preparation))
    assert.equal(stage.totalDurationMs, result.elapsedMs)
    if (!success) assert.equal(stage.timeoutSource, preparation + 7000 < 8500 ? 'stage' : 'total')
  }
  assert.doesNotMatch(JSON.stringify(result.logs), /synthetic-key|synthetic-service-key|quota.example|latitude|longitude|message|contents/)
})
