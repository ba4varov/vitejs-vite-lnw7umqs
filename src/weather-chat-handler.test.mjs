import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { parseUnderstanding, deterministicWeatherAnswer } from '../api/weather-chat-core.js'

// Execute the actual serverless handler; compilation is separately gated by tsc -b.
const filename = new URL('../api/weather-chat.ts', import.meta.url)
const source = readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
  .replaceAll("'./weather-chat-core.js'", JSON.stringify(new URL('../api/weather-chat-core.js', import.meta.url).href))
  .replaceAll("'./gemini-client.js'", JSON.stringify(new URL('../api/gemini-client.js', import.meta.url).href))
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const dates = Array.from({ length: 16 }, (_, i) => `2026-10-${String(8 + i).padStart(2, '0')}`)
const daily = time => ({ time, weather_code: time.map(() => 0), temperature_2m_min: time.map(() => 11), temperature_2m_max: time.map(() => 21), precipitation_sum: time.map(() => 0), precipitation_probability_max: time.map(() => 0), wind_speed_10m_max: time.map(() => 8), uv_index_max: time.map(() => 3) })
const times = dates.flatMap(date => Array.from({ length: 24 }, (_, i) => `${date}T${String(i).padStart(2, '0')}:00`))
const forecast = {
  timezone: 'Europe/Sofia', current: { time: '2026-10-08T12:00', temperature_2m: 17, apparent_temperature: 16, wind_speed_10m: 8 }, daily: daily(dates),
  hourly: { time: times, temperature_2m: times.map(() => 17), apparent_temperature: times.map(() => 16), precipitation: times.map(() => 0), precipitation_probability: times.map(() => 0), wind_speed_10m: times.map(() => 8), uv_index: times.map(() => 3), weather_code: times.map(() => 0) }
}
async function invoke(t, message, lang, extra = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-08T09:00:00Z') })
  const calls = []
  t.mock.method(globalThis, 'fetch', async url => {
    const parsed = new URL(url); calls.push(parsed)
    let payload = forecast
    if (parsed.hostname.startsWith('geocoding-')) payload = { results: [{ name: lang === 'bg' ? 'Варна' : 'Varna', latitude: 43.21, longitude: 27.91, timezone: 'Europe/Sofia', country: 'Bulgaria', population: 300000 }] }
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
