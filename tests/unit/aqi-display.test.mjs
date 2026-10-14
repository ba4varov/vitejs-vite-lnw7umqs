import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatAqiValue } from '../../src/aqi-display.js'

for (const label of ['Няма данни', 'No data']) {
  test(`AQI presentation preserves observations and localizes absence: ${label}`, () => {
    for (const value of [null, undefined, NaN, Infinity, -Infinity, 'undefined', '']) {
      assert.equal(formatAqiValue(value, label, ' µg/m³'), label)
    }
    for (const value of [0, 12.345, 123456789.123456, -1]) {
      assert.equal(formatAqiValue(value, label), String(value))
      assert.equal(formatAqiValue(value, label, ' µg/m³'), `${value} µg/m³`)
    }
  })
}
