// Offline comparison against the immutable main commit containing PR #107.
// No real quota/Google/Open-Meteo calls. Run: node scripts/measure-bobi-gemini-latency.mjs
import { execFileSync } from 'node:child_process'
import { mock } from 'node:test'
import { createGeminiClient } from '../server/gemini-client.js'
import { semanticInput, semanticSystem, semanticSchema } from '../server/weather-chat-semantics.js'
import { latencyCases, simulateLatency } from '../tests/helpers/gemini-latency-simulation.mjs'
const baseline = 'a5899090120c361ec1150d884c85c81fa1d29132'
const baselineModule = async (path, relative, target) => {
  const source = execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' })
    .replace(relative, new URL(target, import.meta.url).href)
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}
const previous = await baselineModule('server/gemini-client.js', './gemini-quota.js', '../server/gemini-quota.js')
const oldSemantics = await baselineModule('server/weather-chat-semantics.js', './weather-chat-core.js', '../server/weather-chat-core.js')
const results = []
for (const scenario of latencyCases) {
  const row = { scenario: scenario.name }
  for (const [name, create] of [['before', previous.createGeminiClient], ['after', createGeminiClient]]) {
    try {
      const value = await simulateLatency(mock.timers, create, scenario)
      row[name] = { outcome: value.outcome, elapsedMs: value.elapsedMs, quotaCalls: value.quotaCalls, googleCalls: value.googleCalls }
    } finally { mock.timers.reset() }
  }
  results.push(row)
}
const context = { city: 'Varna', latitude: 43.2, longitude: 27.9, intent: 'rain', timeScope: 'tomorrow', targetDate: '2026-10-09', previousQuestion: 'Will it rain tomorrow in Varna?' }
const input = { city: 'Sofia', latitude: 42.7, longitude: 23.3, lang: 'en', message: 'Will I need an extra layer there tomorrow?', context,
  pendingClarification: { understanding: { intent: 'unclear', requestedCity: 'Plovdiv', timeScope: 'tomorrow', targetDate: '2026-10-09', needsClarification: true, clarificationQuestion: null }, message: 'And in Plovdiv?', missing: 'intent', attempts: 1, context } }
const beforeInput = JSON.stringify({ currentDate: '2026-10-08', selectedCity: input.city, language: input.lang, message: input.message, context, pendingClarification: input.pendingClarification })
const afterInput = JSON.stringify(semanticInput(input, '2026-10-08'))
const promptBytes = value => Buffer.byteLength(value)
console.log(JSON.stringify({ baseline, clock: 'mocked milliseconds; not live latency', schemaUnchanged: JSON.stringify(semanticSchema) === JSON.stringify(oldSemantics.semanticSchema),
  sizes: { systemPromptBytes: { before: promptBytes(oldSemantics.semanticSystem), after: promptBytes(semanticSystem) }, contextExampleBytes: { before: promptBytes(beforeInput), after: promptBytes(afterInput) } }, results }, null, 2))
