import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSemanticUnderstanding, resolveSemanticTurn, hasInvalidCalendarLiteral } from '../../server/weather-chat-semantics.js'
import { validateConversationContext } from '../../server/weather-chat-core.js'
import { semanticFixture, languageCorpus } from '../helpers/bobi-language-corpus.mjs'

const context = { city: 'Varna', latitude: 43.2, longitude: 27.9, intent: 'wind', timeScope: 'tomorrow', targetDate: '2026-10-09', previousQuestion: 'Wind tomorrow in Varna?' }
const input = { city: 'Sofia', latitude: 42.7, longitude: 23.3, lang: 'en', message: 'Question', context }
const pending = { understanding: { intent: 'general_weather', requestedCity: 'Plovdiv', timeScope: 'tomorrow', targetDate: '2026-10-09', needsClarification: false, clarificationQuestion: null }, missing: 'intent', attempts: 1, message: 'And in Plovdiv?', context }

for (const fixture of languageCorpus()) test(`semantic resolver keeps oracle across generated ${fixture.lang}/${fixture.intent}/${fixture.mutation}`, () => {
  const semantic = parseSemanticUnderstanding(semanticFixture({ intent: fixture.intent, requestedCity: fixture.requestedCity, timeScope: fixture.timeScope, citySource: 'explicit', timeSource: 'explicit' }), fixture.lang)
  assert.ok(semantic)
  const turn = resolveSemanticTurn(fixture.message, fixture.lang, input, semantic)
  assert.equal(turn.answer, undefined)
  assert.equal(turn.understanding.intent, fixture.intent)
  assert.equal(turn.understanding.requestedCity, fixture.requestedCity)
  assert.equal(turn.understanding.timeScope, 'tomorrow')
  assert.equal(turn.context, undefined)
})

test('strict semantic contract rejects unknown fields, missing metadata and contradictory sources', () => {
  const valid = semanticFixture()
  for (const value of [
    { ...valid, citySource: 'explicit' }, { ...valid, missing: 'date' },
    { ...valid, requestedCity: 'Plovdiv' }, { ...valid, citySource: 'context' },
    { ...valid, timeSource: 'context' }, { ...valid, missing: 'location', needsClarification: true, citySource: 'missing', city: 'invented' },
    { ...valid, targetDate: '2026-02-31', timeScope: 'specific_date', timeSource: 'explicit' },
    { ...valid, timeScope: 'tomorrow', targetDate: '2026-10-09' },
    { ...valid, intent: 'write_code' }, { ...valid, turnType: 'execute' },
    { ...valid, clarificationQuestion: 'Untrusted prose' }, { intent: 'rain' }
  ]) assert.equal(parseSemanticUnderstanding(value), null)
})

test('slot provenance controls inheritance, explicit changes and standalone resets without text heuristics', () => {
  const base = semanticFixture({ intent: 'rain', turnType: 'clarification', citySource: 'context', timeSource: 'context', timeScope: 'now' })
  const inherited = resolveSemanticTurn('any new wording', 'en', { ...input, pendingClarification: pending }, base)
  assert.equal(inherited.understanding.requestedCity, 'Plovdiv')
  assert.equal(inherited.understanding.timeScope, 'tomorrow')
  assert.equal(inherited.understanding.targetDate, '2026-10-09')
  const omitted = resolveSemanticTurn('any wording', 'en', { ...input, pendingClarification: pending }, { ...base, citySource: 'selected', timeSource: 'default' })
  assert.equal(omitted.understanding.requestedCity, 'Plovdiv')
  assert.equal(omitted.understanding.targetDate, '2026-10-09')
  const changed = resolveSemanticTurn('any new wording', 'en', { ...input, pendingClarification: pending }, { ...base, requestedCity: 'Sofia', citySource: 'explicit', timeSource: 'explicit', timeScope: 'today' })
  assert.equal(changed.understanding.requestedCity, 'Sofia')
  assert.equal(changed.understanding.timeScope, 'today')
  const fresh = resolveSemanticTurn('any new wording', 'en', { ...input, pendingClarification: pending }, semanticFixture({ intent: 'temperature' }))
  assert.equal(fresh.context, undefined)
  assert.equal(fresh.understanding.requestedCity, null)
  assert.equal(fresh.understanding.timeScope, 'next_12h')
})

for (const missing of ['date', 'location']) test(`a valid intent does not supply an unresolved ${missing}`, () => {
  const turn = resolveSemanticTurn('any wording', 'en', { ...input, pendingClarification: { ...pending, missing } }, semanticFixture({ intent: 'rain', turnType: 'clarification', citySource: 'context', timeSource: 'context' }))
  assert.equal(turn.pendingClarification.missing, missing)
  assert.ok(turn.answer)
})

test('numeric calendar validation is independent of semantic confidence', () => {
  for (const text of ['31.02.2026', '2026-13-01', '2026-02-31']) assert.equal(hasInvalidCalendarLiteral(text), true)
  for (const text of ['2028-02-29', '12.10.2026', 'ordinary words']) assert.equal(hasInvalidCalendarLiteral(text), false)
  const turn = resolveSemanticTurn('Weather on 31.02.2026', 'en', input, semanticFixture({ intent: 'rain', timeScope: 'specific_date', targetDate: '2026-03-03', timeSource: 'explicit' }))
  assert.equal(turn.reason, 'invalid_date')
  assert.equal(turn.pendingClarification.missing, 'date')
})


test('client context rejects normalized impossible dates and an undated specific_date', () => {
  assert.equal(validateConversationContext(context), true)
  assert.equal(validateConversationContext({ ...context, timeScope: 'specific_date', targetDate: null }), false)
  assert.equal(validateConversationContext({ ...context, targetDate: '2026-02-31' }), false)
})
