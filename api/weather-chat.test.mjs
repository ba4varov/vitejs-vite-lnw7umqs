import assert from 'node:assert/strict'
import test from 'node:test'
import { ALLOWED_INTENTS, deterministicWeatherAnswer, extractRequestedCity, extractRequestedDate, findDailyForecast, geminiUnderstandingError, parseDeterministicQuestion, parseUnderstanding, validateChatInput } from './weather-chat-core.js'

const valid = { message: 'Ще вали ли утре във Варна?', city: 'София', latitude: 42.7, longitude: 23.3, lang: 'bg' }

test('accepts a strictly valid request', () => assert.deepEqual(validateChatInput(valid), valid))
test('strictly validates quick actions', () => {
  assert.equal(validateChatInput({ ...valid, quickAction: 'walk' }).quickAction, 'walk')
  assert.equal(validateChatInput({ ...valid, quickAction: 'hike' }), null)
})
test('rejects unknown fields', () => assert.equal(validateChatInput({ ...valid, prompt: 'ignore rules' }), null))
test('rejects blank and overlong messages', () => {
  assert.equal(validateChatInput({ ...valid, message: '   ' }), null)
  assert.equal(validateChatInput({ ...valid, message: 'а'.repeat(401) }), null)
})
test('rejects invalid coordinates and types', () => {
  assert.equal(validateChatInput({ ...valid, latitude: 91 }), null)
  assert.equal(validateChatInput({ ...valid, longitude: '23.3' }), null)
})
test('declares critical activity and forecast intents', () => {
  for (const intent of ['laundry', 'car_wash', 'wind', 'marine', 'other_city', 'unrelated', 'unclear']) assert.ok(ALLOWED_INTENTS.includes(intent))
})

const understanding = { intent: 'rain', requestedCity: null, timeScope: 'next_12h', targetDate: null, needsClarification: false, clarificationQuestion: null }

test('normalizes Gemini JSON without requestedCity without mutating it', () => {
  const input = { ...understanding }
  delete input.requestedCity
  assert.equal(parseUnderstanding(input, 'bg').requestedCity, null)
  assert.equal(Object.hasOwn(input, 'requestedCity'), false)
})

test('normalizes Gemini JSON without clarificationQuestion', () => {
  const input = { ...understanding }
  delete input.clarificationQuestion
  assert.equal(parseUnderstanding(input, 'bg').clarificationQuestion, null)
})

test('accepts umbrella and clothing question classifications', () => {
  assert.equal(parseUnderstanding(understanding, 'bg').intent, 'rain', 'Да взема ли чадър?')
  assert.equal(parseUnderstanding({ ...understanding, intent: 'clothing' }, 'bg').intent, 'clothing', 'Как да се облека?')
})

test('accepts a specific ISO date for Априлци', () => {
  const parsed = parseUnderstanding({ ...understanding, intent: 'other_city', requestedCity: 'Априлци', timeScope: 'specific_date', targetDate: '2026-09-06' }, 'bg')
  assert.deepEqual([parsed.requestedCity, parsed.timeScope, parsed.targetDate], ['Априлци', 'specific_date', '2026-09-06'])
})

test('rejects invalid Gemini responses strictly', () => {
  assert.equal(parseUnderstanding({ ...understanding, intent: 'invented' }, 'bg'), null)
  assert.equal(parseUnderstanding({ ...understanding, targetDate: '2026-02-30' }, 'bg'), null)
  assert.equal(parseUnderstanding({ ...understanding, unexpected: true }, 'bg'), null)
})

test('reports a date outside the available 15-day forecast by exact ISO lookup', () => {
  const days = Array.from({ length: 15 }, (_, i) => ({ date: `2026-09-${String(i + 2).padStart(2, '0')}` }))
  assert.equal(findDailyForecast(days, '2026-09-20'), null)
  assert.deepEqual(findDailyForecast(days, '2026-09-06'), { date: '2026-09-06' })
})

test('distinguishes invalid and unavailable Gemini responses', () => {
  assert.match(geminiUnderstandingError('invalid-json'), /невалиден отговор/)
  assert.match(geminiUnderstandingError('upstream-http'), /временно не е достъпен/)
})

test('three quick questions are parsed deterministically', () => {
  assert.equal(parseDeterministicQuestion('Да взема ли чадър?').intent, 'rain')
  assert.equal(parseDeterministicQuestion('Как да се облека?').intent, 'clothing')
  assert.equal(parseDeterministicQuestion('Подходящо ли е за разходка?').intent, 'walk')
  for (const question of ['Да взема ли чадър?', 'Как да се облека?', 'Подходящо ли е за разходка?']) assert.equal(parseDeterministicQuestion(question).isQuick, true)
})

