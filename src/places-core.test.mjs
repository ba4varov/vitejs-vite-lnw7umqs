import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dedupePlaces, loadLocalPlaces, placeKey, requireMatchingPlace, validPlace } from './places-core.js'
import { createPlacesSessionGuard } from './places-session-guard.js'

test('place identity uses coordinates and not a possibly duplicated name', () => {
  const places = dedupePlaces([{ name: 'Springfield', lat: 1, lon: 2 }, { name: 'Springfield', lat: 3, lon: 4 }, { name: 'Other', lat: 1.00001, lon: 2.00001 }])
  assert.equal(places.length, 2); assert.equal(placeKey(places[0]), '1.0000,2.0000')
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
