import test from 'node:test'
import assert from 'node:assert/strict'
import { localizePlace, localizePlaceSelection } from './place-localization.js'
import { createLocalizationGuard } from './place-localization-core.js'

const varna = {
  bg: { id: 726050, name: 'Варна', latitude: 43.2167, longitude: 27.9167, country_code: 'BG', country: 'България', admin1_id: 726051, admin1: 'Област Варна' },
  en: { id: 726050, name: 'Varna', latitude: 43.2167, longitude: 27.9167, country_code: 'BG', country: 'Bulgaria', admin1_id: 726051, admin1: 'Varna' }
}

const paris = {
  bg: { id: 2988507, name: 'Париж', latitude: 48.8534, longitude: 2.3488, country_code: 'FR', country: 'Франция', admin1_id: 3012874, admin1: 'Ил дьо Франс' },
  en: { id: 2988507, name: 'Paris', latitude: 48.8534, longitude: 2.3488, country_code: 'FR', country: 'France', admin1_id: 3012874, admin1: 'Île-de-France' }
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

test('saved Varna and Paris labels follow the current language without changing favorite identity', async () => {
  const calls = []
  const fetcher = async url => {
    calls.push(url)
    const parsed = new URL(url)
    const language = parsed.searchParams.get('language')
    const result = parsed.searchParams.get('id') === String(paris.en.id) ? paris[language] : varna[language]
    return response(result)
  }
  const saved = [
    { id: 'varna-favorite', geonameId: varna.en.id, name: 'Варна', region: 'Област Варна', country: 'България', lat: varna.en.latitude, lon: varna.en.longitude },
    { id: 'paris-favorite', geonameId: paris.en.id, name: 'Paris', region: 'Île-de-France', country: 'France', lat: paris.en.latitude, lon: paris.en.longitude }
  ]

  const english = await localizePlaceSelection(saved, saved[0], 'en', { fetcher, storage: null })
  assert.deepEqual(english.places.map(place => [place.name, place.region, place.country]), [
    ['Varna', 'Varna', 'Bulgaria'],
    ['Paris', 'Île-de-France', 'France']
  ])
  assert.equal(english.selectedPlace.name, 'Varna')

  const bulgarian = await localizePlaceSelection(saved, saved[1], 'bg', { fetcher, storage: null })
  assert.deepEqual(bulgarian.places.map(place => [place.name, place.region, place.country]), [
    ['Варна', 'Област Варна', 'България'],
    ['Париж', 'Ил дьо Франс', 'Франция']
  ])
  assert.equal(bulgarian.selectedPlace.name, 'Париж')
  assert.deepEqual(bulgarian.places.map(place => place.id), saved.map(place => place.id))
  assert.equal(bulgarian.places.length, saved.length, 'language switching must not duplicate favorites')
  assert.equal(calls.length, 4, 'the selected favorite reuses its localized collection entry')
})

test('an unsaved selected city is localized without adding it to favorites', async () => {
  const api = geocoder({ get: paris })
  const selected = { geonameId: paris.en.id, name: 'Paris', region: 'Île-de-France', country: 'France', lat: paris.en.latitude, lon: paris.en.longitude }
  const localized = await localizePlaceSelection([], selected, 'bg', { fetcher: api.fetcher, storage: null })

  assert.equal(localized.places.length, 0)
  assert.deepEqual([localized.selectedPlace.name, localized.selectedPlace.region, localized.selectedPlace.country], ['Париж', 'Ил дьо Франс', 'Франция'])
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
