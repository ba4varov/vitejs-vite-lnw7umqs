import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDeterministicQuestion, deterministicWeatherAnswer, parseUnderstanding, clarificationTurn } from '../../server/weather-chat-core.js'

for (const [message, city, scope] of [
  ['Ще гърми ли?', null, 'general'],
  ['Ще има ли гръмотевици утре във Варна?', 'Варна', 'tomorrow'],
  ['Очакват ли се гръмотевични бури?', null, 'general'],
  ['Ще има ли мълнии?', null, 'general'],
  ['Will there be thunderstorms in Plovdiv tomorrow?', 'Plovdiv', 'tomorrow'],
  ['Is thunder expected?', null, 'general'],
  ['Will there be lightning tonight?', null, 'night'],
  ['Any thundershowers or rain tomorrow?', null, 'tomorrow']
]) test(`thunderstorm fallback: ${message}`, () => {
  const parsed = parseDeterministicQuestion(message, /[а-я]/iu.test(message) ? 'bg' : 'en')
  assert.equal(parsed.intent, 'thunderstorm')
  assert.equal(parsed.requestedCity, city)
  assert.equal(parsed.timeScope, scope)
  assert.equal(parsed.needsClarification, false)
  assert.ok(parseUnderstanding(Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'isQuick')), 'en'))
})

const dates = ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']
const hours = dates.flatMap(date => Array.from({ length: 24 }, (_, h) => ({ time: `${date}T${String(h).padStart(2, '0')}:00`, code: 0 })))
const summary = { location: 'Plovdiv', current: { time: '2026-10-08T00:00', weather_code: 0 }, nextHours: hours, targetDay: null }
const understood = (timeScope, targetDate = null) => ({ intent: 'thunderstorm', requestedCity: null, timeScope, targetDate, needsClarification: false, clarificationQuestion: null })
const answer = (data, scope = 'next_12h', date = null, lang = 'en') => deterministicWeatherAnswer(data, understood(scope, date), lang)
const positive = /data indicate.*thunderstorm/
const negative = /do not indicate thunderstorms.*not a guarantee/
const missing = /don't have enough thunderstorm data/

for (const code of [95, 96, 99]) for (const source of ['current', 'hourly', 'daily']) test(`WMO ${code} from ${source} alone establishes storm evidence`, () => {
  const data = source === 'current' ? { ...summary, current: { ...summary.current, weather_code: code } }
    : source === 'hourly' ? { ...summary, nextHours: [{ ...hours[2], code }] }
    : { ...summary, targetDay: { date: dates[1], code }, nextHours: [] }
  assert.match(answer(data, source === 'current' ? 'now' : source === 'daily' ? 'tomorrow' : 'next_12h', source === 'daily' ? dates[1] : null), positive)
})

for (const lang of ['bg', 'en']) test(`rain probability cannot become thunderstorm probability ${lang}`, () => {
  const data = { ...summary, nextHours: hours.map(hour => ({ ...hour, code: 65, rainMm: 50, rainChancePct: 100 })) }
  const result = answer(data, 'next_12h', null, lang)
  assert.match(result, lang === 'en' ? negative : /не показват гръмотевични бури.*не е гаранция/)
  assert.doesNotMatch(result, /100|50|%|предупреждение|warning/)
})

for (const [label, nextHours] of [
  ['empty', []], ['null code', hours.map(h => ({ ...h, code: null }))],
  ['unknown code', hours.map(h => ({ ...h, code: 100 }))],
  ['gap', hours.filter((_, i) => i !== 5)],
  ['duplicate', Array(12).fill(hours[0])], ['truncated', hours.slice(0, 11)]
]) test(`incomplete hourly coverage (${label}) cannot give a negative verdict`, () => {
  assert.match(answer({ ...summary, nextHours }), missing)
})

test('period selection ignores storms outside requested hours/day and now uses only current code', () => {
  const stormHours = hours.map(h => ({ ...h, code: h.time === '2026-10-08T13:00' ? 95 : 0 }))
  const data = { ...summary, nextHours: stormHours }
  assert.match(answer(data, 'morning'), negative)
  assert.match(answer(data, 'afternoon'), positive)
  assert.match(answer(data, 'next_12h'), negative)
  assert.match(answer(data, 'next_24h'), positive)
  assert.match(answer(data, 'now'), negative)
  assert.match(answer(data, 'specific_date', dates[1]), negative)
})

