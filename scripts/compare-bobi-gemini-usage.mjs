// Offline, synthetic comparison against a git-archived baseline (see docs).
// No Google, Supabase or Open-Meteo network requests; no production messages.
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { geminiClient } from '../server/gemini-client.js'
import { invoke, forecast } from '../tests/helpers/weather-chat-harness.mjs'
import { efficiencyCorpus } from '../tests/helpers/gemini-efficiency-corpus.mjs'
import { geminiResponse, efficiencySemantic, efficiencyExpected, checkOutcome } from '../tests/helpers/bobi-regression.mjs'
import { parseSemanticUnderstanding } from '../server/weather-chat-semantics.js'

if (!process.argv[2]) throw new Error('Usage: node scripts/compare-bobi-gemini-usage.mjs <baseline-directory>')
const baselineUrl = pathToFileURL(resolve(process.argv[2]) + '/').href
const { invoke: beforeInvoke } = await import(new URL('tests/helpers/weather-chat-harness.mjs', baselineUrl))
const { geminiClient: beforeGemini } = await import(new URL('server/gemini-client.js', baselineUrl))
const totals = { scenarios: 0, beforeCalls: 0, afterCalls: 0, failures: [], categories: {} }
let sequence = 0
for (const item of efficiencyCorpus()) {
  const index = sequence++
  test(`${item.lang}/${item.category}/${index}`, async t => {
    const oldKey = process.env.GEMINI_API_KEY
    process.env.GEMINI_API_KEY = 'offline-fixture'
    t.after(() => { if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey })
    t.mock.method(console, 'info', () => {})
    const semantic = efficiencySemantic(item)
    assert.ok(parseSemanticUnderstanding(semantic, item.lang), 'fixture-contract: invalid semantic fixture')
    const counts = { before: 0, after: 0 }
    t.mock.method(beforeGemini, 'generate', async () => { counts.before++; return geminiResponse(semantic) })
    t.mock.method(geminiClient, 'generate', async () => { counts.after++; return geminiResponse(semantic) })
    const dateNow = new Date(Date.parse('2026-10-08T09:00:00Z') + index * 60000).toISOString()
    const failures = []
    for (const [side, run] of [['before', beforeInvoke], ['after', invoke]]) {
      try {
        // Fresh copies prevent one implementation from mutating the other's inputs.
        const result = await run(t, item.message, item.lang, structuredClone(item.context ? { context: item.context } : {}), structuredClone(forecast), dateNow, structuredClone([item.place]))
        checkOutcome(result, efficiencyExpected(item))
        assert.equal(counts[side], side === 'before' ? 1 : item.local ? 0 : 1, 'Gemini route')
      } catch (error) {
        failures.push({ side, index, lang: item.lang, category: item.category, message: item.message, error: error.message })
      }
    }
    // Count attempted cases and calls even when either implementation failed.
    totals.scenarios++; totals.beforeCalls += counts.before; totals.afterCalls += counts.after
    totals.failures.push(...failures)
    const category = totals.categories[item.category] ??= { scenarios: 0, beforeCalls: 0, afterCalls: 0, failures: 0 }
    category.scenarios++; category.beforeCalls += counts.before; category.afterCalls += counts.after; category.failures += failures.length
    assert.equal(failures.length, 0, JSON.stringify(failures))
  })
}
test.after(() => {
  const percentSaved = totals.beforeCalls ? Math.round(1000 * (totals.beforeCalls - totals.afterCalls) / totals.beforeCalls) / 10 : null
  console.log(JSON.stringify({ ...totals, percentSaved }))
})
