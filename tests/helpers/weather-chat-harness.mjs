import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Execute the actual serverless handler; compilation is separately gated by tsc -b.
const filename = new URL('../../api/weather-chat.ts', import.meta.url)
const source = readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
  .replaceAll("'../server/weather-chat-core.js'", JSON.stringify(new URL('../../server/weather-chat-core.js', import.meta.url).href))
  .replaceAll("'../server/weather-chat-semantics.js'", JSON.stringify(new URL('../../server/weather-chat-semantics.js', import.meta.url).href))
  .replaceAll("'../server/weather-location-evidence.js'", JSON.stringify(new URL('../../server/weather-location-evidence.js', import.meta.url).href))
  .replaceAll("'../server/gemini-client.js'", JSON.stringify(new URL('../../server/gemini-client.js', import.meta.url).href))
  .replaceAll("'../server/weather-local-routing.js'", JSON.stringify(new URL('../../server/weather-local-routing.js', import.meta.url).href))
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
    assert.ok(new Set(['geocoding-api.open-meteo.com', 'api.open-meteo.com', 'archive-api.open-meteo.com', 'air-quality-api.open-meteo.com', 'marine-api.open-meteo.com']).has(parsed.hostname), `fixture-contract: unexpected upstream ${parsed.hostname}`)
    let payload = weatherPayload
    if (parsed.hostname.startsWith('geocoding-')) {
      const query = parsed.searchParams.get('name')
      const geoLang = parsed.searchParams.get('language') ?? lang
      const sofia = /^(София|Sofia)$/u.test(query)
      const plovdiv = /Пловдив|Plovdiv/iu.test(query)
      payload = { results: geoResults ?? [{ name: plovdiv ? (geoLang === 'bg' ? 'Пловдив' : 'Plovdiv') : sofia ? (geoLang === 'bg' ? 'София' : 'Sofia') : (geoLang === 'bg' ? 'Варна' : 'Varna'), latitude: plovdiv ? 42.14 : sofia ? 42.7 : 43.21, longitude: sofia ? 23.3 : 27.91, timezone: 'Europe/Sofia', country: 'Bulgaria', population: 300000 }] }
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
export { handler, forecast, daily, dates, times, invoke }
