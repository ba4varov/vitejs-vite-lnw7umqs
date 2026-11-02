import test from 'node:test'
import assert from 'node:assert/strict'
import { createInitialLocation, INITIAL_LOCATION_TIMEOUT } from './initial-location.js'
const flush = () => new Promise(resolve => setImmediate(resolve))
const fix = { coords: { latitude: 43.22, longitude: 27.89, accuracy: 25 } }
function setup(state = 'prompt', extras = {}) {
 const callbacks = [], timers = [], updates = []; let queries = 0
 const nav = { permissions: { query: async () => { queries++; return { state } } }, geolocation: { getCurrentPosition: (success, error, options) => callbacks.push({ success, error, options }) } }
 const chooser = createInitialLocation({ navigator: nav, schedule: (callback, ms) => { timers.push({ callback, ms }); return timers.length }, cancel: () => {}, ...extras })
 chooser.subscribe(value => updates.push(value))
 return { chooser, callbacks, timers, updates, nav, queries: () => queries }
}
for (const state of ['prompt', 'granted', 'missing', 'throws']) test(`${state}: first visit requests GPS once across StrictMode starts`, async () => {
 const s = setup(state)
 if (state === 'missing') delete s.nav.permissions
 if (state === 'throws') s.nav.permissions.query = () => { throw Error('unsupported') }
 const first = s.chooser.start(); assert.equal(s.chooser.start(), first); await flush()
 assert.equal(s.callbacks.length, 1); assert.equal(s.callbacks[0].options.timeout, 4500)
 s.callbacks[0].success(fix)
 assert.deepEqual(await first, { source: 'geolocation', lat: 43.22, lon: 27.89, accuracy: 25 })
 s.callbacks[0].success(fix); assert.equal(s.updates.length, 0)
})
test('denied makes no automatic request; a fresh chooser can request after settings change', async () => {
 const s = setup('denied'); assert.deepEqual(await s.chooser.start(), { source: 'fallback', reason: 'denied' }); assert.equal(s.callbacks.length, 0)
 const retry = setup('prompt'); const result = retry.chooser.start(); await flush(); retry.callbacks[0].success(fix); assert.equal((await result).source, 'geolocation')
})
test('user denial settles immediately with blocked guidance reason', async () => {
 const s = setup(); const result = s.chooser.start(); await flush(); s.callbacks[0].error({ code: 1 })
 assert.deepEqual(await result, { source: 'fallback', reason: 'denied' }); s.callbacks[0].success(fix); assert.equal(s.updates.length, 0)
})
test('deadline releases startup at 4500ms and accepts one late precise result', async () => {
 const s = setup(); const result = s.chooser.start(); await flush()
 assert.equal(INITIAL_LOCATION_TIMEOUT, 4500); assert.equal(s.timers[0].ms, 4500)
 s.timers[0].callback(); assert.deepEqual(await result, { source: 'fallback' })
 s.callbacks[0].success(fix); s.callbacks[0].success(fix)
 assert.deepEqual(s.updates, [{ source: 'geolocation', lat: 43.22, lon: 27.89, accuracy: 25 }])
})
for (const afterDeadline of [false, true]) test(`manual city cancels GPS before/after deadline ${afterDeadline}`, async () => {
 const s = setup(); const result = s.chooser.start(); await flush()
 if (afterDeadline) s.timers[0].callback()
 s.chooser.manual(); s.callbacks[0].success(fix); assert.equal(s.updates.length, 0)
 assert.equal((await result).source, afterDeadline ? 'fallback' : 'manual')
})
test('unsubscribed component cannot receive late GPS', async () => {
 const s = setup(); const seen = []; const unsubscribe = s.chooser.subscribe(value => seen.push(value))
 s.chooser.start(); await flush(); s.timers[0].callback(); unsubscribe(); s.callbacks[0].success(fix); assert.deepEqual(seen, [])
})
for (const state of ['prompt', 'granted']) test(`account default wins without requesting GPS (${state})`, async () => {
 const s = setup(state); s.chooser.waitForDefault(); const result = s.chooser.start(); await flush(); assert.equal(s.callbacks.length, 0)
 const place = { name: 'Sofia', lat: 42.7, lon: 23.3 }; s.chooser.defaultResolved(place)
 assert.deepEqual(await result, { source: 'place', place }); assert.equal(s.callbacks.length, 0)
})
test('no account default releases first-visit prompt', async () => {
 const s = setup(); s.chooser.waitForDefault(); const result = s.chooser.start(); await flush(); s.chooser.defaultResolved(null); assert.equal(s.callbacks.length, 1)
 s.callbacks[0].success(fix); assert.equal((await result).source, 'geolocation')
})
for (const state of ['prompt', 'denied', 'granted']) test(`saved manual city survives reload without GPS (${state})`, async () => {
 const confirmed = { name: 'Sofia', lat: 42.7, lon: 23.3, source: 'manual' }
 const s = setup(state, { confirmed }); assert.deepEqual(await s.chooser.start(), { source: 'place', place: confirmed, confirmed: true }); assert.equal(s.callbacks.length, 0)
})
test('saved GPS follows travel only with granted permission', async () => {
 const confirmed = { name: 'Sofia', lat: 42.7, lon: 23.3, source: 'geolocation' }
 const s = setup('granted', { confirmed }); const result = s.chooser.start(); await flush(); s.callbacks[0].success(fix); assert.equal((await result).lat, 43.22)
 const quiet = setup('prompt', { confirmed }); assert.equal((await quiet.chooser.start()).source, 'place'); assert.equal(quiet.callbacks.length, 0)
})
for (const late of [false, true]) test(`259471m GPS is rejected, including late response ${late}`, async () => {
 const s = setup(); const result = s.chooser.start(); await flush(); if (late) s.timers[0].callback()
 s.callbacks[0].success({ coords: { ...fix.coords, accuracy: 259471 } })
 const selection = late ? s.updates[0] : await result
 assert.deepEqual(selection, { source: 'fallback', reason: 'accuracy' })
})
test('missing GPS and stalled Permissions API cannot hang startup or start late requests', async () => {
 const missing = setup(); delete missing.nav.geolocation; assert.equal((await missing.chooser.start()).source, 'fallback')
 const s = setup(); let release; s.nav.permissions.query = () => new Promise(done => { release = done })
 const result = s.chooser.start(); await flush(); s.timers[0].callback(); assert.equal((await result).source, 'fallback')
 release({ state: 'prompt' }); await flush(); assert.equal(s.callbacks.length, 0)
})

