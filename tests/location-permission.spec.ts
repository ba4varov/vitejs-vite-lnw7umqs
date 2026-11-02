import { test, expect } from '@playwright/test'
import { weather } from './forecast-order-fixture'

type Scenario = 'prompt' | 'granted' | 'denied' | 'saved' | 'missing permissions' | 'permission rejection' | 'late' | 'manual wins' | 'retry'
for (const width of [390, 1440]) for (const lang of ['bg', 'en'] as const) {
  for (const scenario of ['prompt', 'granted', 'denied', 'saved', 'missing permissions', 'permission rejection', 'late', 'manual wins', 'retry'] as Scenario[]) {
    test(`location permission: ${scenario}, ${width}, ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      if (scenario === 'late' || scenario === 'manual wins') await page.clock.install()
      await page.addInitScript(({ lang, scenario }) => {
        if (location.origin !== 'http://127.0.0.1:4173') return
        localStorage.clear()
        localStorage.setItem('meteoPulseLanguage', lang)
        if (scenario === 'saved') localStorage.setItem('meteoPulseConfirmedLocationV1', JSON.stringify({ name: 'Sofia', lat: 42.6977, lon: 23.3219, source: 'manual' }))
        const browser = window as any
        browser.gpsCalls = []
        browser.permissionState = scenario === 'granted' ? 'granted' : scenario === 'denied' || scenario === 'retry' ? 'denied' : 'prompt'
        Object.defineProperty(navigator, 'permissions', { configurable: true, value: scenario === 'missing permissions' ? undefined : { query: async () => ({ state: browser.permissionState }) } })
        Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (success: any, error: any) => {
          browser.gpsCalls.push({ success, error })
          if (scenario === 'late' || scenario === 'manual wins') return
          if (scenario === 'permission rejection') return error({ code: 1 })
          success({ coords: { latitude: 43.2256, longitude: 27.8888, accuracy: 25 } })
        } } })
      }, { lang, scenario })
      const requests: string[] = []
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/')) return route.continue()
        if (url.hostname === 'api.open-meteo.com') { requests.push(url.searchParams.get('latitude')!); return route.fulfill({ json: weather }) }
        return route.fulfill({ json: {} })
      })
      await page.goto('/')
      const allow = page.getByRole('button', { name: lang === 'bg' ? 'Разреши местоположението' : 'Allow location', exact: true })
      const calls = () => page.evaluate(() => (window as any).gpsCalls.length)
      if (scenario === 'denied' || scenario === 'permission rejection' || scenario === 'retry') {
        await expect(page.getByRole('status').filter({ hasText: lang === 'bg' ? 'Браузърът е блокирал' : 'Your browser has blocked' })).toBeVisible()
        await expect(allow).toBeVisible()
        expect(requests).toHaveLength(0)
        expect(await calls()).toBe(scenario === 'permission rejection' ? 1 : 0)
        // Language-independent rerenders must not repeat an automatic request.
        await page.setViewportSize({ width: width + 1, height: 900 })
        expect(await calls()).toBe(scenario === 'permission rejection' ? 1 : 0)
        if (scenario === 'retry') {
          await page.evaluate(() => { (window as any).permissionState = 'granted' })
          await allow.click()
          await expect(page.locator('.big-temp')).toHaveText('18°C')
          expect(await calls()).toBe(1)
        }
      } else if (scenario === 'late' || scenario === 'manual wins') {
        await expect.poll(calls).toBe(1)
        await page.clock.runFor(4600)
        await expect(allow).toBeVisible()
        await expect(page.locator('.main-card')).toHaveCount(0)
        if (scenario === 'manual wins') {
          await page.getByRole('button', { name: lang === 'bg' ? 'София' : 'Sofia', exact: true }).click()
          await expect(page.locator('.big-temp')).toHaveText('18°C')
        }
        await page.evaluate(() => (window as any).gpsCalls[0].success({ coords: { latitude: 43.2256, longitude: 27.8888, accuracy: 25 } }))
        await expect(page.locator('.big-temp')).toHaveText('18°C')
        if (scenario === 'manual wins') expect(requests.every(lat => lat === '42.6977')).toBe(true)
        else { expect(requests).toContain('43.2256'); await expect(allow).toHaveCount(0) }
        expect(await calls()).toBe(1)
      } else {
        await expect(page.locator('.big-temp')).toHaveText('18°C')
        expect(await calls()).toBe(scenario === 'saved' ? 0 : 1)
        expect(requests).toEqual([scenario === 'saved' ? '42.6977' : '43.2256'])
        await expect(allow).toHaveCount(0)
      }
      await expect(page.locator('.projects-section')).toHaveCount(1)
      await expect(page.locator('.project-card')).toHaveCount(4)
      for (const card of await page.locator('.project-card').all()) await expect(card).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
  }
}

// Exercise Chrome's real Permissions and Geolocation APIs, without a GPS-icon click.
// Headless automation verifies the native request, not the visual permission bubble.
for (const width of [390, 1440]) test(`clean Chrome invokes native geolocation automatically ${width}`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width, height: 900 }, geolocation: { latitude: 43.2256, longitude: 27.8888, accuracy: 25 } })
  const page = await context.newPage()
  await page.addInitScript(() => {
    if (location.origin !== 'http://127.0.0.1:4173') return
    const native = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation)
    ;(window as any).nativeGpsCalls = 0
    navigator.geolocation.getCurrentPosition = (...args) => {
      ;(window as any).nativeGpsCalls++
      native(...args)
    }
  })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/__permission_probe__') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Permission probe</title>' })
    if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/')) return route.continue()
    return route.fulfill({ json: url.hostname === 'api.open-meteo.com' ? weather : {} })
  })
  await page.goto('/__permission_probe__')
  const initialPermission = await page.evaluate(async () => (await navigator.permissions.query({ name: 'geolocation' })).state)
  if (initialPermission !== 'prompt') {
    await context.close()
    test.skip(true, `Clean browser does not expose prompt permission: ${initialPermission}; managed Chromium may enforce DefaultGeolocationSetting=2`)
  }
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => (window as any).nativeGpsCalls)).toBe(1)
  await expect(page.locator('.project-card')).toHaveCount(4)
  await context.close()
})
