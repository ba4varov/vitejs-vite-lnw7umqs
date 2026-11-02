import test from 'node:test'
import assert from 'node:assert/strict'
import { reverseLocationDetails, reportedAccuracyMetres } from './reverse-location-details.js'
import { acceptedPosition } from './location-accuracy.js'

for (const accuracy of [0,25,100]) test(`precise fix ${accuracy} permits provider street and separately labeled district`, () => {
 assert.deepEqual(reverseLocationDetails({road:'Test Street',house_number:'12',suburb:'Troshevo'},accuracy),{street:'Test Street 12',neighborhood:'Troshevo'})
})
for (const field of ['suburb','neighbourhood','city_district']) test(`district-only ${field} is not an exact street`, () => {
 assert.deepEqual(reverseLocationDetails({[field]:'Troshevo'},50),{street:null,neighborhood:'Troshevo'})
})
for (const accuracy of [100.01,250,3000,3001,259471,undefined,null,NaN,-1,'25',Infinity]) test(`no street or unproven district at accuracy ${accuracy}`, () => {
 assert.deepEqual(reverseLocationDetails({road:'Road',house_number:'12',suburb:'Troshevo'},accuracy),{street:null,neighborhood:null})
})
test('city-only response does not turn county, display_name or a number into detail', () => {
 assert.deepEqual(reverseLocationDetails({city:'Varna',county:'Varna Province',house_number:'12'},25),{street:null,neighborhood:null})
})
test('coarse coordinates remain rejected independently of permission or reverse labels', () => {
 assert.equal(acceptedPosition({latitude:43.22,longitude:27.89,accuracy:259471}),false)
 assert.equal(acceptedPosition({latitude:43.22,longitude:27.89,accuracy:3000}),true)
})
test('accuracy diagnostics contain only a rounded metre value, including rejected fixes', () => {
 assert.equal(reportedAccuracyMetres(25.1),26)
 assert.equal(reportedAccuracyMetres(259471),259471)
 for (const value of [NaN,Infinity,-1,null,undefined,'25', {latitude:43.22,longitude:27.89}]) assert.equal(reportedAccuracyMetres(value),null)
})
