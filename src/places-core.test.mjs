import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dedupePlaces, loadLocalPlaces, placeIdentity, placeKey, requireMatchingPlace, samePlace, validPlace } from './places-core.js'
import { createPlacesSessionGuard } from './places-session-guard.js'
import { cacheLabel, cachedLabel, labelFromResult, matchGeocodingResult } from './place-localization-core.js'

test('place identity uses coordinates and not a possibly duplicated name', () => {
  const places = dedupePlaces([{ name: 'Springfield', lat: 1, lon: 2 }, { name: 'Springfield', lat: 3, lon: 4 }, { name: 'Other', lat: 1.00001, lon: 2.00001 }])
  assert.equal(places.length, 2); assert.equal(placeKey(places[0]), '1.0000,2.0000')
})
test('GeoNames identity remains stable while localized labels change', () => {
  const bg = { geonameId: 726050, name: 'Варна', lat: 43.2167, lon: 27.9167 }
  const en = { ...bg, name: 'Varna' }
  assert.equal(placeIdentity(bg), 'geo:726050')
  assert.equal(samePlace(bg, en), true)
})
test('known places match the requested GeoNames id rather than result order', () => {
  const result = matchGeocodingResult({ geonameId: 2, name: 'Same', lat: 1, lon: 1 }, [{ id: 1, name: 'Wrong' }, { id: 2, name: 'Right' }])
  assert.equal(result.name, 'Right')
})
test('legacy resolution uses coordinates and metadata and rejects ambiguity', () => {
  const legacy = { name: 'Springfield', country: 'United States', region: 'Illinois', lat: 39.78, lon: -89.65 }
  const right = { id: 1, name: 'Springfield', country: 'United States', admin1: 'Illinois', latitude: 39.781, longitude: -89.651 }
  const wrong = { id: 2, name: 'Springfield', country: 'United States', admin1: 'Missouri', latitude: 39.781, longitude: -89.651 }
  assert.equal(matchGeocodingResult(legacy, [wrong, right]).id, 1)
  assert.equal(matchGeocodingResult({ name: 'Springfield', lat: 39.78, lon: -89.65 }, [right, { ...right, id: 3 }]), null)
})
test('localized name, region and country are cached by GeoNames id and language', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
  const label = labelFromResult({ name: 'Varna', admin1: 'Varna', country: 'Bulgaria' })
  cacheLabel(storage, 726050, 'en', label)
  assert.deepEqual(cachedLabel(storage, 726050, 'en'), label)
  assert.equal(cachedLabel(storage, 726050, 'bg'), null)
})
test('legacy favorite is migrated without deleting the old value', () => {
  const values = new Map([['bobbyWeatherFav', JSON.stringify({ name: 'Varna', lat: 43.2, lon: 27.9 })]])
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
  assert.equal(loadLocalPlaces(storage).length, 1); assert.ok(values.has('bobbyWeatherFav'))
  values.set('meteoPulsePlacesV1', '[]')
  assert.deepEqual(loadLocalPlaces(storage), [], 'an intentionally empty migrated list stays empty after reload')
})
test('invalid names and coordinates are rejected', () => assert.equal(validPlace({ name: '', lat: 91, lon: 0 }), false))
test('a conflict reload without the requested place fails explicitly', () => {
  assert.throws(() => requireMatchingPlace([], { name: 'Varna', lat: 43.2, lon: 27.9 }), /PLACE_CONFLICT_NOT_FOUND/)
})
test('migration scopes rows to auth.uid and guards defaults with an ownership FK', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260930010000_favorite_places.sql', import.meta.url), 'utf8')
  assert.match(sql, /force row level security/g)
  assert.match(sql, /unique \(user_id, id\)/)
  assert.match(sql, /foreign key \(user_id, default_place_id\)/)
  assert.match(sql, /user_id = auth\.uid\(\) and id = place_id/)
  assert.doesNotMatch(sql, /subscriptions[\s\S]*grant/i)
  const identitySql = readFileSync(new URL('../supabase/migrations/20260930020000_place_geoname_identity.sql', import.meta.url), 'utf8')
  assert.match(identitySql, /geoname_id bigint/)
  assert.match(identitySql, /country_code text/)
  assert.match(identitySql, /admin1_id bigint/)
})

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
test('delayed account A results cannot update guest or account B state', async () => {
  const guard = createPlacesSessionGuard(), delayed = deferred(), commits = []
  const a = guard.changeSession('A').ticket
  const operation = delayed.promise.then(value => { if (guard.isCurrent(a)) commits.push(value) })
  guard.changeSession(null)
  delayed.resolve('stale-after-logout'); await operation
  assert.deepEqual(commits, [])

  const delayedSwitch = deferred(), oldA = guard.changeSession('A').ticket
  const switched = delayedSwitch.promise.then(value => { if (guard.isCurrent(oldA)) commits.push(value) })
  guard.changeSession('B'); delayedSwitch.resolve('stale-after-switch'); await switched
  assert.deepEqual(commits, [])
})

test('a manual London choice wins over a delayed Varna default and token refresh does not reapply it', async () => {
  const guard = createPlacesSessionGuard(), response = deferred(), selected = { city: 'Varna' }
  const initial = guard.changeSession('A').ticket
  const loading = response.promise.then(city => { if (guard.resolveDefault(initial)) selected.city = city })
  guard.manualSelection(); selected.city = 'London'
  response.resolve('Varna'); await loading
  assert.equal(selected.city, 'London')
  const refresh = guard.changeSession('A').ticket
  assert.equal(guard.resolveDefault(refresh), false)
})
