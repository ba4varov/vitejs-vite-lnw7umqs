import test from 'node:test'
import assert from 'node:assert/strict'
import { createInitialLocation, INITIAL_LOCATION_TIMEOUT } from './initial-location.js'
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise=new Promise(done=>{resolve=done});return {promise,resolve} }
function setup(state='granted',extras={}) {
 const callbacks=[],timers=[];let queries=0
 const nav={permissions:{query:async()=>{queries++;return {state}}},geolocation:{getCurrentPosition:(success,error,options)=>callbacks.push({success,error,options})}}
 const chooser=createInitialLocation({navigator:nav,schedule:callback=>{timers.push(callback);return timers.length},cancel:()=>{},...extras})
 return {chooser,callbacks,timers,nav,queries:()=>queries,gps:()=>callbacks[0].success({coords:{latitude:43.22,longitude:27.89}})}
}
test('granted GPS elects final coordinates, starts once across StrictMode setup and settles once',async()=>{
 const s=setup();const first=s.chooser.start();assert.equal(s.chooser.start(),first);await flush();assert.equal(s.callbacks.length,1);assert.equal(s.queries(),1)
 s.gps();assert.deepEqual(await first,{source:'geolocation',lat:43.22,lon:27.89});s.timers[0]();assert.equal(s.chooser.start(),first)
})
for(const state of ['denied','prompt',undefined])test(`permission ${state} falls back without prompting`,async()=>{
 const s=setup(state);if(state===undefined)delete s.nav.permissions
 assert.deepEqual(await s.chooser.start(),{source:'fallback'});assert.equal(s.callbacks.length,0)
})
test('missing geolocation falls back',async()=>{const s=setup();delete s.nav.geolocation;assert.deepEqual(await s.chooser.start(),{source:'fallback'})})
test('permission query never resolves: independent deadline wins',async()=>{
 const d=deferred(),s=setup('granted',{navigator:{permissions:{query:()=>d.promise},geolocation:{getCurrentPosition(){assert.fail('late permission must not start GPS')}}}});const result=s.chooser.start();s.timers[0]();assert.deepEqual(await result,{source:'fallback'});d.resolve({state:'granted'});await flush();assert.equal(s.chooser.settled,true)
})
test('GPS error falls back and success after deadline is ignored',async()=>{
 const s=setup();const result=s.chooser.start();await flush();s.callbacks[0].error();assert.deepEqual(await result,{source:'fallback'});s.gps();assert.deepEqual(await result,{source:'fallback'})
})
test('slow GPS falls back at deadline and ignores later coordinates',async()=>{
 const s=setup();const result=s.chooser.start();await flush();s.timers[0]();assert.deepEqual(await result,{source:'fallback'});s.gps();await flush();assert.deepEqual(await result,{source:'fallback'})
})
test('default wins while GPS is pending, or after a faster GPS result',async()=>{
 for(const gpsFirst of [false,true]){const s=setup();s.chooser.waitForDefault();const result=s.chooser.start();await flush();if(gpsFirst){s.gps();await flush();assert.equal(s.chooser.settled,false)}const place={name:'Sofia',lat:42.7,lon:23.3};s.chooser.defaultResolved(place);assert.deepEqual(await result,{source:'place',place});if(!gpsFirst)s.gps();assert.deepEqual(await result,{source:'place',place})}
})
test('no default releases GPS; failing default and denied GPS release fallback',async()=>{
 for(const state of ['granted','denied']){const s=setup(state);s.chooser.waitForDefault();const result=s.chooser.start();await flush();if(state==='granted'){s.gps();await flush()}assert.equal(s.chooser.settled,false);s.chooser.defaultResolved(null);assert.equal((await result).source,state==='granted'?'geolocation':'fallback')}
})
test('manual selection wins pending GPS/default and cannot be replaced',async()=>{
 const s=setup();s.chooser.waitForDefault();const result=s.chooser.start();await flush();s.chooser.manual();s.gps();assert.equal(s.chooser.defaultResolved({name:'Sofia'}),false);assert.deepEqual(await result,{source:'manual'})
})
test('default lookup has the same bounded budget; late default cannot reorder fallback',async()=>{
 const s=setup('denied');s.chooser.waitForDefault();const result=s.chooser.start();await flush();s.timers[0]();assert.deepEqual(await result,{source:'fallback'});assert.equal(s.chooser.defaultResolved({name:'Sofia'}),false)
})
test('GPS coordinates release election immediately without reverse geocoding',async()=>{
 const s=setup();const result=s.chooser.start();await flush();s.gps();assert.deepEqual(await result,{source:'geolocation',lat:43.22,lon:27.89});assert.equal(s.chooser.settled,true)
})
test('invalid GPS coordinates never become a forecast location',async()=>{
 const s=setup();const result=s.chooser.start();await flush();s.callbacks[0].success({coords:{latitude:NaN,longitude:27}});assert.deepEqual(await result,{source:'fallback'})
})

test('startup uses the accepted 4.5 second total ceiling', async () => {
 let release, delay
 const chooser=createInitialLocation({navigator:{permissions:{query:()=>new Promise(()=>{})},geolocation:{getCurrentPosition(){}}},schedule:(callback,ms)=>{release=callback;delay=ms},cancel:()=>{}})
 const result=chooser.start()
 assert.equal(INITIAL_LOCATION_TIMEOUT,4500);assert.equal(delay,4500)
 release();assert.deepEqual(await result,{source:'fallback'})
})

for (const delivery of [800,2000,3800]) test(`granted automatic GPS at ${delivery} ms wins without waiting for the ceiling`, async t => {
 t.mock.timers.enable({apis:['setTimeout']})
 const s=setup('granted',{schedule:setTimeout,cancel:clearTimeout})
 const result=s.chooser.start();await flush()
 assert.equal(s.callbacks[0].options.timeout,4500)
 t.mock.timers.tick(delivery);assert.equal(s.chooser.settled,false)
 s.gps();assert.deepEqual(await result,{source:'geolocation',lat:43.22,lon:27.89})
 t.mock.timers.tick(4500-delivery);assert.equal((await result).source,'geolocation')
})
for (const state of ['denied','prompt','unsupported','no-permissions']) test(`unavailable GPS settles without advancing the deadline: ${state}`,async()=>{
 const s=setup(state)
 if(state==='unsupported') {delete s.nav.geolocation;s.nav.permissions.query=()=>new Promise(()=>{})}
 if(state==='no-permissions')delete s.nav.permissions
 const result=s.chooser.start();await flush()
 assert.equal(s.chooser.settled,true);assert.deepEqual(await result,{source:'fallback'});assert.equal(s.callbacks.length,0)
})
test('GPS delivered beyond 4.5 seconds cannot replace fallback',async t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 const s=setup('granted',{schedule:setTimeout,cancel:clearTimeout});const result=s.chooser.start();await flush()
 t.mock.timers.tick(4500);assert.deepEqual(await result,{source:'fallback'})
 t.mock.timers.tick(1);s.gps();assert.deepEqual(await result,{source:'fallback'})
})
