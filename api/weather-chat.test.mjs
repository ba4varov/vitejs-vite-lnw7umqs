import assert from 'node:assert/strict'
import test from 'node:test'
import { ALLOWED_INTENTS, deterministicWeatherAnswer, extractRequestedCity, extractRequestedDate, findDailyForecast, geminiUnderstandingError, localIsoDate, parseDeterministicQuestion, parseUnderstanding, relativeForecastDate, validateChatInput, weekendForecastDates, zipForecastHours } from './weather-chat-core.js'

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

const dayAfterTomorrowVariants = ['вдругиден', 'вдруги ден', 'вдруги-ден', 'след два дни', 'след 2 дни', 'ден след утре']

test('all common day-after-tomorrow forms normalize deterministically', () => {
  for (const phrase of dayAfterTomorrowVariants) {
    const parsed = parseDeterministicQuestion(`Какво ще е времето ${phrase} в Ню Йорк?`)
    assert.deepEqual([parsed.requestedCity, parsed.timeScope], ['Ню Йорк', 'day_after_tomorrow'], phrase)
    assert.equal(relativeForecastDate(parsed.timeScope, fixedNow, 'America/New_York'), '2026-09-04', phrase)
  }
})

test('day-after-tomorrow supports different Bulgarian word orders', () => {
  for (const question of [
    'Какво ще е времето вдруги ден в Ню Йорк?',
    'В Ню Йорк вдруги ден какво ще е времето?',
    'Вдругиден ще вали ли в Ню Йорк?',
    'Каква е прогнозата за Ню Йорк след два дни?',
    'След 2 дни какво ще е времето в Ню Йорк?'
  ]) {
    const parsed = parseDeterministicQuestion(question)
    assert.deepEqual([parsed.requestedCity, parsed.timeScope], ['Ню Йорк', 'day_after_tomorrow'], question)
  }
})

test('New York local date determines the exact day-after-tomorrow ISO row', () => {
  const nearMidnight = new Date('2026-09-03T02:00:00Z')
  assert.equal(localIsoDate(nearMidnight, 'America/New_York'), '2026-09-02')
  const parsed = parseDeterministicQuestion('Какво ще е времето вдруги ден в Ню Йорк?')
  const exact = relativeForecastDate(parsed.timeScope, nearMidnight, 'America/New_York')
  assert.equal(exact, '2026-09-04')
  const day = findDailyForecast([{ date: '2026-09-03' }, { date: exact, minC: 17, maxC: 25, rainChancePct: 20, rainMm: 0, maxWindKmh: 16 }], exact)
  const answer = deterministicWeatherAnswer({ location: 'New York', current: { temperature_2m: 99 }, targetDay: day }, parsed)
  assert.match(answer, /New York.*4 септември 2026 г\. \(вдругиден\).*минимална температура 17°C.*максимална 25°C.*20%.*0 мм.*16 км\/ч/s)
  assert.doesNotMatch(answer, /В момента|99°C/)
})

test('relative dates resolve in the requested city timezone; unsupported ranges ask for clarification', () => {
  const parsed = parseDeterministicQuestion('Какво ще е времето след три дни в Ню Йорк?', 'bg', { now: fixedNow, timezone: 'America/New_York' })
  assert.deepEqual([parsed.requestedCity, parsed.timeScope, parsed.targetDate], ['Ню Йорк', 'specific_date', '2026-09-05'])
  const unsupported = parseDeterministicQuestion('Какво ще е времето след 20 дни в Ню Йорк?')
  assert.equal(unsupported.needsClarification, true)
})

test('free Bulgarian periods keep the exact requested interval', () => {
  for (const [question, scope] of [
    ['Какво ще е времето днес във Варна?', 'today'],
    ['Какво ще е времето утре в Токио?', 'tomorrow'],
    ['Ще вали ли утре вечер в Лондон?', 'tomorrow_evening'],
    ['Какво е времето през следващите 24 часа в Париж?', 'next_24h'],
    ['Какъв ще е вятърът довечера?', 'evening']
  ]) assert.equal(parseDeterministicQuestion(question).timeScope, scope, question)
  assert.equal(parseDeterministicQuestion('Какво време ще е утре?').intent, 'general_weather')
  assert.equal(parseDeterministicQuestion('Ще мога ли да простирам през следващите 24 часа?').intent, 'laundry')
  assert.equal(parseDeterministicQuestion('Каква е прогнозата за уикенда?').needsClarification, true)
  const nearMidnight = new Date('2026-09-03T02:00:00Z')
  assert.equal(relativeForecastDate('today', nearMidnight, 'America/New_York'), '2026-09-02')
  assert.equal(relativeForecastDate('tomorrow', nearMidnight, 'America/New_York'), '2026-09-03')
})

test('a 24-hour question describes 24 hourly values rather than current conditions', () => {
  const hours = Array.from({ length: 24 }, (_, i) => ({ time: `2026-09-02T${String(i).padStart(2, '0')}:00`, tempC: i, rainChancePct: 5, rainMm: 0, windKmh: 7 }))
  const answer = deterministicWeatherAnswer({ location: 'Париж', current: { temperature_2m: 99 }, nextHours: hours }, parseDeterministicQuestion('Какво е времето през следващите 24 часа в Париж?'))
  assert.match(answer, /Париж през следващите 24 часа.*0–23°C/)
  assert.doesNotMatch(answer, /99°C|В момента/)
})