test('tomorrow night spans midnight and never uses the daily storm outside that window', () => {
  const data = { ...summary, requestedDate: dates[1], targetDay: { date: dates[1], code: 95 } }
  assert.match(answer(data, 'tomorrow_night', dates[1]), negative)
  assert.match(answer({ ...data, nextHours: hours.map(h => ({ ...h, code: h.time === '2026-10-10T02:00' ? 99 : 0 })) }, 'tomorrow_night', dates[1]), positive)
})

test('full calendar day uses daily or complete hourly codes; hourly positive wins over daily nonstorm', () => {
  assert.match(answer(summary, 'specific_date', dates[1]), negative)
  assert.match(answer({ ...summary, nextHours: [], targetDay: { date: dates[1], code: 61 } }, 'tomorrow', dates[1]), negative)
  assert.match(answer({ ...summary, nextHours: [], targetDay: { date: dates[1], code: null } }, 'tomorrow', dates[1]), missing)
  assert.match(answer({ ...summary, nextHours: hours.filter(h => h.time !== '2026-10-09T10:00') }, 'tomorrow', dates[1]), missing)
  assert.match(answer({ ...summary, targetDay: { date: dates[1], code: 0 }, nextHours: [{ time: '2026-10-09T10:00', code: 96 }] }, 'tomorrow', dates[1]), positive)
})

test('weekend answers each requested date, including missing and storm data', () => {
  const result = answer({ ...summary, nextHours: [], requestedDates: dates.slice(2), targetDays: [{ date: dates[2], code: 95 }] }, 'this_weekend')
  assert.match(result, /2026-10-10.*data indicate/)
  assert.match(result, /enough thunderstorm data.*2026-10-11/)
})

test('archive evidence is labelled historical rather than forecast', () => {
  const result = answer({ ...summary, historical: true, nextHours: [], targetDay: { date: '2026-10-07', code: 99 } }, 'yesterday', '2026-10-07')
  assert.match(result, /historical data indicate/)
  assert.doesNotMatch(result, /forecast data indicate/)
})

test('validated AI resolves an unknown long weather formulation while date/location guards remain', () => {
  const context = { city: 'Varna', latitude: 43, longitude: 27, intent: 'wind', timeScope: 'tomorrow', targetDate: dates[1], previousQuestion: 'Wind tomorrow?' }
  const pendingClarification = clarificationTurn('And in Plovdiv?', 'en', { context }).pendingClarification
  const aiUnderstanding = understood('now')
  const next = clarificationTurn('Could the sky start rumbling over us while we are outside?', 'en', { pendingClarification, aiUnderstanding })
  assert.equal(next.answer, undefined)
  assert.equal(next.understanding.intent, 'thunderstorm')
  assert.equal(next.understanding.requestedCity, 'Plovdiv')
  assert.equal(next.understanding.timeScope, 'tomorrow')
  for (const missing of ['date', 'location']) {
    const guarded = clarificationTurn('Could the sky start rumbling over us?', 'en', { pendingClarification: { ...pendingClarification, missing }, aiUnderstanding })
    assert.equal(guarded.pendingClarification?.missing, missing)
    assert.ok(guarded.answer)
  }
})

for (const intent of ['wind', 'rain', 'uv', 'general_weather']) test(`pending intent resolution accepts AI ${intent} without local phrase matching`, () => {
  const pendingClarification = clarificationTurn('А в Пловдив?', 'bg').pendingClarification
  const next = clarificationTurn('Може ли да ми дадете още подробности по този въпрос?', 'bg', { pendingClarification, aiUnderstanding: { ...understood('now'), intent } })
  assert.equal(next.answer, undefined)
  assert.equal(next.understanding.intent, intent)
  assert.equal(next.understanding.requestedCity, 'Пловдив')
})

test('AI intent cannot hide an explicitly unresolved date in the clarification reply', () => {
  const pendingClarification = clarificationTurn('А в Пловдив?', 'bg').pendingClarification
  for (const message of ['Ще гърми ли следващата седмица?', 'Ще гърми ли утре или вдругиден?', 'Ще гърми ли на 31.02.2026?']) {
    const next = clarificationTurn(message, 'bg', { pendingClarification, aiUnderstanding: understood('now') })
    assert.equal(next.pendingClarification.missing, 'date')
    assert.equal(next.pendingClarification.understanding.requestedCity, 'Пловдив')
  }
})

test('weekend with no resolved dates never substitutes current/hourly weather', () => {
  assert.match(answer(summary, 'this_weekend'), missing)
})
