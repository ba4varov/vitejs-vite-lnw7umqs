import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dedupePlaces, loadLocalPlaces, placeKey, validPlace } from './places-core.js'

test('place identity uses coordinates and not a possibly duplicated name', () => {
  const places = dedupePlaces([{ name: 'Springfield', lat: 1, lon: 2 }, { name: 'Springfield', lat: 3, lon: 4 }, { name: 'Other', lat: 1.00001, lon: 2.00001 }])
  assert.equal(places.length, 2); assert.equal(placeKey(places[0]), '1.0000,2.0000')
})
test('legacy favorite is migrated without deleting the old value', () => {
  const values = new Map([['bobbyWeatherFav', JSON.stringify({ name: 'Varna', lat: 43.2, lon: 27.9 })]])
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
  assert.equal(loadLocalPlaces(storage).length, 1); assert.ok(values.has('bobbyWeatherFav'))
})
test('invalid names and coordinates are rejected', () => assert.equal(validPlace({ name: '', lat: 91, lon: 0 }), false))
test('migration scopes rows to auth.uid and guards defaults with an ownership FK', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260930010000_favorite_places.sql', import.meta.url), 'utf8')
  assert.match(sql, /force row level security/g)
  assert.match(sql, /unique \(user_id, id\)/)
  assert.match(sql, /foreign key \(user_id, default_place_id\)/)
  assert.match(sql, /user_id = auth\.uid\(\) and id = place_id/)
  assert.doesNotMatch(sql, /subscriptions[\s\S]*grant/i)
})
