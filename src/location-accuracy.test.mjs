import test from 'node:test'
import assert from 'node:assert/strict'
import { acceptedPosition, loadConfirmedLocation, saveConfirmedLocation, LAST_LOCATION_KEY } from './location-accuracy.js'
import { locationFromReverseGeocode, reverseGeocodeLocation } from './current-location-localization.js'

for (const accuracy of [0, 25, 100, 1000, 3000]) test(`accepts city fix with accuracy ${accuracy}`, () => {
  assert.equal(acceptedPosition({ latitude: 48.8566, longitude: 2.3522, accuracy }), true)
})
for (const accuracy of [3001, 259471, undefined, null, NaN, Infinity, -1, '25']) test(`rejects untrusted accuracy ${accuracy}`, () => {
  assert.equal(acceptedPosition({ latitude: 43.57, longitude: 27.83, accuracy }), false)
})
test('invalid coordinates are rejected even with precise accuracy', () => {
  for (const [latitude, longitude] of [[NaN, 20], [91, 20], [40, 181], [null, 20]]) assert.equal(acceptedPosition({ latitude, longitude, accuracy: 10 }), false)
})
test('reload restores explicit city or accepted GPS, never a rejected fix or legacy fallback', () => {
  let value = null
  const storage = { getItem: key => { assert.equal(key, LAST_LOCATION_KEY); return value }, setItem: (key, next) => { assert.equal(key, LAST_LOCATION_KEY); value = next } }
  assert.equal(loadConfirmedLocation(storage), null)
  const manual = { name: 'Sofia', lat: 42.7, lon: 23.3, source: 'manual' }
  saveConfirmedLocation(manual, storage)
  assert.deepEqual(loadConfirmedLocation(storage), manual)
  saveConfirmedLocation({ name: 'Dobrich', lat: 43.57, lon: 27.83, source: 'geolocation', accuracy: 259471 }, storage)
  assert.deepEqual(loadConfirmedLocation(storage), manual)
  const gps = { name: 'Paris', lat: 48.8566, lon: 2.3522, source: 'geolocation', accuracy: 25 }
  saveConfirmedLocation({ ...gps, exactLocation: 'Private street 12' }, storage)
  assert.deepEqual(loadConfirmedLocation(storage), gps)
  for (const invalid of ['{', JSON.stringify({ ...gps, accuracy: null }), JSON.stringify({ ...manual, source: 'fallback' })]) {
    value = invalid; assert.equal(loadConfirmedLocation(storage), null)
  }
})
test('storage failures never block location selection', () => {
  const storage = { getItem() { throw Error('disabled') }, setItem() { throw Error('full') } }
  assert.equal(loadConfirmedLocation(storage), null)
  assert.doesNotThrow(() => saveConfirmedLocation({ name: 'Sofia', lat: 42.7, lon: 23.3, source: 'manual' }, storage))
})
test('street labels and reverse zoom follow fix accuracy', async () => {
  const data = { address: { city: 'Paris', road: 'Rue Test', house_number: '12' } }
  for (const accuracy of [25, 100, 101, 3000, undefined, NaN]) {
    let url
    await reverseGeocodeLocation({ lat: 48.85, lon: 2.35 }, 'en', { accuracy, fetcher: async request => { url = new URL(request); return { ok: true, json: async () => data } } })
    const precise = accuracy <= 100
    assert.equal(url.searchParams.get('zoom'), precise ? '18' : '10')
    assert.equal(locationFromReverseGeocode(data, 'My Location', accuracy).exactLocation, precise ? 'Rue Test 12' : null)
  }
})
