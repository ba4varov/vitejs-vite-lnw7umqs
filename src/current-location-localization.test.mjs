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
  const data = await reverseGeocodeLocation({ lat: 43.2141, lon: 27.9147 }, 'en', { fetcher, signal: controller.signal, accuracy: 25 })
  assert.match(calls[0].url, /accept-language=en/)
  assert.equal(calls[0].signal, controller.signal)
  assert.deepEqual(locationFromReverseGeocode(data, 'My Location', 25), {
    name: 'Varna', region: 'Varna', country: 'Bulgaria', exactLocation: 'Vladislav Varnenchik Blvd. 267', approximateLocation: null
  })
})

test('localization leaves unrelated weather and favorite state untouched', async () => {
  const appState = { weather: { temperature: 20 }, favorites: [], selected: { name: 'Варна', lat: 43.2141, lon: 27.9147 } }
  const selected = await localizeCurrentLocation(appState.selected, 'en', quickCities.en, async () => appState.selected)
  assert.deepEqual({ ...appState, selected }, { weather: { temperature: 20 }, favorites: [], selected: { name: 'Varna', lat: 43.2141, lon: 27.9147 } })
})

for (const accuracy of [25, 100, 101, 2000, 3000, 259471, undefined]) test(`street and neighborhood remain separate at accuracy ${accuracy}`, async () => {
  const data = { address: { city: 'Varna', road: 'Test Road', house_number: '12', suburb: 'Troshevo' } }
  const result = locationFromReverseGeocode(data, 'My Location', accuracy)
  assert.equal(result.name, 'Varna')
  assert.equal(result.exactLocation, accuracy <= 100 ? 'Test Road 12' : null)
  assert.equal(result.approximateLocation, accuracy <= 100 ? 'Troshevo' : null)
  let called = false
  await reverseGeocodeLocation({lat:43.22,lon:27.89}, 'en', { accuracy, fetcher: async url => {
    called = true
    assert.equal(new URL(url).searchParams.get('zoom'), accuracy <= 100 ? '18' : '10')
    return { ok: true, json: async () => data }
  } })
  assert.equal(called, true)
})
test('a precise district-only response is approximate, never a street address', () => {
  const location = locationFromReverseGeocode({address:{city:'Варна',suburb:'Трошево'}}, 'Моето местоположение', 50)
  assert.equal(location.exactLocation, null)
  assert.equal(location.approximateLocation, 'Трошево')
})
test('a city-only response cannot invent a neighborhood from county or display_name', () => {
  const location = locationFromReverseGeocode({address:{city:'Varna',county:'Varna Province'},display_name:'Troshevo'}, 'My Location', 25)
  assert.equal(location.exactLocation, null)
  assert.equal(location.approximateLocation, null)
})
