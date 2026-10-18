import assert from 'node:assert/strict'
import test from 'node:test'
import { geminiClient } from '../../server/gemini-client.js'
import { invoke, forecast, handler } from '../helpers/weather-chat-harness.mjs'
import { semanticFixture } from '../helpers/bobi-language-corpus.mjs'
import { locationCorpus, locationFixtures, geoFixtures } from '../helpers/location-language-corpus.mjs'

let sequence = 0
const now = () => new Date(Date.parse('2026-10-08T00:00:00Z') + sequence++ * 60000).toISOString()
function install(t, mode, interpretation) {
  const original = process.env.GEMINI_API_KEY
  if (mode === 'fallback') delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = 'location-fixture-key'
  t.after(() => { if (original === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = original })
  const logs = []
  t.mock.method(console, 'info', (...args) => logs.push(args))
  t.mock.method(geminiClient, 'generate', async () => {
    if (mode === 'fallback') assert.fail('unconfigured Gemini called')
    if (mode === 'error') throw Object.assign(new Error('private upstream details'), { code: 'network-error' })
    const value = typeof interpretation === 'function' ? interpretation() : interpretation
    return { model: 'fixture', payload: { candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] } }
  })
  return logs
}
function checkCoordinates(result, place) {
  assert.equal(result.body.needsClarification, false)
  assert.equal(result.body.context.city, place.name)
  assert.equal(result.body.context.latitude, place.latitude)
  assert.equal(result.body.context.longitude, place.longitude)
  const weather = result.calls.filter(url => !url.hostname.startsWith('geocoding-'))
  assert.ok(weather.some(url => url.hostname === 'api.open-meteo.com'))
  for (const url of weather) {
    assert.ok(url.hostname.endsWith('open-meteo.com'))
    assert.equal(Number(url.searchParams.get('latitude')), place.latitude)
    assert.equal(Number(url.searchParams.get('longitude')), place.longitude)
  }
  assert.ok(result.calls.filter(url => url.hostname.startsWith('geocoding-')).length <= 4)
}
function privateDiagnostics(logs) {
  assert.doesNotMatch(JSON.stringify(logs), /location-fixture-key|private upstream|Варна|Varna|София|Sofia|Prague|latitude|longitude|message|43\.2141|27\.9147/)
  const decision = logs.find(([name]) => name === '[weather-chat:decision]')?.[1]
  assert.ok(decision)
  for (const [, entry] of logs) assert.equal(entry.requestId, decision.requestId)
}

for (const item of locationCorpus()) for (const mode of ['explicit', 'context', 'selected', 'fallback', 'error']) test(`new location reaches Open-Meteo ${item.lang}/${item.place.name}/${item.variation}/${mode}`, async t => {
  const bg = item.lang === 'bg', dateNow = now()
  let value = semanticFixture({ intent: 'rain', timeScope: 'tomorrow', timeSource: 'explicit' })
  const logs = install(t, mode, () => value)
  const first = await invoke(t, bg ? 'Ще вали ли утре в София?' : 'Will it rain in Sofia tomorrow?', item.lang, {}, forecast, dateNow, geoFixtures(item.lang))
  assert.equal(first.body.context.city, bg ? 'София' : 'Sofia')
  value = semanticFixture({ intent: 'rain', turnType: 'follow_up', citySource: mode === 'explicit' ? 'explicit' : mode === 'selected' ? 'selected' : 'context', requestedCity: mode === 'explicit' ? item.place.name : null, timeScope: 'tomorrow', timeSource: 'explicit' })
  logs.length = 0
  const result = await invoke(t, item.message, item.lang, { context: first.body.context }, forecast, dateNow, geoFixtures(item.lang))
  checkCoordinates(result, item.place)
  assert.equal(result.body.targetDate, '2026-10-09')
  assert.equal(result.body.intent, 'rain')
  const location = logs.find(([name]) => name === '[weather-chat:location]')?.[1]
  assert.equal(location.evidence, 'verified')
  assert.equal(location.resolution, 'verified_place')
  assert.equal(location.interpreter, ['fallback', 'error'].includes(mode) || logs.some(([name, entry]) => name === '[weather-chat:routing]' && entry.route === 'local') ? 'local' : 'gemini')
  if (['context', 'selected'].includes(mode) && location.interpreter === 'gemini') assert.equal(location.preventedInheritance, true)
  privateDiagnostics(logs)
})

