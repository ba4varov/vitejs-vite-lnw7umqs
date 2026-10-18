// Offline, synthetic comparison against a git-archived baseline (see docs).
// No Google, Supabase or Open-Meteo network requests; no production messages.
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { geminiClient } from '../server/gemini-client.js'
import { invoke, forecast } from '../tests/helpers/weather-chat-harness.mjs'
import { efficiencyCorpus } from '../tests/helpers/gemini-efficiency-corpus.mjs'
import { semanticFixture } from '../tests/helpers/bobi-language-corpus.mjs'

if (!process.argv[2]) throw new Error('Usage: node scripts/compare-bobi-gemini-usage.mjs <baseline-directory>')
const baselineUrl = pathToFileURL(resolve(process.argv[2]) + '/').href
const { invoke: beforeInvoke } = await import(new URL('tests/helpers/weather-chat-harness.mjs', baselineUrl))
const { geminiClient: beforeGemini } = await import(new URL('server/gemini-client.js', baselineUrl))
const totals = { scenarios: 0, beforeCalls: 0, afterCalls: 0, regressions: 0, categories: {} }
let minute = 0
for (const item of efficiencyCorpus()) test(`${item.lang}/${item.category}/${minute++}`, async t => {
  const oldKey = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'offline-fixture'
  t.after(() => { if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey })
  t.mock.method(console, 'info', () => {})
  let beforeCalls = 0, afterCalls = 0
  const oracle = async () => ({ payload: { candidates: [{ content: { parts: [{ text: JSON.stringify(semanticFixture({ intent: item.intent, requestedCity: item.citySource === 'context' ? null : item.place.name, citySource: item.citySource ?? 'explicit', timeScope: item.timeScope, targetDate: item.timeScope === 'specific_date' ? item.targetDate : null, timeSource: item.timeSource ?? 'explicit', turnType: item.context ? 'follow_up' : 'new_question' })) }] } }] } })
  t.mock.method(beforeGemini, 'generate', () => { beforeCalls++; return oracle() })
  t.mock.method(geminiClient, 'generate', () => { afterCalls++; return oracle() })
  const dateNow = new Date(Date.parse('2026-10-08T00:00:00Z') + totals.scenarios * 60000).toISOString()
  const args = [t, item.message, item.lang, item.context ? { context: item.context } : {}, forecast, dateNow, [item.place]]
  const before = await beforeInvoke(...args), after = await invoke(...args)
  for (const result of [before, after]) {
    try {
      assert.equal(result.body.needsClarification, false)
      assert.equal(result.body.intent, item.intent)
      assert.equal(result.body.targetDate, item.targetDate)
      const weather = result.calls.filter(url => !url.hostname.startsWith('geocoding-'))
      assert.ok(weather.some(url => url.hostname === 'api.open-meteo.com'))
      for (const url of weather) {
        assert.equal(Number(url.searchParams.get('latitude')), item.place.latitude)
        assert.equal(Number(url.searchParams.get('longitude')), item.place.longitude)
      }
    } catch (error) { totals.regressions++; throw error }
  }
  assert.equal(afterCalls, item.local ? 0 : 1)
  totals.scenarios++; totals.beforeCalls += beforeCalls; totals.afterCalls += afterCalls
  const category = totals.categories[item.category] ??= { scenarios: 0, beforeCalls: 0, afterCalls: 0 }
  category.scenarios++; category.beforeCalls += beforeCalls; category.afterCalls += afterCalls
})
test.after(() => {
  const percentSaved = Math.round(1000 * (totals.beforeCalls - totals.afterCalls) / totals.beforeCalls) / 10
  console.log(JSON.stringify({ ...totals, percentSaved }))
})
