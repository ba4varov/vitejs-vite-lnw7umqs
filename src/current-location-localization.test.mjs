import test from 'node:test'
import assert from 'node:assert/strict'
import {
  localizeCurrentLocation,
  locationFromReverseGeocode,
  reverseGeocodeLocation
} from './current-location-localization.js'

const quickCities = {
  bg: [{ name: 'Варна', lat: 43.2141, lon: 27.9147 }],
  en: [{ name: 'Varna', lat: 43.2141, lon: 27.9147 }]
}

test('current quick city localizes bg to en with no favorites or API lookup', async () => {
  let calls = 0
  const current = { name: 'Варна', lat: 43.2141, lon: 27.9147 }
  const localized = await localizeCurrentLocation(current, 'en', quickCities.en, async () => { calls++; return current })
  assert.equal(localized.name, 'Varna')
  assert.equal(calls, 0)
})

test('current quick city localizes en to bg without changing its identity', async () => {
  const current = { name: 'Varna', lat: 43.2141, lon: 27.9147 }
  const localized = await localizeCurrentLocation(current, 'bg', quickCities.bg, async () => current)
  assert.deepEqual(localized, { ...current, name: 'Варна' })
})

test('search-selected current location uses its geoname id and preserves coordinates', async () => {
  const current = { name: 'Paris', region: 'Île-de-France', country: 'France', geonameId: 2988507, lat: 48.8566, lon: 2.3522 }
  const localized = await localizeCurrentLocation(current, 'bg', quickCities.bg, async (place, language) => {
    assert.equal(place.geonameId, 2988507)
    assert.equal(language, 'bg')
    return { ...place, name: 'Париж', region: 'Ил дьо Франс', country: 'Франция' }
  })
  assert.deepEqual([localized.name, localized.region, localized.country], ['Париж', 'Ил дьо Франс', 'Франция'])
  assert.deepEqual([localized.lat, localized.lon, localized.geonameId], [48.8566, 2.3522, 2988507])
})

test('geolocation language refresh requests Nominatim again and parses localized metadata', async () => {
  const calls = []
  const fetcher = async (url, options) => {
    calls.push({ url, signal: options.signal })
    return { ok: true, json: async () => ({ address: { city: 'Varna', state: 'Varna', country: 'Bulgaria', road: 'Vladislav Varnenchik Blvd.', house_number: '267' } }) }
  }
  const controller = new AbortController()
  const data = await reverseGeocodeLocation({ lat: 43.2141, lon: 27.9147 }, 'en', { fetcher, signal: controller.signal })
  assert.match(calls[0].url, /accept-language=en/)
  assert.equal(calls[0].signal, controller.signal)
  assert.deepEqual(locationFromReverseGeocode(data, 'My Location'), {
    name: 'Varna', region: 'Varna', country: 'Bulgaria', exactLocation: 'Vladislav Varnenchik Blvd. 267'
  })
})

test('localization leaves unrelated weather and favorite state untouched', async () => {
  const appState = { weather: { temperature: 20 }, favorites: [], selected: { name: 'Варна', lat: 43.2141, lon: 27.9147 } }
  const selected = await localizeCurrentLocation(appState.selected, 'en', quickCities.en, async () => appState.selected)
  assert.deepEqual({ ...appState, selected }, { weather: { temperature: 20 }, favorites: [], selected: { name: 'Varna', lat: 43.2141, lon: 27.9147 } })
})
