import assert from 'node:assert/strict'
import test from 'node:test'
import { geminiClient, createGeminiClient } from '../../server/gemini-client.js'
import { invoke, forecast } from '../helpers/weather-chat-harness.mjs'
import { semanticFixture } from '../helpers/bobi-language-corpus.mjs'
import { efficiencyCorpus } from '../helpers/gemini-efficiency-corpus.mjs'

let sequence = 0
const now = () => new Date(Date.parse('2026-10-08T00:00:00Z') + sequence++ * 60000).toISOString()
const geo = item => [item.place, { name: item.lang === 'bg' ? 'София' : 'Sofia', latitude: 42.7, longitude: 23.3 }]
function setup(t) {
  const previous = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'efficiency-private-key'
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous })
  const logs = []
  t.mock.method(console, 'info', (...args) => logs.push(args))
  return logs
}
export function checkCoordinates(result, place) {
  assert.equal(result.body.needsClarification, false, JSON.stringify(result.body))
  assert.equal(result.body.context.latitude, place.latitude)
  assert.equal(result.body.context.longitude, place.longitude)
  const calls = result.calls.filter(url => !url.hostname.startsWith('geocoding-'))
  assert.ok(calls.some(url => url.hostname === 'api.open-meteo.com'))
  for (const url of calls) {
    assert.equal(Number(url.searchParams.get('latitude')), place.latitude)
    assert.equal(Number(url.searchParams.get('longitude')), place.longitude)
  }
}

for (const item of efficiencyCorpus()) test(`efficiency oracle ${item.lang}/${item.category}/${item.message}`, async t => {
  const logs = setup(t)
  let calls = 0
  t.mock.method(geminiClient, 'generate', async () => {
    calls++
    const value = semanticFixture({ intent: item.intent, requestedCity: item.citySource === 'context' ? null : item.place.name, citySource: item.citySource ?? 'explicit', timeScope: item.timeScope, targetDate: item.timeScope === 'specific_date' ? item.targetDate : null, timeSource: item.timeSource ?? 'explicit', turnType: item.context ? 'follow_up' : 'new_question' })
    return { payload: { candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }, model: 'fixture' }
  })
  const result = await invoke(t, item.message, item.lang, item.context ? { context: item.context } : {}, forecast, now(), geo(item))
  checkCoordinates(result, item.place)
  assert.equal(result.body.intent, item.intent)
  assert.equal(result.body.targetDate, item.targetDate)
  assert.equal(calls, item.local ? 0 : 1)
  const route = logs.find(([prefix]) => prefix === '[weather-chat:routing]')[1]
  assert.equal(route.savedGeminiCalls, item.local ? 1 : 0)
  assert.doesNotMatch(JSON.stringify(logs), /efficiency-private|Гела|Lake District|previousQuestion|latitude|longitude|41\.65|24\.5667/)
})

for (const item of efficiencyCorpus().filter(item => item.category === 'travel')) for (const mode of ['missing', '429']) test(`travel fallback ${item.lang}/${mode}/${item.message}`, async t => {
  setup(t)
  let calls = 0
  if (mode === 'missing') delete process.env.GEMINI_API_KEY
  else {
    const client = createGeminiClient({ env: { GEMINI_API_KEY: 'fixture', GEMINI_MODEL: 'gemini-2.5-flash' }, logger: () => {}, quota: { reserve: async () => ({ allowed: true }), block: async () => {} }, fetchImpl: async () => { calls++; return new Response(null, { status: 429 }) } })
    t.mock.method(geminiClient, 'generate', client.generate)
  }
  const context = { city: item.lang === 'bg' ? 'София' : 'Sofia', latitude: 42.7, longitude: 23.3, intent: 'rain', timeScope: 'today', targetDate: '2026-10-08', previousQuestion: 'Synthetic context' }
  const result = await invoke(t, item.message, item.lang, { context }, forecast, now(), geo(item))
  checkCoordinates(result, item.place)
  assert.equal(result.body.intent, item.intent)
  assert.equal(result.body.targetDate, item.targetDate)
  assert.equal(calls, mode === '429' ? 1 : 0)
  const followup = await invoke(t, item.lang === 'bg' ? 'А вятърът?' : 'And wind?', item.lang, { context: result.body.context }, forecast, now(), geo(item))
  checkCoordinates(followup, item.place)
  assert.equal(calls, mode === '429' ? 1 : 0)
})

test('repeated clear questions and different users never need an AI result cache', async t => {
  setup(t)
  t.mock.method(geminiClient, 'generate', () => assert.fail('clear repeated question called AI'))
  const dateNow = now()
  for (const place of [{ name: 'Гела', latitude: 41.65, longitude: 24.5667 }, { name: 'София', latitude: 42.7, longitude: 23.3 }, { name: 'Гела', latitude: 41.65, longitude: 24.5667 }]) {
    const result = await invoke(t, 'Ще вали ли утре?', 'bg', { city: place.name, latitude: place.latitude, longitude: place.longitude }, forecast, dateNow, [place])
    checkCoordinates(result, place)
  }
})

