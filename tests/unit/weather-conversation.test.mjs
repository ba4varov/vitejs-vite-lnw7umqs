import test from 'node:test'
import assert from 'node:assert/strict'
import { parseConversationQuestion, validateChatInput, deterministicWeatherAnswer, extractRequestedDate } from '../../server/weather-chat-core.js'
const context = { city: 'Varna', latitude: 43.2, longitude: 27.9, intent: 'rain', timeScope: 'specific_date', targetDate: '2026-10-20', previousQuestion: 'Rain in Varna on October 20?' }
for (const lang of ['bg', 'en']) {
  test(`${lang}: follow-up changes date and retains measure`, () => {
    const result = parseConversationQuestion(lang === 'bg' ? 'А утре?' : 'And tomorrow?', lang, { context })
    assert.equal(result.intent, 'rain'); assert.equal(result.timeScope, 'tomorrow'); assert.equal(result.targetDate, null)
  })
  test(`${lang}: new city retains measure and date`, () => {
    const result = parseConversationQuestion(lang === 'bg' ? 'А в Пловдив?' : 'And in London?', lang, { context })
    assert.equal(result.intent, 'rain'); assert.equal(result.targetDate, context.targetDate)
    assert.equal(result.requestedCity, lang === 'bg' ? 'Пловдив' : 'London')
  })
  test(`${lang}: measure follow-up retains date`, () => {
    const result = parseConversationQuestion(lang === 'bg' ? 'А вятърът?' : 'And wind?', lang, { context })
    assert.equal(result.intent, 'wind'); assert.equal(result.targetDate, context.targetDate)
  })
  test(`${lang}: missing precipitation never means dry weather`, () => {
    const answer = deterministicWeatherAnswer({ location: 'Varna', targetDay: null, nextHours: [{ time: '2026-10-20T12:00', tempC: 20 }] }, { intent: 'rain', timeScope: 'next_12h', targetDate: null }, lang)
    assert.match(answer, lang === 'bg' ? /Нямам достатъчно/ : /don't have enough/)
    assert.doesNotMatch(answer, /0%|No umbrella|не е нужен/)
  })
}
test('context is bounded and rejects invalid coordinates', () => {
  const input = { message: 'And tomorrow?', city: 'Sofia', latitude: 42, longitude: 23, lang: 'en', context }
  assert.ok(validateChatInput(input))
  assert.equal(validateChatInput({ ...input, context: { ...context, latitude: 300 } }), null)
})
test('relative dates use destination timezone across midnight', () => {
  const now = new Date('2026-12-31T23:30:00Z')
  assert.equal(extractRequestedDate('in 2 days', now, 'Asia/Tokyo'), '2027-01-03')
  assert.equal(extractRequestedDate('след 3 дни', now, 'America/Los_Angeles'), '2027-01-03')
})
test('unrelated questions cannot inherit weather intent', () => {
  assert.equal(parseConversationQuestion('Write some code', 'en', { context }).intent, 'unrelated')
})
