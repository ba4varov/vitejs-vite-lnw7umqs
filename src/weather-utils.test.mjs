import test from 'node:test'
import assert from 'node:assert/strict'
import { findHourlyStartIndex, valuesByTime } from './weather-utils.js'

test('24-hour forecast starts at the city-local current hour, regardless of visitor timezone', () => {
  const hours = Array.from({ length: 48 }, (_, index) => {
    const day = index < 24 ? '2026-09-02' : '2026-09-03'
    return `${day}T${String(index % 24).padStart(2, '0')}:00`
  })
  assert.equal(findHourlyStartIndex(hours, '2026-09-02T23:45'), 23)
  assert.equal(findHourlyStartIndex(hours, '2026-09-03T07:15'), 31)
  assert.equal(findHourlyStartIndex(hours, '2026-09-04T00:00'), hours.length)
})

test('auxiliary marine and AQI hours align by timestamp and preserve missing values', () => {
  const values = valuesByTime({ time: ['2026-09-02T10:00', '2026-09-02T11:00'], european_aqi: [0, null] }, 'european_aqi')
  assert.equal(values.get('2026-09-02T10:00'), 0)
  assert.equal(values.get('2026-09-02T11:00'), null)
  assert.equal(values.get('2026-09-02T12:00'), undefined)
})