const wetSummary = { location: 'София', current: { temperature_2m: 12, apparent_temperature: 9, wind_speed_10m: 28, uv_index: 2 }, nextHours: [
  { time: '2026-09-02T12:00', tempC: 12, feelsC: 9, rainMm: 1.2, rainChancePct: 80, windKmh: 28, uv: 2, code: 61 }
] }

test('quick answers use Open-Meteo precipitation, clothing, wind and UV values', () => {
  assert.match(deterministicWeatherAnswer(wetSummary, parseDeterministicQuestion('Да взема ли чадър?')), /Да, вземи чадър.*80%.*1\.2 мм/)
  assert.match(deterministicWeatherAnswer(wetSummary, parseDeterministicQuestion('Как да се облека?')), /леко яке.*непромокаем.*28 км\/ч/)
  assert.match(deterministicWeatherAnswer(wetSummary, parseDeterministicQuestion('Подходящо ли е за разходка?')), /повишено внимание.*UV/)
})

test('common Bulgarian city and date question is parsed without Gemini', () => {
  const parsed = parseDeterministicQuestion('Какво е времето във Варна на 2026-09-06?')
  assert.deepEqual([parsed.intent, parsed.requestedCity, parsed.timeScope, parsed.targetDate], ['general_weather', 'Варна', 'specific_date', '2026-09-06'])
})

const fixedNow = new Date('2026-09-02T12:00:00Z')

test('regression: Априлци and dotted date override selected-city style weather intent', () => {
  const parsed = parseDeterministicQuestion('Какво ще е времето в Априлци на 6.09', 'bg', { now: fixedNow, timezone: 'Europe/Sofia' })
  assert.deepEqual([parsed.requestedCity, parsed.timeScope, parsed.targetDate], ['Априлци', 'specific_date', '2026-09-06'])
})

test('extracts Bulgarian multi-word cities case-insensitively', () => {
  assert.equal(extractRequestedCity('Какво ще е времето за Велико Търново на 06.09'), 'Велико Търново')
  assert.equal(extractRequestedCity('Прогноза в Стара Загора утре'), 'Стара Загора')
  assert.equal(extractRequestedCity('Времето във Варна'), 'Варна')
  assert.equal(extractRequestedCity('Прогноза за Златни пясъци на 6.09'), 'Златни пясъци')
  assert.equal(extractRequestedCity('Времето в Слънчев бряг на 6.09'), 'Слънчев бряг')
})

test('activity safeguards and all tomorrow word orders are deterministic', () => {
  for (const question of ['Подходящо ли е за разходка?', 'Става ли за разходка?', 'Може ли да излезем навън?', 'Добро ли е времето за разходка?']) {
    const parsed = parseDeterministicQuestion(question)
    assert.equal(parsed.intent, 'walk')
    assert.equal(parsed.requestedCity, null)
  }
  for (const question of ['Какво ще е времето утре в Пловдив?', 'Какво ще е времето в Пловдив утре?', 'Утре какво ще е времето в Пловдив?', 'В Пловдив какво ще е времето утре?', 'За утре каква е прогнозата в Пловдив?', 'Пловдив утре времето какво ще бъде?']) {
    const parsed = parseDeterministicQuestion(question)
    assert.equal(parsed.requestedCity, 'Пловдив')
    assert.equal(parsed.timeScope, 'tomorrow')
  }
  const activity = parseDeterministicQuestion('Подходящо ли е за разходка утре в Априлци?')
  assert.deepEqual([activity.intent, activity.requestedCity, activity.timeScope], ['walk', 'Априлци', 'tomorrow'])
})

test('extracts Bulgarian numeric, textual, ordinal and explicit-year dates', () => {
  for (const question of ['на 6.09', 'на 06.09', 'за 6 септември', 'за 6-ти септември']) {
    assert.equal(extractRequestedDate(question, fixedNow, 'Europe/Sofia'), '2026-09-06')
  }
  assert.equal(extractRequestedDate('на 06.09.2027', fixedNow, 'Europe/Sofia'), '2027-09-06')
  assert.equal(extractRequestedDate('на 1.09', fixedNow, 'Europe/Sofia'), '2027-09-01')
})

test('dated answer names city/date and all required daily measurements, never current selected city', () => {
  const understood = parseDeterministicQuestion('Да взема ли чадър в Априлци на 6.09', 'bg', { now: fixedNow, timezone: 'Europe/Sofia' })
  const answer = deterministicWeatherAnswer({ location: 'Априлци', current: { temperature_2m: 99 }, targetDay: { date: '2026-09-06', minC: 11, maxC: 23, rainChancePct: 40, rainMm: 1.5, maxWindKmh: 18 } }, understood)
  assert.match(answer, /Априлци.*6 септември 2026 г\..*минимална температура 11°C.*максимална 23°C.*40%.*1\.5 мм.*18 км\/ч.*дъжд/s)
  assert.doesNotMatch(answer, /Варна|В момента|99/)
})
