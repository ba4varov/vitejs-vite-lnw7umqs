import test from 'node:test'
import assert from 'node:assert/strict'
import { createForecastRequests, forecastFreshness, FORECAST_REFRESH_MS, FORECAST_MAX_AGE_MS } from './forecast-sources.js'
const urls = { weather: 'weather', marine: 'marine', aqi: 'aqi' }
for (const status of [503, 429]) for (const retry of [null, '1800', 'garbage', 'Thu, 01 Jan 1970 00:45:00 GMT']) {
  test(`${status}, Retry-After ${retry}: no automatic retries, city/remount cannot bypass cooldown, recovery`, async () => {
    let clock = 0, failure = true
    const gate = { until: 0 }, calls = []
    const fetcher = async url => {
      calls.push(url)
      return url.startsWith('weather') && failure
        ? { ok: false, status, headers: { get: () => retry } }
        : { ok: true, json: async () => ({ current: { european_aqi: 0, sea_surface_temperature: 0 } }) }
    }
    const loader = createForecastRequests(fetcher, { now: () => clock, gate })
    await assert.rejects(loader.start(urls, () => true, () => {}).main, error => error.status === status)
    const count = calls.length
    const remount = createForecastRequests(fetcher, { now: () => clock, gate })
    for (let i = 0; i < 5; i++) {
      await assert.rejects(remount.start({ ...urls, weather: 'weather-other-city' }, () => true, () => {}).main)
    }
    assert.equal(calls.length, count)
    assert.ok(gate.until >= FORECAST_REFRESH_MS)
    if (retry === '1800') assert.equal(gate.until, 1800000)
    if (retry?.includes('GMT')) assert.equal(gate.until, 2700000)
    clock = gate.until; failure = false
    await remount.start(urls, () => true, () => {}).main
    assert.equal(calls.length, count + 3)
  })
}
test('invalid JSON rejects; next explicit request recovers without automatic retry', async () => {
  let broken = true, calls = 0
  const loader = createForecastRequests(async () => {
    calls++
    return { ok: true, json: async () => { if (broken) throw new SyntaxError('invalid JSON'); return {} } }
  }, { gate: { until: 0 } })
  await assert.rejects(loader.start(urls, () => true, () => {}).main, SyntaxError)
  assert.equal(calls, 3)
  broken = false
  await loader.start(urls, () => true, () => {}).main
  assert.equal(calls, 6)
})
test('snapshot age: fresh <15m, labelled fallback <=30m, then hidden; future timestamps rejected', () => {
  assert.deepEqual(forecastFreshness(null, 0), { usable: false, fresh: false })
  assert.deepEqual(forecastFreshness(0, FORECAST_REFRESH_MS - 1), { usable: true, fresh: true })
  assert.deepEqual(forecastFreshness(0, FORECAST_REFRESH_MS), { usable: true, fresh: false })
  assert.deepEqual(forecastFreshness(0, FORECAST_MAX_AGE_MS), { usable: true, fresh: false })
  assert.deepEqual(forecastFreshness(0, FORECAST_MAX_AGE_MS + 1), { usable: false, fresh: false })
  assert.deepEqual(forecastFreshness(1, 0), { usable: false, fresh: false })
})