test('uncertain location goes to Gemini after geocoding fails; canonical name is independently verified', async t => {
  const logs = setup(t)
  let calls = 0
  t.mock.method(geminiClient, 'generate', async () => { calls++; return { payload: { candidates: [{ content: { parts: [{ text: JSON.stringify(semanticFixture({ intent: 'rain', requestedCity: 'Varna', citySource: 'explicit', timeScope: 'tomorrow', timeSource: 'explicit' })) }] } }] } } })
  const place = { name: 'Varna', latitude: 43.2141, longitude: 27.9147 }
  const result = await invoke(t, 'Will it rain in Varan tomorrow?', 'en', {}, forecast, now(), [place])
  checkCoordinates(result, place)
  assert.equal(calls, 1)
  assert.ok(logs.some(([, entry]) => entry.reason === 'unverified_location'))
})

for (const lang of ['bg', 'en']) for (const kind of ['missing', 'mismatch', 'ambiguous', 'invalid']) test(`travel evidence blocks wrong coordinates ${lang}/${kind}`, async t => {
  setup(t); delete process.env.GEMINI_API_KEY
  const name = lang === 'bg' ? 'Баня' : 'Springfield'
  const places = kind === 'missing' ? [] : kind === 'mismatch' ? [{ name: 'Sofia', latitude: 42.7, longitude: 23.3 }]
    : kind === 'invalid' ? [{ name, latitude: 91, longitude: 0 }]
      : [{ name, latitude: 39.8, longitude: -89.6, population: 1000 }, { name, latitude: 42.1, longitude: -72.6, population: 1000 }]
  const context = { city: lang === 'bg' ? 'София' : 'Sofia', latitude: 42.7, longitude: 23.3, intent: 'rain', timeScope: 'tomorrow', targetDate: '2026-10-09', previousQuestion: 'Synthetic context' }
  const result = await invoke(t, lang === 'bg' ? `Пътувам към ${name} утре как да се облека?` : `I am heading to ${name} tomorrow what should I wear?`, lang, { context }, forecast, now(), places)
  assert.equal(result.body.needsClarification, true)
  assert.equal(result.body.pendingClarification.missing, 'location')
  assert.ok(result.calls.every(url => url.hostname.startsWith('geocoding-')))
})

for (const message of ['Ще вали ли до утре?', 'Will it rain to 5 degrees?', 'Can I go for a walk tomorrow?']) test(`non-destinations are not travel places: ${message}`, async t => {
  setup(t); delete process.env.GEMINI_API_KEY
  const result = await invoke(t, message, /[а-я]/iu.test(message) ? 'bg' : 'en', {}, forecast, now())
  assert.equal(result.calls.filter(url => url.hostname.startsWith('geocoding-')).length, 0)
})

for (const [lang, message] of [['bg', 'Няма да отида до Гела утре как да се облека?'], ['en', 'I am not going to Lake District tomorrow what should I wear?']]) test(`negated travel cannot select the negated city ${lang}`, async t => {
  setup(t); delete process.env.GEMINI_API_KEY
  const result = await invoke(t, message, lang, {}, forecast, now(), [{ name: 'Гела', latitude: 41.65, longitude: 24.5667 }, { name: 'Lake District', latitude: 54.5, longitude: -3.1667 }])
  assert.equal(result.body.needsClarification, true)
  assert.equal(result.body.pendingClarification.missing, 'location')
  assert.equal(result.calls.length, 0)
})

test('identical complex messages with different contexts get separate AI interpretations', async t => {
  setup(t)
  let calls = 0
  t.mock.method(geminiClient, 'generate', async options => {
    calls++
    const input = JSON.parse(options.body.contents[0].parts[0].text)
    assert.ok(input.context)
    return { payload: { candidates: [{ content: { parts: [{ text: JSON.stringify(semanticFixture({ intent: 'clothing', turnType: 'follow_up', citySource: 'context', timeScope: 'tomorrow', timeSource: 'explicit' })) }] } }] } }
  })
  const dateNow = now()
  for (const place of [{ name: 'Гела', latitude: 41.65, longitude: 24.5667 }, { name: 'Sofia', latitude: 42.7, longitude: 23.3 }]) {
    const context = { city: place.name, latitude: place.latitude, longitude: place.longitude, intent: 'rain', timeScope: 'today', targetDate: '2026-10-08', previousQuestion: 'Synthetic context' }
    const result = await invoke(t, 'Will I need an extra layer there tomorrow?', 'en', { context }, forecast, dateNow, [place])
    checkCoordinates(result, place)
  }
  assert.equal(calls, 2)
})

for (const reason of ['daily_limit', 'cooldown', 'quota_unavailable', 'ai_disabled']) test(`real handler quota decision ${reason} falls back without Google`, async t => {
  const logs = setup(t)
  let google = 0
  const client = createGeminiClient({
    env: { GEMINI_API_KEY: 'fixture', GEMINI_MODEL: 'gemini-2.5-flash', ...(reason === 'ai_disabled' ? { GEMINI_DISABLED: 'true' } : {}) },
    logger: () => {}, quota: { reserve: async () => ({ allowed: false, reason }), block: async () => {} },
    fetchImpl: () => { google++; assert.fail('blocked AI contacted Google') }
  })
  t.mock.method(geminiClient, 'generate', client.generate)
  const place = { name: 'Гела', latitude: 41.65, longitude: 24.5667 }
  const result = await invoke(t, 'Моля кажи ще вали ли утре в Гела?', 'bg', {}, forecast, now(), [place])
  checkCoordinates(result, place)
  assert.equal(google, 0)
  assert.ok(logs.some(([prefix, entry]) => prefix === '[weather-chat:understanding]' && entry.reason === reason))
  assert.ok(logs.some(([prefix, entry]) => prefix === '[weather-chat:decision]' && entry.source === 'local'))
})