for (const accuracy of [3000, 3001, undefined, NaN, -1]) test(`startup retains forecast accuracy boundary: ${accuracy}`, async () => {
 const s = setup(); const result = s.chooser.start(); await flush()
 s.callbacks[0].success({ coords: { ...fix.coords, accuracy } })
 assert.equal((await result).source, accuracy === 3000 ? 'geolocation' : 'fallback')
})
test('StrictMode resubscription receives a late result only once', async () => {
 const s = setup(); const stale = [], current = []
 const unsubscribe = s.chooser.subscribe(value => stale.push(value))
 const first = s.chooser.start(); unsubscribe(); s.chooser.subscribe(value => current.push(value)); assert.equal(s.chooser.start(), first)
 await flush(); s.timers[0].callback(); await first
 s.callbacks[0].success(fix); s.callbacks[0].success(fix)
 assert.equal(s.callbacks.length, 1); assert.deepEqual(stale, []); assert.equal(current.length, 1)
})
test('a stalled account default stays bounded and cannot start a prompt after the deadline', async () => {
 const s = setup(); s.chooser.waitForDefault(); const result = s.chooser.start(); await flush()
 assert.equal(s.callbacks.length, 0); s.timers[0].callback(); assert.equal((await result).source, 'fallback')
 assert.equal(s.chooser.defaultResolved(null), false); assert.equal(s.callbacks.length, 0)
})
