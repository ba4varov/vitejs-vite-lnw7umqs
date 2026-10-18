import assert from 'node:assert/strict'
import test from 'node:test'
import { geminiClient } from '../../server/gemini-client.js'
import { invoke, forecast } from '../helpers/weather-chat-harness.mjs'
import { semanticFixture } from '../helpers/bobi-language-corpus.mjs'

let sequence = 0
const places = [
  { lang: 'bg', name: 'Пампорово', latitude: 41.65, longitude: 24.6833, feature_code: 'RSTN' },
  { lang: 'bg', name: 'Гела', latitude: 41.65, longitude: 24.5667, feature_code: 'PPL' },
  { lang: 'en', name: 'Lake District', latitude: 54.5, longitude: -3.1667, feature_code: 'RGN' },
  { lang: 'en', name: 'New York', latitude: 40.7143, longitude: -74.006, feature_code: 'PPL' }
]
const topics = {
  bg: [['clothing', 'как да се облека'], ['walk', 'подходящо ли е за разходка'], ['rain', 'ще вали ли'], ['temperature', 'колко градуса ще е']],
  en: [['clothing', 'what should I wear'], ['walk', 'can I go for a walk'], ['rain', 'will it rain'], ['temperature', 'what will the temperature be']]
}
function setup(t, mode, value) {
  const key = process.env.GEMINI_API_KEY
  if (mode === 'fallback') delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = 'word-order-fixture'
  t.after(() => { if (key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = key })
  t.mock.method(console, 'info', () => {})
  t.mock.method(geminiClient, 'generate', async () => ({ payload: { candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }, model: 'fixture' }))
}
function coordinates(result, place) {
  assert.equal(result.body.needsClarification, false, JSON.stringify(result.body))
  const requests = result.calls.filter(url => !url.hostname.startsWith('geocoding-'))
  assert.ok(requests.some(url => url.hostname === 'api.open-meteo.com'))
  for (const url of requests) {
    assert.equal(Number(url.searchParams.get('latitude')), place.latitude)
    assert.equal(Number(url.searchParams.get('longitude')), place.longitude)
  }
  assert.equal(result.body.context.latitude, place.latitude)
  assert.equal(result.body.context.longitude, place.longitude)
}
for (const place of places) for (const [intent, question] of topics[place.lang]) for (const mode of ['explicit', 'context', 'fallback']) for (const order of ['before', 'after']) test(`word order ${place.name}/${intent}/${mode}/${order}`, async t => {
  setup(t, mode, semanticFixture({ intent, requestedCity: mode === 'explicit' ? place.name : null, citySource: mode === 'explicit' ? 'explicit' : 'context', turnType: 'follow_up', timeScope: 'specific_date', targetDate: '2026-10-11', timeSource: 'explicit' }))
  const bg = place.lang === 'bg'
  const message = order === 'before'
    ? bg ? `В неделя ще съм в ${place.name} ${question}` : `On Sunday I will be in ${place.name} ${question}`
    : bg ? `${question} в ${place.name} в неделя?` : `${question} in ${place.name} on Sunday?`
  const now = new Date(Date.parse('2026-10-08T09:00:00Z') + sequence++ * 60000).toISOString()
  const context = { city: bg ? 'София' : 'Sofia', latitude: 42.7, longitude: 23.3, intent: 'rain', timeScope: 'today', targetDate: '2026-10-08', previousQuestion: 'Rain?' }
  const result = await invoke(t, message, place.lang, { context }, forecast, now, [place])
  coordinates(result, place)
  assert.equal(result.body.targetDate, '2026-10-11')
  const followup = await invoke(t, bg ? 'А вятърът?' : 'And wind?', place.lang, { context: result.body.context }, forecast, now, [place])
  coordinates(followup, place)
})

for (const mode of ['explicit', 'fallback']) for (const lang of ['bg', 'en']) test(`real geographical ambiguity blocks weather ${lang}/${mode}`, async t => {
  const name = lang === 'bg' ? 'Баня' : 'Springfield'
  setup(t, mode, semanticFixture({ intent: 'clothing', citySource: 'explicit', requestedCity: name, timeScope: 'tomorrow', timeSource: 'explicit' }))
  const geo = [{ name, latitude: 42.5, longitude: 24.5, population: 1000, admin1: 'A' }, { name, latitude: 43.5, longitude: 25.5, population: 1000, admin1: 'B' }]
  const message = lang === 'bg' ? `Утре ще съм в ${name} как да се облека` : `Tomorrow I will be in ${name} what should I wear`
  const result = await invoke(t, message, lang, {}, forecast, new Date(Date.parse('2026-10-09T00:00:00Z') + sequence++ * 60000).toISOString(), geo)
  assert.equal(result.body.needsClarification, true)
  assert.ok(result.calls.every(url => url.hostname.startsWith('geocoding-')))
})

for (const mode of ['explicit', 'fallback']) for (const order of ['before', 'after']) test(`production wording without prior context ${mode}/${order}`, async t => {
  const place = places[0]
  setup(t, mode, semanticFixture({ intent: 'clothing', citySource: 'explicit', requestedCity: place.name, timeScope: 'specific_date', targetDate: '2026-10-11', timeSource: 'explicit' }))
  const message = order === 'before' ? 'В неделя ще съм в Пампорово как да се облека' : 'Как да се облека в Пампорово в неделя?'
  const result = await invoke(t, message, 'bg', {}, forecast, new Date(Date.parse('2026-10-10T00:00:00Z') + sequence++ * 60000).toISOString(), [place])
  coordinates(result, place)
})
