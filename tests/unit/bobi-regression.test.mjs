import test from 'node:test'
import assert from 'node:assert/strict'
import { geminiClient } from '../../server/gemini-client.js'
import { parseSemanticUnderstanding } from '../../server/weather-chat-semantics.js'
import { invoke, forecast } from '../helpers/weather-chat-harness.mjs'
import { efficiencyCorpus } from '../helpers/gemini-efficiency-corpus.mjs'
import { edgeCorpus } from '../helpers/bobi-edge-corpus.mjs'
import { semanticFixture } from '../helpers/bobi-language-corpus.mjs'
import { checkOutcome, efficiencyExpected, efficiencySemantic, geminiResponse } from '../helpers/bobi-regression.mjs'

const cases = [
  ...efficiencyCorpus().map(item => ({ ...item, semantic: efficiencySemantic(item), expected: efficiencyExpected(item), geo: [item.place], aiCalls: item.local ? 0 : 1 })),
  ...edgeCorpus().map(item => ({ ...item, semantic: semanticFixture(item.semantic) }))
]
// Explicit debt list: independent desired labels remain unchanged. Strict mode
// turns these into blocking failures; ordinary runs keep visible Node TODOs.
const knownLocalFailures = new Map([
  [18, 'BG rain typo'], [19, 'BG clothing typo'], [20, 'BG walk typo'], [21, 'BG temperature typo'],
  [49, 'EN rain typo'], [51, 'EN walk typo'], [52, 'EN temperature typo'], [55, 'EN context clothing'],
  [64, 'BG contradictory dates'], [68, 'EN contradictory dates']
])
for (const [index, item] of cases.entries()) for (const mode of ['oracle', 'fallback']) test(`Bobi regression ${mode}/${item.lang}/${item.category}/${index}`, async t => {
  const previous = process.env.GEMINI_API_KEY
  if (mode === 'oracle') process.env.GEMINI_API_KEY = 'offline-fixture'
  else delete process.env.GEMINI_API_KEY
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous })
  const logs = []
  t.mock.method(console, 'info', (...args) => logs.push(args))
  assert.ok(parseSemanticUnderstanding(item.semantic, item.lang), 'fixture-contract: semantic schema')
  let calls = 0
  t.mock.method(geminiClient, 'generate', async () => { calls++; return geminiResponse(item.semantic) })
  const result = await invoke(t, item.message, item.lang, item.context ? { context: structuredClone(item.context) } : {}, forecast,
    new Date(Date.parse('2026-10-08T09:00:00Z') + index * 60000).toISOString(), structuredClone(item.geo))
  assert.equal(calls, mode === 'oracle' ? item.aiCalls : 0, 'Gemini decision')
  if (mode === 'oracle' && calls) assert.ok(logs.some(([prefix, data]) => prefix === '[weather-chat:understanding]' && data.reason === 'gemini_valid'), 'fixture-contract: accepted by production parser')
  const known = mode === 'fallback' && knownLocalFailures.get(index)
  try { checkOutcome(result, item.expected) }
  catch (error) {
    t.diagnostic(JSON.stringify({ kind: 'local-parser', expected: item.expected, actual: result.body }))
    if (known && !process.env.BOBI_STRICT_LOCAL) t.todo(`Known local parser defect: ${known}`)
    throw error
  }
  if (known) assert.fail(`Known defect fixed: remove debt entry ${index} and make this a permanent blocker`)
})

for (const kind of ['valid', 'missing-STOP', 'MAX_TOKENS', 'invalid-schema']) test(`Gemini fixture contract/${kind}`, async t => {
  const previous = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'offline-fixture'
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous })
  const logs = []
  t.mock.method(console, 'info', (...args) => logs.push(args))
  const response = geminiResponse(semanticFixture({ intent: 'rain', timeScope: 'tomorrow', timeSource: 'explicit' }))
  const candidate = response.payload.candidates[0]
  if (kind === 'missing-STOP') delete candidate.finishReason
  if (kind === 'MAX_TOKENS') candidate.finishReason = 'MAX_TOKENS'
  if (kind === 'invalid-schema') candidate.content.parts[0].text = JSON.stringify({ intent: 'rain' })
  let calls = 0
  t.mock.method(geminiClient, 'generate', async () => { calls++; return response })
  await invoke(t, 'Could you tell me will it rain tomorrow?', 'en', {}, forecast, '2026-10-10T12:00:00Z')
  assert.equal(calls, 1)
  const understanding = logs.filter(([prefix]) => prefix === '[weather-chat:understanding]').map(([, data]) => data.reason)
  assert.equal(understanding.includes('gemini_valid'), kind === 'valid', 'fallback must never masquerade as accepted fixture')
  const extraction = logs.find(([prefix]) => prefix === '[weather-chat:gemini-response]')[1]
  assert.equal(extraction.extractionReason, ['missing-STOP', 'MAX_TOKENS'].includes(kind) ? 'incomplete_or_blocked' : 'ok')
  if (kind === 'invalid-schema') assert.ok(understanding.includes('invalid_structure'))
})
