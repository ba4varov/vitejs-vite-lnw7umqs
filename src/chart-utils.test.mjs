import test from 'node:test'
import assert from 'node:assert/strict'
import { CHART_METRICS, chartSummary, chartTheme, chartValues, valueRange, visibleTimeIndexes } from './chart-utils.js'

const hours = Array.from({ length: 24 }, (_, i) => ({ hour: `${String(i).padStart(2, '0')}:00`, temp: i - 8, rain: i === 5 ? .2 : 0, wind: i + 1, pressure: 1013 + (i % 2) }))

test('all four metrics preserve 24 hourly positions and malformed values become gaps', () => {
  for (const metric of ['temp', 'rain', 'wind', 'pressure']) assert.equal(chartValues(hours, metric).length, 24)
  assert.deepEqual(chartValues([{ temp: null }, {}, { temp: 'bad' }], 'temp'), [null, null, null])
})

test('zero rain and non-zero rain can select the empty state and discrete bars', () => {
  assert.equal(CHART_METRICS.rain.kind, 'bar')
  assert.equal(chartValues(hours.map(h => ({ ...h, rain: 0 })), 'rain').some(value => value > 0), false)
  assert.equal(chartValues(hours, 'rain')[5], .2)
})

test('time labels are reduced while retaining first and final hours', () => {
  assert.deepEqual(visibleTimeIndexes(24, false), [0, 3, 6, 9, 12, 15, 18, 21, 23])
  assert.deepEqual(visibleTimeIndexes(24, true), [0, 6, 12, 18, 23])
})

test('pressure ticks use an integer step and a close non-flat range', () => {
  const range = valueRange([1013, 1013.2, 1013.4], 'pressure')
  assert.ok(range.step >= 1)
  assert.ok(range.min < 1013 && range.max > 1013.4)
})

test('negative temperatures and identical values have safe summaries and ranges', () => {
  assert.deepEqual(chartSummary([-8, -3, null]), { current: -8, min: -8, max: -3 })
  const range = valueRange([5, 5], 'temp')
  assert.ok(range.min < 5 && range.max > 5)
})

test('theme and mobile options support dark mode and reduced motion', () => {
  assert.notEqual(chartTheme(false).text, chartTheme(true).text)
  assert.equal(chartTheme(true, true, true).timeLabelStep, 6)
  assert.equal(chartTheme(true, true, true).animationDuration, 0)
})
