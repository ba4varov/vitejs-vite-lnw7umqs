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

const weekdays = [
  ['понеделник', 'Monday', '2026-10-19'], ['вторник', 'Tuesday', '2026-10-20'],
  ['сряда', 'Wednesday', '2026-10-21'], ['четвъртък', 'Thursday', '2026-10-22'],
  ['петък', 'Friday', '2026-10-23'], ['събота', 'Saturday', '2026-10-24'],
  ['неделя', 'Sunday', '2026-10-18']
]
for (const lang of ['bg', 'en']) {
  for (const [bg, en, date] of weekdays) test(`${lang}: weekday ${en} inherits weather intent, never a city`, () => {
    const message = lang === 'bg' ? `А в ${bg}?` : `What about ${en}?`
    const result = parseConversationQuestion(message, lang, { context, now: new Date('2026-10-18T12:00:00Z'), timezone: 'Europe/Sofia' })
    assert.equal(result.requestedCity, null)
    assert.equal(result.intent, 'rain')
    assert.equal(result.targetDate, date)
    assert.equal(result.timeScope, 'specific_date')
  })
  for (const [name, hour] of [
    ['missing amount', { rainChancePct: 0 }], ['missing probability', { rainMm: 0 }],
    ['null amount', { rainMm: null, rainChancePct: 0 }],
    ['nonfinite amount', { rainMm: NaN, rainChancePct: 0 }]
  ]) test(`${lang}: ${name} cannot justify leaving umbrella behind`, () => {
    const answer = deterministicWeatherAnswer({ location: 'Varna', targetDay: null, nextHours: [{ time: '2026-10-20T12:00', ...hour }] }, { intent: 'rain', timeScope: 'next_12h', targetDate: null }, lang)
    assert.match(answer, lang === 'bg' ? /непълни/ : /incomplete/)
    assert.doesNotMatch(answer, /No umbrella|не е нужен чадър/)
  })
  test(`${lang}: missing later hourly value cannot become a zero in a dry total`, () => {
    const answer = deterministicWeatherAnswer({ location: 'Varna', targetDay: null, nextHours: [
      { time: '2026-10-20T12:00', rainMm: 0, rainChancePct: 0 },
      { time: '2026-10-20T13:00', rainMm: null, rainChancePct: 0 }
    ] }, { intent: 'rain', timeScope: 'next_12h' }, lang)
    assert.match(answer, lang === 'bg' ? /непълни/ : /incomplete/)
  })
  test(`${lang}: measured zero remains valid and observed rain still supports umbrella advice`, () => {
    const answer = hour => deterministicWeatherAnswer({ location: 'Varna', targetDay: null, nextHours: [{ time: '2026-10-20T12:00', ...hour }] }, { intent: 'rain', timeScope: 'next_12h' }, lang)
    assert.match(answer({ rainMm: 0, rainChancePct: 0 }), lang === 'bg' ? /Не, не е нужен чадър.*0%.*0\.0 мм/ : /No umbrella.*0%.*0\.0 mm/)
    assert.match(answer({ rainMm: 2, rainChancePct: null }), lang === 'bg' ? /Да, вземи чадър/ : /Yes, take an umbrella/)
  })
}
test('weekday date rolls over at local midnight and includes the current local day', () => {
  const now = new Date('2026-10-18T23:30:00Z')
  assert.equal(extractRequestedDate('в неделя', now, 'Asia/Tokyo'), '2026-10-25')
  assert.equal(extractRequestedDate('on Sunday', now, 'America/Los_Angeles'), '2026-10-18')
  assert.equal(extractRequestedDate('on Monday', now, 'Asia/Tokyo'), '2026-10-19')
})
test('weekday words inside real place names remain locations', () => {
  for (const [message, city] of [['Rain in Friday Harbor?', 'Friday Harbor'], ['Времето в Света Неделя?', 'Света Неделя'], ['Rain in London on Monday?', 'London']]) {
    assert.equal(parseConversationQuestion(message).requestedCity, city)
  }
  assert.equal(extractRequestedDate('Rain in Friday Harbor?'), null)
  assert.equal(extractRequestedDate('Времето в Света Неделя?'), null)
})
test('weekday dates cross a year boundary in local time', () => {
  assert.equal(extractRequestedDate('on Friday', new Date('2026-12-31T23:30:00Z'), 'Asia/Tokyo'), '2027-01-01')
  assert.equal(extractRequestedDate('в четвъртък', new Date('2026-12-31T23:30:00Z'), 'Asia/Tokyo'), '2027-01-07')
})
