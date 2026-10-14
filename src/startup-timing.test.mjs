import test from 'node:test'
import assert from 'node:assert/strict'
import { createStartupTiming } from './startup-timing.js'
test('startup diagnostics are off by default and allow only fixed phases without payloads', () => {
 const disabled=createStartupTiming(false,()=>123);disabled.mark('weather:start');assert.deepEqual(disabled.snapshot(),[])
 const timing=createStartupTiming(true,()=>123.456)
 timing.mark('weather:start',{lat:43,token:'private'});timing.mark('weather:start');timing.mark('private-coordinate-43');
 const snapshot=timing.snapshot();assert.deepEqual(snapshot,[{phase:'weather:start',ms:123.5}]);snapshot[0].ms=0
 assert.equal(timing.snapshot()[0].ms,123.5)
})
