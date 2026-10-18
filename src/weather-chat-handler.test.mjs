import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { parseUnderstanding, deterministicWeatherAnswer } from '../server/weather-chat-core.js'

// Execute the actual serverless handler; compilation is separately gated by tsc -b.
const filename = new URL('../api/weather-chat.ts', import.meta.url)
const source = readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
  .replaceAll("'../server/weather-chat-core.js'", JSON.stringify(new URL('../server/weather-chat-core.js', import.meta.url).href))
  .replaceAll("'../server/gemini-client.js'", JSON.stringify(new URL('../server/gemini-client.js', import.meta.url).href))
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const dates = Array.from({ length: 16 }, (_, i) => `2026-10-${String(8 + i).padStart(2, '0')}`)
const daily = time => ({ time, weather_code: time.map(() => 0), temperature_2m_min: time.map(() => 11), temperature_2m_max: time.map(() => 21), precipitation_sum: time.map(() => 0), precipitation_probability_max: time.map(() => 0), wind_speed_10m_max: time.map(() => 8), uv_index_max: time.map(() => 3) })
const times = dates.flatMap(date => Array.from({ length: 24 }, (_, i) => `${date}T${String(i).padStart(2, '0')}:00`))
const forecast = {
  timezone: 'Europe/Sofia', current: { time: '2026-10-08T12:00', temperature_2m: 17, apparent_temperature: 16, wind_speed_10m: 8 }, daily: daily(dates),
  hourly: { time: times, temperature_2m: times.map(() => 17), apparent_temperature: times.map(() => 16), precipitation: times.map(() => 0), precipitation_probability: times.map(() => 0), wind_speed_10m: times.map(() => 8), uv_index: times.map(() => 3), weather_code: times.map(() => 0) }
}
async function invoke(t, message, lang, extra = {}, weatherPayload = forecast, now = '2026-10-08T09:00:00Z', geoResults) {
  t.mock.timers.reset()
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(now) })
  const calls = []
  t.mock.method(globalThis, 'fetch', async url => {
    const parsed = new URL(url); calls.push(parsed)
    let payload = weatherPayload
    if (parsed.hostname.startsWith('geocoding-')) {
      const query = parsed.searchParams.get('name')
      const sofia = /^(София|Sofia)$/u.test(query)
      const plovdiv = /Пловдив|Plovdiv/iu.test(query)
      payload = { results: geoResults ?? [{ name: plovdiv ? (lang === 'bg' ? 'Пловдив' : 'Plovdiv') : sofia ? (lang === 'bg' ? 'София' : 'Sofia') : (lang === 'bg' ? 'Варна' : 'Varna'), latitude: plovdiv ? 42.14 : sofia ? 42.7 : 43.21, longitude: sofia ? 23.3 : 27.91, timezone: 'Europe/Sofia', country: 'Bulgaria', population: 300000 }] }
    }
    if (parsed.hostname.startsWith('archive-')) payload = { timezone: 'Europe/Sofia', daily: daily([parsed.searchParams.get('start_date')]) }
    if (parsed.hostname.startsWith('air-quality-')) payload = { current: { european_aqi: 12, pm10: 4, pm2_5: 2 } }
    if (parsed.hostname.startsWith('marine-')) payload = { current: { sea_surface_temperature: 20 } }
    return Response.json(payload)
  })
  let status = 200, body
  const response = { status(code) { status = code; return this }, json(value) { body = value } }
  await handler({ method: 'POST', body: { message, city: lang === 'bg' ? 'София' : 'Sofia', latitude: 42.7, longitude: 23.3, lang, ...extra } }, response)
  assert.equal(status, 200)
  return { body, calls }
}
const cases = [
  ['today', '2026-10-08', 'Какво ще е времето днес?', 'What is the weather today?'],
  ['tomorrow', '2026-10-09', 'Какво ще е времето утре?', 'What is the weather tomorrow?'],
  ['day_after_tomorrow', '2026-10-10', 'Какво ще е времето вдругиден?', 'What is the weather the day after tomorrow?'],
  ['yesterday', '2026-10-07', 'Какво беше времето вчера?', 'What was the weather yesterday?'],
  ['day_before_yesterday', '2026-10-06', 'Какво беше времето завчера?', 'What was the weather the day before yesterday?'],
  ['tomorrow_morning', '2026-10-09', 'Какво ще е времето утре сутрин?', 'What is the weather tomorrow morning?'],
  ['tomorrow_afternoon', '2026-10-09', 'Какво ще е времето утре следобед?', 'What is the weather tomorrow afternoon?'],
  ['tomorrow_evening', '2026-10-09', 'Какво ще е времето утре вечер?', 'What is the weather tomorrow evening?'],
  ['tomorrow_night', '2026-10-09', 'Какво ще е времето утре през нощта?', 'What is the weather tomorrow night?'],
  ['specific_date', '2026-10-12', 'Какво ще е времето на 12.10.2026?', 'What is the weather on 2026-10-12?'],
  ['this_weekend', null, 'Какво ще е времето този уикенд?', 'What is the weather this weekend?'],
  ['next_weekend', null, 'Какво ще е времето следващия уикенд?', 'What is the weather next weekend?']
]
for (const lang of ['bg', 'en']) for (const [scope, date, bg, en] of cases) {
  test(`serverless ${lang}: ${scope} retains date and forecast/archive routing`, async t => {
    const { body, calls } = await invoke(t, lang === 'bg' ? bg : en, lang)
    assert.equal(body.timeScope, scope)
    assert.equal(body.targetDate, date)
    assert.equal(body.needsClarification, false)
    assert.match(body.answer, lang === 'bg' ? /София/ : /Sofia/)
    assert.doesNotMatch(body.answer, /нямам|не успях|don't have|could not/i)
    const archive = calls.find(url => url.hostname.startsWith('archive-'))
    if (scope === 'yesterday' || scope === 'day_before_yesterday') assert.equal(archive?.searchParams.get('start_date'), date)
    else assert.equal(archive, undefined)
    if (scope.endsWith('weekend')) {
      const weekend = scope === 'this_weekend' ? ['10', '11'] : ['17', '18']
      for (const day of weekend) assert.match(body.answer, new RegExp(lang === 'bg' ? `${day} октомври 2026` : `2026-10-${day}`))
    }
  })
}
for (const lang of ['bg', 'en']) test(`serverless ${lang}: explicitly requested city uses its coordinates`, async t => {
  const { body, calls } = await invoke(t, lang === 'bg' ? 'Какво ще е времето утре във Варна?' : 'What is the weather tomorrow in Varna?', lang)
  assert.equal(body.targetDate, '2026-10-09')
  assert.match(body.answer, lang === 'bg' ? /Варна/ : /Varna/)
  const forecastCall = calls.find(url => url.hostname === 'api.open-meteo.com')
  assert.equal(forecastCall.searchParams.get('latitude'), '43.21')
  assert.equal(forecastCall.searchParams.get('longitude'), '27.91')
})
test('Gemini understanding without isQuick remains valid for the deterministic renderer', () => {
  const understood = parseUnderstanding({ intent: 'temperature', requestedCity: null, timeScope: 'yesterday', targetDate: '2026-10-07', needsClarification: false, clarificationQuestion: null }, 'en')
  assert.equal(Object.hasOwn(understood, 'isQuick'), false)
  assert.match(deterministicWeatherAnswer({ location: 'Sofia', historical: true, targetDay: { date: '2026-10-07', code: 0, minC: 11, maxC: 21, rainMm: 0, rainChancePct: null, maxWindKmh: 8 } }, understood, 'en'), /11.*21/)
})
test('serverless quick action remains valid', async t => {
  const { body } = await invoke(t, 'Should I take an umbrella?', 'en', { quickAction: 'umbrella' })
  assert.equal(body.intent, 'rain')
  assert.equal(body.needsClarification, false)
})

for (const lang of ['bg', 'en']) test(`conversation ${lang}: city, date and measure survive actual requests`, async t => {
  const first = await invoke(t, lang === 'bg' ? 'Ще вали ли утре във Варна?' : 'Will it rain tomorrow in Varna?', lang)
  assert.equal(first.body.context.city, lang === 'bg' ? 'Варна' : 'Varna')
  const second = await invoke(t, lang === 'bg' ? 'А вятърът?' : 'And wind?', lang, { context: first.body.context })
  assert.equal(second.body.context.city, first.body.context.city)
  assert.equal(second.body.intent, 'wind')
  assert.equal(second.body.targetDate, '2026-10-09')
  const third = await invoke(t, lang === 'bg' ? 'А вдругиден?' : 'And the day after tomorrow?', lang, { context: second.body.context })
  assert.equal(third.body.intent, 'wind')
  assert.equal(third.body.targetDate, '2026-10-10')
})

for (const lang of ['bg', 'en']) test(`conversation ${lang}: absent upstream measurements are explained`, async t => {
  const { body } = await invoke(t, lang === 'bg' ? 'Ще вали ли?' : 'Will it rain?', lang, {}, { timezone: 'Europe/Sofia' })
  assert.match(body.answer, lang === 'bg' ? /Нямам достатъчно/ : /don't have enough/)
  assert.doesNotMatch(body.answer, /0%|No umbrella|не е нужен/)
})
test('relative days follow the selected location timezone rather than UTC', async t => {
  const { body } = await invoke(t, 'And tomorrow?', 'en', {}, { ...forecast, timezone: 'Asia/Tokyo' }, '2026-10-08T23:30:00Z')
  assert.equal(body.targetDate, '2026-10-10')
})
test('message language changes the answer without changing interface settings', async t => {
  const { body } = await invoke(t, 'Каква е температурата утре?', 'en')
  assert.match(body.answer, /температурата/)
})

for (const lang of ['bg', 'en']) test(`weekday follow-up ${lang}: inherits resolved city and measure without geocoding weekday`, async t => {
  const first = await invoke(t, lang === 'bg' ? 'Ще вали ли утре във Варна?' : 'Will it rain tomorrow in Varna?', lang)
  const { body, calls } = await invoke(t, lang === 'bg' ? 'А в неделя?' : 'What about Monday?', lang, { context: first.body.context })
  assert.equal(body.intent, 'rain')
  assert.equal(body.context.city, first.body.context.city)
  assert.equal(body.targetDate, lang === 'bg' ? '2026-10-11' : '2026-10-12')
  assert.equal(calls.some(url => url.hostname.startsWith('geocoding-')), false)
  assert.equal(calls.find(url => url.hostname === 'api.open-meteo.com').searchParams.get('latitude'), '43.21')
})
for (const lang of ['bg', 'en']) test(`weekday ${lang}: selected timezone decides whether Sunday is today or next week`, async t => {
  const { body } = await invoke(t, lang === 'bg' ? 'Времето в неделя?' : 'Weather on Sunday?', lang, {}, { ...forecast, timezone: 'Asia/Tokyo' }, '2026-10-11T23:30:00Z')
  assert.equal(body.targetDate, '2026-10-18')
})
for (const lang of ['bg', 'en']) for (const missing of ['precipitation', 'precipitation_probability']) test(`partial rain ${lang}: absent ${missing} does not justify a dry verdict`, async t => {
  const hourly = { ...forecast.hourly, [missing]: undefined }
  const { body } = await invoke(t, lang === 'bg' ? 'Трябва ли ми чадър?' : 'Should I take an umbrella?', lang, {}, { ...forecast, hourly })
  assert.match(body.answer, lang === 'bg' ? /непълни/ : /incomplete/)
  assert.doesNotMatch(body.answer, /No umbrella|не е нужен чадър/)
})

for (const lang of ['bg', 'en']) {
  for (const general of [false, true]) test(`clarification handler ${lang}: city then ${general ? 'general forecast' : 'wind'}`, async t => {
    const first = await invoke(t, lang === 'bg' ? 'Какъв ще е вятърът утре във Варна?' : 'What will the wind be tomorrow in Varna?', lang)
    const second = await invoke(t, lang === 'bg' ? 'А в Пловдив?' : 'And in Plovdiv?', lang, { context: first.body.context })
    assert.equal(second.calls.length, 0)
    assert.equal(second.body.pendingClarification.understanding.requestedCity, lang === 'bg' ? 'Пловдив' : 'Plovdiv')
    const third = await invoke(t, general ? (lang === 'bg' ? 'Общата прогноза' : 'The general forecast') : (lang === 'bg' ? 'За вятъра' : 'For wind'), lang, { context: first.body.context, pendingClarification: second.body.pendingClarification })
    assert.equal(third.body.intent, general ? 'general_weather' : 'wind')
    assert.equal(third.body.targetDate, '2026-10-09')
    assert.equal(third.body.context.city, lang === 'bg' ? 'Пловдив' : 'Plovdiv')
    assert.equal(third.calls.find(url => url.hostname === 'api.open-meteo.com').searchParams.get('latitude'), '42.14')
    assert.equal(third.body.needsClarification, false)
  })
  test(`clarification handler ${lang}: no context, direct question, cancellation`, async t => {
    const first = await invoke(t, lang === 'bg' ? 'А в Пловдив?' : 'And in Plovdiv?', lang)
    assert.equal(first.calls.length, 0)
    assert.ok(first.body.pendingClarification)
    const direct = await invoke(t, lang === 'bg' ? 'Ще вали ли утре в Пловдив?' : 'Will it rain tomorrow in Plovdiv?', lang, { pendingClarification: first.body.pendingClarification })
    assert.equal(direct.body.intent, 'rain')
    assert.equal(direct.body.context.city, lang === 'bg' ? 'Пловдив' : 'Plovdiv')
    assert.equal(direct.body.needsClarification, false)
    const unrelated = await invoke(t, lang === 'bg' ? 'Напиши код' : 'Write code', lang, { pendingClarification: first.body.pendingClarification })
    assert.equal(unrelated.body.intent, 'unrelated')
    assert.equal(unrelated.body.pendingClarification, undefined)
    assert.equal(unrelated.calls.length, 0)
  })
  test(`clarification handler ${lang}: date reply keeps city, wind and destination timezone`, async t => {
    const first = await invoke(t, lang === 'bg' ? 'Вятърът следващата седмица в Пловдив?' : 'Wind next week in Plovdiv?', lang)
    assert.equal(first.calls.length, 0)
    const next = await invoke(t, lang === 'bg' ? 'За утре' : 'For tomorrow', lang, { pendingClarification: first.body.pendingClarification }, { ...forecast, timezone: 'Asia/Tokyo' }, '2026-10-08T23:30:00Z')
    assert.equal(next.body.intent, 'wind')
    assert.equal(next.body.context.city, lang === 'bg' ? 'Пловдив' : 'Plovdiv')
    assert.equal(next.body.targetDate, '2026-10-10')
  })
  test(`clarification handler ${lang}: ambiguous city requires qualifier, never forecast until resolved`, async t => {
    const results = [
      { name: 'Springfield', latitude: 39.8, longitude: -89.6, admin1: 'Illinois', country: 'United States', population: 100000 },
      { name: 'Springfield', latitude: 42.1, longitude: -72.6, admin1: 'Massachusetts', country: 'United States', population: 100000 }
    ]
    const first = await invoke(t, lang === 'bg' ? 'Вятърът утре в Springfield?' : 'Wind tomorrow in Springfield?', lang, {}, forecast, undefined, results)
    assert.equal(first.body.pendingClarification.missing, 'location')
    assert.equal(first.calls.length, 1)
    const stillAmbiguous = await invoke(t, 'United States', lang, { pendingClarification: first.body.pendingClarification }, forecast, undefined, results)
    assert.equal(stillAmbiguous.body.pendingClarification.missing, 'location')
    assert.equal(stillAmbiguous.calls.length, 1)
    const next = await invoke(t, 'Massachusetts', lang, { pendingClarification: stillAmbiguous.body.pendingClarification }, forecast, undefined, results)
    assert.equal(next.body.intent, 'wind')
    assert.equal(next.body.targetDate, '2026-10-09')
    assert.equal(next.calls.find(url => url.hostname === 'api.open-meteo.com').searchParams.get('latitude'), '42.1')
  })
}

for (const lang of ['bg', 'en']) test(`clarification handler ${lang}: unknown city can be corrected without losing intent/date`, async t => {
  const first = await invoke(t, lang === 'bg' ? 'Вятърът утре в Typocity?' : 'Wind tomorrow in Typocity?', lang, {}, forecast, undefined, [])
  assert.equal(first.calls.length, 1)
  assert.equal(first.body.pendingClarification.locationMode, 'name')
  const next = await invoke(t, 'Plovdiv', lang, { pendingClarification: first.body.pendingClarification })
  assert.equal(next.body.intent, 'wind')
  assert.equal(next.body.targetDate, '2026-10-09')
  assert.equal(next.calls.find(url => url.hostname === 'api.open-meteo.com').searchParams.get('latitude'), '42.14')
})

for (const lang of ['bg', 'en']) for (const available of [true, false]) test(`next Sunday conversation ${lang}, available=${available}`, async t => {
  const now = '2026-10-18T12:00:00Z'
  const payload = { ...forecast, daily: daily(available ? [...dates, '2026-10-25'] : dates) }
  const ask = (message, context) => invoke(t, message, lang, context ? { context } : {}, payload, now)
  const first = await ask(lang === 'bg' ? 'Ще вали ли във Варна?' : 'Will it rain in Varna?')
  const sunday = await ask(lang === 'bg' ? 'А в неделя?' : 'And on Sunday?', first.body.context)
  assert.equal(sunday.body.context.targetDate, '2026-10-18')
  let previous = sunday.body.context
  for (const [message, intent] of (lang === 'bg' ? [
    ['А в следващата неделя?', 'rain'], ['А вятърът?', 'wind'], ['А в София?', 'wind'], ['Как да се облека?', 'clothing']
  ] : [
    ['Next Sunday?', 'rain'], ['And wind?', 'wind'], ['And in Sofia?', 'wind'], ['What should I wear?', 'clothing']
  ])) {
    let { body, calls } = await ask(message, previous)
    if (/София|Sofia/u.test(message)) {
      assert.equal(body.needsClarification, true)
      assert.equal(calls.length, 0)
      ;({ body, calls } = await invoke(t, lang === 'bg' ? 'За вятъра' : 'For wind', lang, { context: previous, pendingClarification: body.pendingClarification }, payload, now))
    }
    assert.equal(body.context.targetDate, '2026-10-25')
    assert.equal(body.intent, intent)
    if (/София|Sofia/u.test(message)) {
      assert.equal(body.context.city, lang === 'bg' ? 'София' : 'Sofia')
      assert.equal(body.context.latitude, 42.7)
    } else {
      assert.equal(body.context.city, previous.city)
      assert.equal(calls.some(url => url.hostname.startsWith('geocoding-')), false)
    }
    if (!available) {
      assert.match(body.answer, lang === 'bg' ? /няма надеждна прогноза/ : /reliable forecast.*not available/)
      assert.doesNotMatch(body.answer, /°|км\/ч|km\/h|%/)
    }
    previous = body.context
  }
})
