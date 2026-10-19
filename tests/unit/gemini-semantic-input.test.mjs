import assert from 'node:assert/strict'
import test from 'node:test'
import { semanticInput, semanticSchema, parseSemanticUnderstanding } from '../../server/weather-chat-semantics.js'
import { languageCorpus, semanticFixture } from '../helpers/bobi-language-corpus.mjs'

const date = '2026-10-08'
for (const item of languageCorpus()) test(`semantic input retains natural wording and typo ${item.lang}/${item.intent}/${item.mutation}`, () => {
  const input = { message: item.message, city: 'Selected place', lang: item.lang, latitude: 42.7, longitude: 23.3 }
  const projected = semanticInput(input, date)
  assert.equal(projected.message, item.message)
  assert.equal(projected.language, item.lang)
  assert.equal(projected.selectedCity, 'Selected place')
  assert.equal(projected.currentDate, date)
  assert.equal(projected.context, null)
  assert.equal(projected.pendingClarification, null)
  assert.equal(Object.hasOwn(projected, 'latitude'), false)
  const result = semanticFixture({ intent: item.intent, requestedCity: item.requestedCity, citySource: 'explicit', timeScope: 'tomorrow', timeSource: 'explicit' })
  assert.equal(parseSemanticUnderstanding(result, item.lang).intent, item.intent)
})

for (const lang of ['bg', 'en']) test(`semantic projection keeps context, pending question and qualifiers without coordinates: ${lang}`, () => {
  const context = { city: 'Varna', latitude: 43.2, longitude: 27.9, intent: 'rain', timeScope: 'tomorrow', targetDate: '2026-10-09', previousQuestion: lang === 'bg' ? 'Ще вали ли утре във Варна?' : 'Will it rain tomorrow in Varna?' }
  const understanding = { intent: 'unclear', requestedCity: 'Banya', timeScope: 'tomorrow', targetDate: '2026-10-09', needsClarification: true, clarificationQuestion: null }
  const input = { city: 'Sofia', latitude: 42.7, longitude: 23.3, lang,
    message: lang === 'bg' ? 'За вятра, Пловдивска област' : 'For the wind, Plovdiv region', context,
    pendingClarification: { understanding, message: lang === 'bg' ? 'А в Баня?' : 'And in Banya?', missing: 'location', locationMode: 'qualifier', attempts: 2, context } }
  const original = structuredClone(input)
  const projected = semanticInput(input, date)
  assert.deepEqual(input, original)
  assert.deepEqual(projected.context, { city: 'Varna', intent: 'rain', timeScope: 'tomorrow', targetDate: '2026-10-09', previousQuestion: context.previousQuestion })
  assert.deepEqual(projected.pendingClarification.understanding, understanding)
  assert.equal(projected.pendingClarification.message, input.pendingClarification.message)
  assert.equal(projected.pendingClarification.missing, 'location')
  assert.equal(projected.pendingClarification.locationMode, 'qualifier')
  assert.deepEqual(projected.pendingClarification.context, projected.context)
  for (const key of ['latitude', 'longitude', 'attempts']) assert.equal(Object.hasOwn(projected.pendingClarification, key), false)
  assert.ok(JSON.stringify(projected).length < JSON.stringify({ currentDate: date, selectedCity: input.city, language: lang, message: input.message, context, pendingClarification: input.pendingClarification }).length)
})

test('compact requests retain strict schema and semantic boundaries', () => {
  assert.equal(semanticSchema.required.length, 10)
  assert.equal(parseSemanticUnderstanding({ ...semanticFixture(), extra: 'arbitrary prose' }), null)
  assert.equal(parseSemanticUnderstanding({ ...semanticFixture(), clarificationQuestion: 'arbitrary prose' }), null)
  assert.equal(parseSemanticUnderstanding({ ...semanticFixture(), citySource: 'context' }), null)
})
