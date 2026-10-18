import test from 'node:test'
import assert from 'node:assert/strict'
import { clarificationTurn, validateChatInput, validatePendingClarification } from '../../server/weather-chat-core.js'
const context = { city: 'Varna', latitude: 43.2, longitude: 27.9, intent: 'wind', timeScope: 'tomorrow', targetDate: '2026-10-09', previousQuestion: 'Wind tomorrow in Varna?' }
for (const lang of ['bg', 'en']) {
  const cityMessage = lang === 'bg' ? 'А в Пловдив?' : 'And in Plovdiv?'
  for (const [reply, intent] of [[lang === 'bg' ? 'За вятъра' : 'For wind', 'wind'], [lang === 'bg' ? 'Общата прогноза' : 'The general forecast', 'general_weather']]) {
    test(`${lang}: city clarification resolves ${intent} without losing tomorrow`, () => {
      const first = clarificationTurn(cityMessage, lang, { context })
      assert.equal(first.pendingClarification.missing, 'intent')
      assert.match(first.answer, lang === 'bg' ? /Какво Ви интересува за Пловдив/ : /wind.*general/)
      assert.ok(validatePendingClarification(first.pendingClarification))
      const next = clarificationTurn(reply, lang, { context, pendingClarification: first.pendingClarification })
      assert.equal(next.understanding.intent, intent)
      assert.equal(next.understanding.requestedCity, lang === 'bg' ? 'Пловдив' : 'Plovdiv')
      assert.equal(next.understanding.timeScope, 'tomorrow')
      assert.equal(next.pendingClarification, null)
    })
  }
  test(`${lang}: no context asks only what information, retaining city`, () => {
    const first = clarificationTurn(cityMessage, lang)
    assert.match(first.answer, lang === 'bg' ? /Пловдив/ : /Plovdiv/)
    const next = clarificationTurn(lang === 'bg' ? 'За вятъра' : 'For wind', lang, { pendingClarification: first.pendingClarification })
    assert.equal(next.understanding.intent, 'wind')
    assert.equal(next.understanding.requestedCity, lang === 'bg' ? 'Пловдив' : 'Plovdiv')
  })
  test(`${lang}: ambiguous date retains explicit city and wind`, () => {
    const first = clarificationTurn(lang === 'bg' ? 'Вятърът следващата седмица в Пловдив?' : 'Wind next week in Plovdiv?', lang, { context })
    assert.equal(first.pendingClarification.missing, 'date')
    const next = clarificationTurn(lang === 'bg' ? 'За утре' : 'For tomorrow', lang, { pendingClarification: first.pendingClarification })
    assert.equal(next.understanding.intent, 'wind')
    assert.equal(next.understanding.timeScope, 'tomorrow')
    assert.equal(next.understanding.targetDate, null)
    assert.equal(next.understanding.requestedCity, lang === 'bg' ? 'Пловдив' : 'Plovdiv')
  })
  test(`${lang}: full question and quick action interrupt pending turn`, () => {
    const first = clarificationTurn(cityMessage, lang, { context })
    const next = clarificationTurn(lang === 'bg' ? 'Ще вали ли утре в София?' : 'Will it rain tomorrow in Sofia?', lang, { pendingClarification: first.pendingClarification })
    assert.equal(next.understanding.intent, 'rain')
    assert.equal(next.pendingClarification, null)
    assert.equal(next.understanding.requestedCity, lang === 'bg' ? 'София' : 'Sofia')
    const quick = clarificationTurn('umbrella', lang, { pendingClarification: first.pendingClarification, quickAction: 'umbrella' })
    assert.equal(quick.understanding.intent, 'rain')
    assert.equal(quick.pendingClarification, null)
  })
  test(`${lang}: retries stop and explain the missing field`, () => {
    let result = clarificationTurn(cityMessage, lang, { context })
    for (let i = 0; i < 3; i++) result = clarificationTurn(lang === 'bg' ? 'Не знам' : 'I do not know', lang, { pendingClarification: result.pendingClarification })
    assert.equal(result.pendingClarification, null)
    assert.match(result.answer, lang === 'bg' ? /е нужно уточнение/ : /I need this information/)
  })
}
test('untrusted pending state is bounded and rejects malformed fields', () => {
  const pendingClarification = clarificationTurn('And in Plovdiv?', 'en', { context }).pendingClarification
  const input = { message: 'For wind', city: 'Sofia', latitude: 42, longitude: 23, lang: 'en', context, pendingClarification }
  assert.ok(validateChatInput(input))
  for (const pending of [{ ...pendingClarification, attempts: 4 }, { ...pendingClarification, message: 'x'.repeat(401) }, { ...pendingClarification, missing: 'secret' }, { ...pendingClarification, injected: true }, { ...pendingClarification, context: { ...context, latitude: 100 } }, { ...pendingClarification, understanding: { ...pendingClarification.understanding, targetDate: '2026-99-99' } }]) assert.equal(validateChatInput({ ...input, pendingClarification: pending }), null)
})
for (const lang of ['bg', 'en']) test(`${lang}: explicit calendar date resolves date slot; invalid date stays pending`, () => {
  const first = clarificationTurn(lang === 'bg' ? 'Вятърът следващата седмица в Пловдив?' : 'Wind next week in Plovdiv?', lang)
  const invalid = clarificationTurn('2026-02-31', lang, { pendingClarification: first.pendingClarification })
  assert.ok(invalid.pendingClarification)
  const next = clarificationTurn('2026-10-20', lang, { pendingClarification: invalid.pendingClarification })
  assert.equal(next.understanding.targetDate, '2026-10-20')
  assert.equal(next.understanding.intent, 'wind')
  assert.equal(next.pendingClarification, null)
})

for (const lang of ['bg', 'en']) test(`${lang}: standalone question drops pending city and period without Gemini`, () => {
  const pendingClarification = clarificationTurn(lang === 'bg' ? 'А в Пловдив?' : 'And in Plovdiv?', lang, { context }).pendingClarification
  const next = clarificationTurn(lang === 'bg' ? 'Каква е температурата?' : 'What is the temperature?', lang, { context, pendingClarification })
  assert.equal(next.context, undefined)
  assert.equal(next.continuation, false)
  assert.equal(next.pendingClarification, null)
  assert.equal(next.understanding.intent, 'temperature')
  assert.equal(next.understanding.requestedCity, null)
  assert.equal(next.understanding.timeScope, 'general')
  assert.equal(next.understanding.targetDate, null)
})
