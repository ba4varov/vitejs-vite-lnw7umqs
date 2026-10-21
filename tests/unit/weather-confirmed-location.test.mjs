import assert from 'node:assert/strict'
import test from 'node:test'
import { invoke, forecast } from '../helpers/weather-chat-harness.mjs'
import { geminiClient } from '../../server/gemini-client.js'

const places = [
  ['Варна', 'Varna', 43.2141, 27.9147],
  ['София', 'Sofia', 42.6977, 23.3219],
  ['Велико Търново', 'Veliko Tarnovo', 43.0757, 25.6172],
  ['Ню Йорк', 'New York', 40.7128, -74.006],
  ['Спрингфийлд', 'Springfield', 39.78, -89.65],
  ['Сен Етиен', 'Saint-Étienne', 45.44, 4.39]
]
let sequence = 0
const now = () => new Date(Date.parse('2026-10-08T00:00Z') + sequence++ * 60000).toISOString()
for (const lang of ['bg', 'en']) for (const [bg, en, latitude, longitude] of places) for (const topic of ['clothing', 'rain', 'forecast']) {
  const city = lang === 'bg' ? bg : en
  test(`confirmed selected identity ${lang}/${city}/${topic}`, async t => {
    const original = process.env.GEMINI_API_KEY
    process.env.GEMINI_API_KEY = 'fixture'
    t.after(() => { if (original === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = original })
    t.mock.method(console, 'info', () => {})
    const ai = t.mock.method(geminiClient, 'generate', () => assert.fail('confident grammar must not consume Gemini quota'))
    const message = lang === 'bg'
      ? `${topic === 'clothing' ? 'Как да се облека' : topic === 'rain' ? 'Ще вали ли' : 'Какво ще е времето'} днес във ${city}?`
      : `${topic === 'clothing' ? 'What should I wear' : topic === 'rain' ? 'Will it rain' : 'What is the weather'} today in ${city}?`
    // Duplicate names and slightly different geocoder coordinates cannot replace
    // an identity already selected through the site's location picker.
    const geo = [{ name: city, latitude: latitude + 0.02, longitude, country: 'Bulgaria' }, { name: city, latitude: 10, longitude: 20, country: 'Elsewhere' }]
    const result = await invoke(t, message, lang, { city, latitude, longitude }, forecast, now(), geo)
    assert.equal(result.body.needsClarification, false)
    assert.equal(result.body.context.city, city)
    assert.equal(result.body.context.latitude, latitude)
    assert.equal(result.body.context.longitude, longitude)
    assert.equal(ai.mock.callCount(), 0)
    assert.equal(result.calls.filter(url => url.hostname.startsWith('geocoding-')).length, 0)
    for (const url of result.calls) {
      assert.equal(Number(url.searchParams.get('latitude')), latitude)
      assert.equal(Number(url.searchParams.get('longitude')), longitude)
    }
  })
}

for (const lang of ['bg', 'en']) test(`different names and explicit qualifiers still disambiguate ${lang}`, async t => {
  const original = process.env.GEMINI_API_KEY
  delete process.env.GEMINI_API_KEY
  t.after(() => { if (original !== undefined) process.env.GEMINI_API_KEY = original })
  t.mock.method(console, 'info', () => {})
  const city = lang === 'bg' ? 'Варна' : 'Varna'
  const geo = [{ name: city, latitude: 43.21, longitude: 27.91, country: 'Bulgaria' }, { name: city, latitude: 41.036, longitude: -89.227, country: 'United States' }]
  const bare = await invoke(t, lang === 'bg' ? `Ще вали ли днес във ${city}?` : `Will it rain today in ${city}?`, lang, {}, forecast, now(), geo)
  assert.equal(bare.body.needsClarification, true)
  assert.ok(bare.calls.every(url => url.hostname.startsWith('geocoding-')))
  const qualified = await invoke(t, lang === 'bg' ? `Ще вали ли днес във ${city}, United States?` : `Will it rain today in ${city}, United States?`, lang, { city, latitude: 43.21, longitude: 27.91 }, forecast, now(), geo)
  assert.equal(qualified.body.needsClarification, false)
  assert.equal(qualified.body.context.latitude, 41.036)
})

for (const source of ['selected', 'context']) test(`explicit confirmed name survives stale ${source === 'selected' ? 'context' : 'selection'}`, async t => {
  const original = process.env.GEMINI_API_KEY
  delete process.env.GEMINI_API_KEY
  t.after(() => { if (original !== undefined) process.env.GEMINI_API_KEY = original })
  t.mock.method(console, 'info', () => {})
  const selected = source === 'selected' ? { city: 'Varna', latitude: 43.2141, longitude: 27.9147 } : { city: 'Sofia', latitude: 42.7, longitude: 23.3 }
  const context = { ...(source === 'context' ? { city: 'Varna', latitude: 43.2141, longitude: 27.9147 } : { city: 'Sofia', latitude: 42.7, longitude: 23.3 }), intent: 'rain', timeScope: 'today', targetDate: '2026-10-08', previousQuestion: 'Will it rain today?' }
  const { body, calls } = await invoke(t, 'Will it rain today in Varna?', 'en', { ...selected, context }, forecast, now(), [])
  assert.equal(body.needsClarification, false)
  assert.equal(body.context.latitude, 43.2141)
  assert.equal(body.context.longitude, 27.9147)
  assert.ok(calls.every(url => !url.hostname.startsWith('geocoding-')))
})
