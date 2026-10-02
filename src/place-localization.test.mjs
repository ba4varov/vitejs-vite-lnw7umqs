import test from 'node:test'
import assert from 'node:assert/strict'
import { localizePlace } from './place-localization.js'
import { createLocalizationGuard } from './place-localization-core.js'

const varna = {
  bg: { id: 726050, name: 'Варна', latitude: 43.2167, longitude: 27.9167, country_code: 'BG', country: 'България', admin1_id: 726051, admin1: 'Област Варна' },
  en: { id: 726050, name: 'Varna', latitude: 43.2167, longitude: 27.9167, country_code: 'BG', country: 'Bulgaria', admin1_id: 726051, admin1: 'Varna' }
}

function response(data) { return { ok: true, json: async () => data } }
function geocoder(extra = {}) {
  const calls = []
  const fetcher = async url => {
    calls.push(url)
    const parsed = new URL(url), language = parsed.searchParams.get('language')
    if (parsed.pathname.endsWith('/get')) return response((extra.get || varna)[language])
    return response({ results: [(extra.search || varna)[language]] })
  }
  return { calls, fetcher }
}

test('actual localization resolves a legacy Bulgarian record before requesting its English label', async () => {
  const api = geocoder()
  const place = { name: 'Варна', region: 'Област Варна', country: 'България', lat: 43.2167, lon: 27.9167 }
  const localized = await localizePlace(place, 'en', { fetcher: api.fetcher, storage: null })
  assert.equal(localized.geonameId, 726050)
  assert.deepEqual([localized.name, localized.region, localized.country], ['Varna', 'Varna', 'Bulgaria'])
  assert.match(api.calls.at(-1), /\/get\?id=726050&language=en/)
})

test('localizes a stored Varna favorite whose region omits the Bulgarian administrative prefix', async () => {
  const api = geocoder()
  const place = { name: 'Варна', region: 'Варна', country: 'България', lat: 43.2141, lon: 27.9147 }
  const localized = await localizePlace(place, 'en', { fetcher: api.fetcher, storage: null })

  assert.deepEqual([localized.name, localized.region, localized.country], ['Varna', 'Varna', 'Bulgaria'])
  assert.equal(localized.geonameId, 726050)
})

test('actual localization resolves a legacy English record through Bulgarian metadata', async () => {
  const api = geocoder()
  const place = { name: 'Varna', region: 'Varna', country: 'Bulgaria', lat: 43.2167, lon: 27.9167 }
  const localized = await localizePlace(place, 'bg', { fetcher: api.fetcher, storage: null })
  assert.deepEqual([localized.geonameId, localized.name, localized.region, localized.country], [726050, 'Варна', 'Област Варна', 'България'])
})

test('bg to en to bg reuses the established identity without another name search', async () => {
  const api = geocoder(), storage = new Map()
  const cache = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }
  const original = { name: 'Варна', region: 'Област Варна', country: 'България', lat: 43.2167, lon: 27.9167 }
  const english = await localizePlace(original, 'en', { fetcher: api.fetcher, storage: cache })
  const persistent = { ...original, geonameId: english.geonameId, countryCode: english.countryCode, admin1Id: english.admin1Id }
  const bulgarian = await localizePlace(persistent, 'bg', { fetcher: api.fetcher, storage: cache })
  await localizePlace(persistent, 'en', { fetcher: api.fetcher, storage: cache })
  assert.equal(bulgarian.name, 'Варна')
  assert.deepEqual([persistent.name, persistent.region, persistent.country], ['Варна', 'Област Варна', 'България'], 'identity enrichment does not overwrite fallback labels')
  assert.equal(api.calls.filter(url => url.includes('/search?')).length, 4, 'only the initial legacy resolution searches by name and region')
})

test('a known id uses direct lookup even when same-name search results would be ambiguous', async () => {
  const api = geocoder()
  const localized = await localizePlace({ geonameId: 726050, name: 'Springfield', lat: 1, lon: 2 }, 'en', { fetcher: api.fetcher, storage: null })
  assert.equal(localized.name, 'Varna')
  assert.equal(api.calls.length, 1)
  assert.match(api.calls[0], /\/get\?id=726050/)
})

test('a successful API result survives unavailable cache storage', async () => {
  const api = geocoder()
  const storage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') } }
  const localized = await localizePlace({ geonameId: 726050, name: 'Варна', lat: 43.2167, lon: 27.9167 }, 'en', { fetcher: api.fetcher, storage })
  assert.equal(localized.name, 'Varna')
})

test('late localization cannot commit after language, place, or profile changes', async () => {
  const guard = createLocalizationGuard(), commits = []
  const releases = [], pending = []
  const delayedFetch = () => new Promise(resolve => { releases.push(() => resolve(response(varna.en))) })
  const beginRequest = context => {
    const ticket = guard.begin()
    pending.push(localizePlace({ geonameId: 726050, name: context, lat: 43.2167, lon: 27.9167 }, 'en', { fetcher: delayedFetch, storage: null })
      .then(place => { if (guard.isCurrent(ticket)) commits.push(place.name) }))
    return ticket
  }
  guard.invalidate(beginRequest('old language'))
  guard.invalidate(beginRequest('old place'))
  guard.invalidate(beginRequest('old profile'))
  const current = guard.begin()
  await localizePlace({ geonameId: 726050, name: 'current', lat: 43.2167, lon: 27.9167 }, 'en', { fetcher: async () => response(varna.en), storage: null })
    .then(place => { if (guard.isCurrent(current)) commits.push(place.name) })
  releases.forEach(release => release())
  await Promise.all(pending)
  assert.deepEqual(commits, ['Varna'])
})