test('tomorrow evening uses only matching local hours, not current temperature or full-day rain', () => {
  const today = '2026-09-02', tomorrow = '2026-09-03'
  const hours = [
    { time: `${today}T20:00`, tempC: 32, feelsC: 34, rainMm: 12, rainChancePct: 99, windKmh: 50, uv: 9, code: 95 },
    { time: `${tomorrow}T12:00`, tempC: 28, feelsC: 30, rainMm: 8, rainChancePct: 90, windKmh: 40, uv: 8, code: 61 },
    { time: `${tomorrow}T18:00`, tempC: 9, feelsC: 7, rainMm: 0, rainChancePct: 10, windKmh: 5, uv: 0, code: 1 },
    { time: `${tomorrow}T19:00`, tempC: 8, feelsC: 6, rainMm: 0, rainChancePct: 15, windKmh: 4, uv: 0, code: 1 }
  ]
  const summary = { location: 'Варна', current: { time: `${today}T20:00`, temperature_2m: 32, apparent_temperature: 34 }, requestedDate: tomorrow, targetDay: { date: tomorrow, rainMm: 8, rainChancePct: 90 }, nextHours: hours }
  const clothing = deterministicWeatherAnswer(summary, { intent: 'clothing', timeScope: 'tomorrow_evening' })
  assert.match(clothing, /утре вечер.*топло яке.*8°C.*6°C.*до 5 км\/ч/i)
  assert.doesNotMatch(clothing, /32°C|30°C|непромокаем/)
  const rain = deterministicWeatherAnswer(summary, { intent: 'rain', timeScope: 'tomorrow_evening' })
  assert.match(rain, /Не, не е нужен чадър утре вечер.*15%.*0\.0 мм/)
  assert.doesNotMatch(rain, /8\.0 мм|90%/)
})

test('tomorrow night includes next local morning, excludes current night and following evening', () => {
  const summary = { location: 'Варна', current: { time: '2026-09-02T22:00', temperature_2m: 30 }, requestedDate: '2026-09-03', nextHours: [
    { time: '2026-09-02T23:00', tempC: 30, rainMm: 20, rainChancePct: 100 },
    { time: '2026-09-03T22:00', tempC: 12, rainMm: 0, rainChancePct: 15 },
    { time: '2026-09-04T02:00', tempC: 10, rainMm: 1, rainChancePct: 40 },
    { time: '2026-09-04T18:00', tempC: 24, rainMm: 20, rainChancePct: 100 }
  ] }
  assert.match(deterministicWeatherAnswer(summary, { intent: 'rain', timeScope: 'tomorrow_night' }), /40%.*1\.0 мм/)
})

test('an elapsed period never silently falls back to the following day or current conditions', () => {
  const summary = { location: 'София', current: { time: '2026-09-02T19:00', temperature_2m: 28 }, nextHours: [
    { time: '2026-09-03T07:00', tempC: 8, rainChancePct: 60, rainMm: 2 }
  ] }
  const answer = deterministicWeatherAnswer(summary, { intent: 'temperature', timeScope: 'morning' })
  assert.match(answer, /Нямам налична почасова прогноза.*тази сутрин/)
  assert.doesNotMatch(answer, /28°C|8°C|60%/)
})

test('chat hourly values start at the location-local current hour', () => {
  const hourly = { time: ['2026-09-02T09:00', '2026-09-02T10:00', '2026-09-02T11:00'], temperature_2m: [19, 20, 21] }
  assert.deepEqual(zipForecastHours(hourly, '2026-09-02T10:15').map(hour => hour.tempC), [20, 21])
  assert.deepEqual(zipForecastHours(hourly, '2026-09-03T10:00'), [])
})

test('distinguishes this weekend and next weekend questions', () => {
  assert.deepEqual(
    [parseDeterministicQuestion('Какво ще е времето този уикенд във Варна?').timeScope,
      parseDeterministicQuestion('Ще вали ли през уикенда в Париж?').timeScope,
      parseDeterministicQuestion('Каква е прогнозата следващия уикенд в Ню Йорк?').timeScope],
    ['this_weekend', 'this_weekend', 'next_weekend']
  )
})

test('weekends use the searched city local date and remain separate', () => {
  const instant = new Date('2026-10-03T02:00:00Z') // Friday in New York, Saturday in Tokyo.
  assert.deepEqual(weekendForecastDates('this_weekend', instant, 'America/New_York'), ['2026-10-03', '2026-10-04'])
  assert.deepEqual(weekendForecastDates('next_weekend', instant, 'America/New_York'), ['2026-10-10', '2026-10-11'])
  assert.deepEqual(weekendForecastDates('this_weekend', instant, 'Asia/Tokyo'), ['2026-10-03', '2026-10-04'])
  assert.deepEqual(weekendForecastDates('next_weekend', instant, 'Asia/Tokyo'), ['2026-10-10', '2026-10-11'])
})

test('on Sunday this weekend contains only the remaining local Sunday', () => {
  const sunday = new Date('2026-10-04T12:00:00Z')
  assert.deepEqual(weekendForecastDates('this_weekend', sunday, 'Europe/Sofia'), ['2026-10-04'])
  assert.deepEqual(weekendForecastDates('next_weekend', sunday, 'Europe/Sofia'), ['2026-10-10', '2026-10-11'])
})

test('weekend answer lists every exact date and never substitutes current conditions', () => {
  const understood = parseDeterministicQuestion('Ще вали ли през уикенда в Париж?')
  const answer = deterministicWeatherAnswer({
    location: 'Париж', current: { temperature_2m: 99 },
    requestedDates: ['2026-10-03', '2026-10-04'],
    targetDays: [{ date: '2026-10-03', code: 61, minC: 10, maxC: 16, rainChancePct: 70, rainMm: 4, maxWindKmh: 20 }]
  }, understood)
  assert.match(answer, /3 октомври 2026 г\..*минимална температура 10°C/s)
  assert.match(answer, /За 2026-10-04 няма налична прогноза/)
  assert.doesNotMatch(answer, /99°C|В момента/)
})
