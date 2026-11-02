import { test, expect, type Page } from '@playwright/test'
import { weather } from './forecast-order-fixture'
async function setup(page: Page, initial: number | 'invalid' | 'truncated' = 200) {
  await page.clock.install({ time: new Date('2026-10-13T08:00:00Z') })
  await page.addInitScript(() => {
    localStorage.setItem('meteoPulseLanguage', 'bg')
    localStorage.setItem('meteoPulseConfirmedLocationV1', JSON.stringify({ lat: 43.2141, lon: 27.9147, name: 'Варна', source: 'manual' }))
    Object.defineProperty(navigator, 'permissions', { value: { query: async () => ({ state: 'denied' }) } })
  })
  const state = { status: initial, calls: 0, temp: 18, hold: false, release: () => {} }
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/')) return route.continue()
    if (url.hostname === 'api.open-meteo.com') {
      state.calls++
      const status = state.status
      const snapshot = { ...weather, current: { ...weather.current, temperature_2m: state.temp } }
      if (state.hold) await new Promise<void>(resolve => { state.release = resolve })
      return route.fulfill({ status: typeof status === 'number' ? status : 200, json: status === 200 ? snapshot : status === 'truncated' ? { ...weather, daily: { ...weather.daily, weather_code: [] } } : status === 'invalid' ? { current: {} } : { error: true, reason: 'The service is overloaded' } })
    }
    return route.fulfill({ json: {} })
  })
  await page.goto('/')
  return state
}
for (const status of [503, 429]) test(`${status}: bounded manual retry, city change and scheduled recovery`, async ({ page }) => {
  const state = await setup(page, status)
  await expect(page.getByText(/Доставчикът на прогнозата е временно/)).toBeVisible()
  expect(state.calls).toBe(1) // StrictMode starts only once.
  await page.getByRole('button', { name: 'Опитай отново', exact: true }).click()
  await expect(page.getByText(/Доставчикът на прогнозата е временно/)).toBeVisible()
  expect(state.calls).toBe(1)
  await page.getByRole('button', { name: 'София', exact: true }).click()
  await expect(page.getByText(/Доставчикът на прогнозата е временно/)).toBeVisible()
  expect(state.calls).toBe(1)
  state.status = 200
  await page.clock.fastForward(15 * 60 * 1000)
  await expect(page.locator('.big-temp')).toHaveText('18°C')
  expect(state.calls).toBe(2)
  await expect(page.locator('.main-card h2')).toContainText('София')
})
test('failed refresh preserves labelled snapshot, disables warnings, expires and recovers', async ({ page }) => {
  const state = await setup(page)
  await expect(page.locator('.big-temp')).toHaveText('18°C')
  state.status = 503
  await page.clock.fastForward(15 * 60 * 1000)
  await expect(page.getByText(/Доставчикът на прогнозата е временно/)).toBeVisible()
  await expect(page.locator('.big-temp')).toHaveText('18°C')
  await expect(page.getByText(/Последна валидна прогноза:/)).toContainText('13.10.2026')
  await expect(page.locator('.alerts-container')).toHaveCount(0)
  await expect(page.locator('.weather-advice')).toHaveCount(0)
  await page.clock.fastForward(16 * 60 * 1000)
  await expect(page.locator('.main-card')).toHaveCount(0)
  await expect(page.getByText(/Данните са изтекли/)).toBeVisible()
  state.status = 200
  await page.clock.fastForward(15 * 60 * 1000)
  await expect(page.locator('.big-temp')).toHaveText('18°C')
  await expect(page.getByText(/Последна валидна прогноза:/)).toHaveCount(0)
})
for (const invalid of ['invalid', 'truncated'] as const) test(`${invalid} main response never publishes a snapshot; explicit recovery succeeds`, async ({ page }) => {
  const state = await setup(page, invalid)
  await expect(page.getByText(/Не е получена валидна прогноза/)).toBeVisible()
  await expect(page.locator('.main-card')).toHaveCount(0)
  state.status = 200
  await page.getByRole('button', { name: 'Опитай отново', exact: true }).click()
  await expect(page.locator('.big-temp')).toHaveText('18°C')
})
test('parallel interval ticks do not duplicate a pending main request', async ({ page }) => {
  const state = await setup(page)
  await expect(page.locator('.big-temp')).toHaveText('18°C')
  state.hold = true
  await page.clock.fastForward(15 * 60 * 1000)
  await expect.poll(() => state.calls).toBe(2)
  await page.clock.fastForward(15 * 60 * 1000)
  expect(state.calls).toBe(2)
  state.release()
  await expect(page.locator('.big-temp')).toHaveText('18°C')
})

test('city change invalidates a pending refresh and old completion cannot overwrite new city', async ({ page }) => {
  const state = await setup(page)
  await expect(page.locator('.big-temp')).toHaveText('18°C')
  state.hold = true
  await page.clock.fastForward(15 * 60 * 1000)
  await expect.poll(() => state.calls).toBe(2)
  const releaseOldCity = state.release
  state.hold = false; state.temp = 25
  await page.getByRole('button', { name: 'София', exact: true }).click()
  await expect(page.locator('.big-temp')).toHaveText('25°C')
  releaseOldCity()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.big-temp')).toHaveText('25°C')
  await expect(page.locator('.main-card h2')).toContainText('София')
  expect(state.calls).toBe(3)
})