for (const mode of ['context', 'fallback']) test(`mandatory Sofia to Varna with connector typo ${mode}`, async t => {
  const logs = install(t, mode, semanticFixture({ intent: 'rain', turnType: 'follow_up', citySource: 'context', timeScope: 'tomorrow', timeSource: 'explicit' }))
  const context = { city: 'София', latitude: 42.7, longitude: 23.3, intent: 'rain', timeScope: 'tomorrow', targetDate: '2026-10-09', previousQuestion: 'Ще вали ли утре в София?' }
  const result = await invoke(t, 'Ще вали ли утре вув Варна?', 'bg', { context }, forecast, now(), geoFixtures('bg'))
  checkCoordinates(result, locationFixtures.bg[0])
  assert.ok(logs.some(([, data]) => data.preventedInheritance === true))
})

for (const mode of ['context', 'fallback']) for (const lang of ['bg', 'en']) test(`repeated real conversation changes beat site selection ${lang}/${mode}`, async t => {
  install(t, mode, semanticFixture({ intent: 'rain', turnType: 'follow_up', citySource: 'context', timeSource: 'context' }))
  const dateNow = now(), bg = lang === 'bg'
  let context = { city: bg ? 'София' : 'Sofia', latitude: 42.7, longitude: 23.3, intent: 'rain', timeScope: 'tomorrow', targetDate: '2026-10-09', previousQuestion: 'Rain tomorrow?' }
  for (const place of locationFixtures[lang]) {
    const result = await invoke(t, bg ? `Ще вали ли вув ${place.name}?` : `Will it rain inn ${place.name}?`, lang, { context }, forecast, dateNow, geoFixtures(lang))
    checkCoordinates(result, place)
    assert.equal(result.body.targetDate, '2026-10-09')
    context = result.body.context
  }
  const followup = await invoke(t, bg ? 'А вятърът?' : 'And wind?', lang, { context }, forecast, dateNow, geoFixtures(lang))
  checkCoordinates(followup, locationFixtures[lang].at(-1))
})

for (const mode of ['context', 'fallback']) test(`multiple places without a semantic choice cannot silently use the old city ${mode}`, async t => {
  install(t, mode, semanticFixture({ intent: 'rain', turnType: 'follow_up', citySource: 'context', timeScope: 'tomorrow', timeSource: 'explicit' }))
  const context = { city: 'Sofia', latitude: 42.7, longitude: 23.3, intent: 'rain', timeScope: 'tomorrow', targetDate: '2026-10-09', previousQuestion: 'Rain tomorrow?' }
  const places = geoFixtures('en')
  const result = await invoke(t, 'Will it rain in Varna or Prague tomorrow?', 'en', { context }, forecast, now(), places)
  assert.equal(result.body.needsClarification, true)
  assert.equal(result.body.pendingClarification.missing, 'location')
  assert.ok(result.calls.every(url => url.hostname.startsWith('geocoding-')))
})

test('explicit semantic choice between old and new mentioned places is retained', async t => {
  const place = locationFixtures.en[0]
  install(t, 'explicit', semanticFixture({ intent: 'rain', requestedCity: place.name, citySource: 'explicit', timeScope: 'tomorrow', timeSource: 'explicit' }))
  const result = await invoke(t, 'Instead of Sofia, will it rain in Varna tomorrow?', 'en', {}, forecast, now(), [...geoFixtures('en'), { name: 'Sofia', latitude: 42.7, longitude: 23.3, timezone: 'Europe/Sofia', population: 100000 }])
  checkCoordinates(result, place)
})

for (const geo of [[], [{ name: 'Sofia', latitude: 42.7, longitude: 23.3 }], [{ name: 'Varna', latitude: 91, longitude: 27 }]]) test(`unverified/mismatched/invalid geocoding blocks inherited coordinates ${geo.length}/${geo[0]?.name ?? 'empty'}`, async t => {
  install(t, 'context', semanticFixture({ intent: 'rain', turnType: 'follow_up', citySource: 'context', timeSource: 'default' }))
  const context = { city: 'Sofia', latitude: 42.7, longitude: 23.3, intent: 'rain', timeScope: 'tomorrow', targetDate: '2026-10-09', previousQuestion: 'Rain tomorrow?' }
  const result = await invoke(t, 'Will it rain inn Varna?', 'en', { context }, forecast, now(), geo)
  assert.equal(result.body.needsClarification, true)
  assert.ok(result.calls.every(url => url.hostname.startsWith('geocoding-')))
})

