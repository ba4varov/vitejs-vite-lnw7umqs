import test from 'node:test'
import assert from 'node:assert/strict'
import {gpsWarningArea} from './nimh-location.js'
test('GPS evidence requires BG, accurate fix and explicit province; never nearest city',()=>{
 const address={country_code:'bg','ISO3166-2-lvl4':'BG-03',city:'Варна',municipality:'Община Варна'}
 assert.deepEqual(gpsWarningArea({address},25),{region:'VAR',municipality:'Варна'})
 assert.deepEqual(gpsWarningArea({address:{...address,municipality:undefined}},25),{region:'VAR'})
 assert.deepEqual(gpsWarningArea({address:{...address,municipality:'Varna Municipality'}},25),{region:'VAR'})
 assert.deepEqual(gpsWarningArea({address:{...address,municipality:undefined,county:'община Варна'}},25),{region:'VAR',municipality:'Варна'})
 assert.deepEqual(gpsWarningArea({address:{...address,municipality:undefined,county:'Варна'}},25),{region:'VAR'})
 for(const a of [undefined,101,3000,-1])assert.equal(gpsWarningArea({address},a),null)
 assert.equal(gpsWarningArea({address:{...address,country_code:'ru'}},25),null)
 assert.equal(gpsWarningArea({address:{...address,'ISO3166-2-lvl4':undefined}},25),null)
 assert.deepEqual(gpsWarningArea({address:{...address,'ISO3166-2-lvl4':'BG-22',municipality:undefined}},25),{region:'SOF'})
 assert.deepEqual(gpsWarningArea({address:{...address,'ISO3166-2-lvl4':'BG-23',municipality:undefined}},25),{region:'SFO'})
})
