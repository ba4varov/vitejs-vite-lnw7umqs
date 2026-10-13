import test from 'node:test'
import assert from 'node:assert/strict'
import { chartCopy } from './chart-copy.js'

test('chart translations cover the same accessible and visible copy in both languages', () => {
  assert.deepEqual(Object.keys(chartCopy.bg).sort(), Object.keys(chartCopy.en).sort())
  for (const value of Object.values(chartCopy.en)) {
    assert.ok(value.trim())
    assert.doesNotMatch(value, /[А-Яа-я]/u)
  }
  assert.equal(chartCopy.en.now, 'Now')
  assert.match(chartCopy.en.noRain, /next 24 hours/)
  assert.match(chartCopy.bg.noRain, /24 часа/)
})