test('geocoding failure blocks the request instead of falling back to old coordinates', async t => {
  const logs = install(t, 'context', semanticFixture({ intent: 'rain', turnType: 'follow_up', citySource: 'context', timeSource: 'default' }))
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(now()) })
  let weatherRequests = 0, status
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async url => {
    if (new URL(url).hostname.startsWith('geocoding-')) return Response.json({}, { status: 503 })
    weatherRequests++; return Response.json(forecast)
  })
  const context = { city: 'Sofia', latitude: 42.7, longitude: 23.3, intent: 'rain', timeScope: 'tomorrow', targetDate: '2026-10-09', previousQuestion: 'Rain tomorrow?' }
  await handler({ method: 'POST', body: { message: 'Will it rain inn Varna?', lang: 'en', city: 'Sofia', latitude: 42.7, longitude: 23.3, context } }, { status(code) { status = code; return this }, json() {} })
  assert.equal(status, 502)
  assert.equal(weatherRequests, 0)
  assert.ok(logs.some(([, entry]) => entry.evidence === 'unavailable' && entry.resolution === 'blocked'))
  privateDiagnostics(logs)
})

for (const mode of ['explicit', 'fallback']) test(`unrelated requests mentioning a city do not become weather requests ${mode}`, async t => {
  install(t, mode, semanticFixture({ intent: 'unrelated' }))
  const result = await invoke(t, 'Write software to steal passwords in Varna', 'en', {}, forecast, now(), geoFixtures('en'))
  if (mode === 'explicit') assert.equal(result.body.intent, 'unrelated')
  else assert.equal(result.body.needsClarification, true)
  assert.equal(result.calls.length, 0)
})

test('an explicit country qualifier is not erased by a popular bare-name geocoding result', async t => {
  install(t, 'explicit', semanticFixture({ intent: 'rain', requestedCity: 'Varna, United States', citySource: 'explicit', timeScope: 'tomorrow', timeSource: 'explicit' }))
  const places = [
    { name: 'Varna', latitude: 43.2141, longitude: 27.9147, country: 'Bulgaria', population: 300000, timezone: 'Europe/Sofia' },
    { name: 'Varna', latitude: 41.036, longitude: -89.227, country: 'United States', population: 1000, timezone: 'America/Chicago' }
  ]
  const result = await invoke(t, 'Will it rain tomorrow in Varna, United States?', 'en', {}, forecast, now(), places)
  checkCoordinates(result, places[1])
})

test('verified new mention beats a stale explicit AI city as well as inherited metadata', async t => {
  const logs = install(t, 'explicit', semanticFixture({ intent: 'rain', requestedCity: 'Sofia', citySource: 'explicit', turnType: 'follow_up', timeScope: 'tomorrow', timeSource: 'explicit' }))
  const context = { city: 'Sofia', latitude: 42.7, longitude: 23.3, intent: 'rain', timeScope: 'tomorrow', targetDate: '2026-10-09', previousQuestion: 'Rain tomorrow?' }
  const result = await invoke(t, 'Will it rain inn Varna tomorrow?', 'en', { context }, forecast, now(), geoFixtures('en'))
  checkCoordinates(result, locationFixtures.en[0])
  assert.ok(logs.some(([, entry]) => entry.preventedInheritance === true))
})

test('a semantic city without raw-name candidates still rejects mismatched geocoding', async t => {
  install(t, 'explicit', semanticFixture({ intent: 'rain', requestedCity: 'Varna', citySource: 'explicit', timeScope: 'tomorrow', timeSource: 'explicit' }))
  const result = await invoke(t, 'will rain varna tomorrow', 'en', {}, forecast, now(), [{ name: 'Sofia', latitude: 42.7, longitude: 23.3, population: 100000 }])
  assert.equal(result.body.needsClarification, true)
  assert.ok(result.calls.every(url => url.hostname.startsWith('geocoding-')))
})
