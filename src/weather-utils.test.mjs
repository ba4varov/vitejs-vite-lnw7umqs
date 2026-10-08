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

test('missing hourly observations stay absent while measured zero remains valid', async () => {
  const { hourlyNumber } = await import('./weather-utils.js')
  for (const value of [null, undefined, NaN, Infinity, '12']) assert.equal(hourlyNumber(value), null)
  assert.equal(hourlyNumber(0), 0)
  assert.equal(hourlyNumber(12.6), 13)
  assert.equal(hourlyNumber(0.25, false), 0.25)
})

test('overview distinguishes hourly observations from daily maxima and totals', async () => {
  const { forecastOverview } = await import('./weather-utils.js')
  const item = { temp: 17, max: 23, min: 9, rain: 0.2, wind: 12 }
  for (const language of ['bg', 'en']) {
    const hour = forecastOverview(item, 'hour', language), day = forecastOverview(item, 'day', language)
    assert.equal(hour.temperature, '17°C')
    assert.equal(day.temperature, '23°C')
    assert.notEqual(hour.explanation, day.explanation)
    assert.ok(hour.rain.startsWith('0.2'))
    assert.equal(forecastOverview({}, 'day', language).rain, '—')
    assert.equal(forecastOverview({ rain: 0 }, 'hour', language).rain.split(' ')[0], '0')
  }
})
test('daily averages exclude absent values and preserve genuine zero', async () => {
  const { meanObservation } = await import('./weather-utils.js')
  assert.equal(meanObservation([null, undefined, NaN]), null)
  assert.equal(meanObservation([0, null, 10]), 5)
  assert.equal(meanObservation([0, 0]), 0)
})
