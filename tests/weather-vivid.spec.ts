import { test, expect } from '@playwright/test'
import { weather } from './forecast-order-fixture'

// The redesign must be forecast-driven, mobile-safe and make zero image API requests.
for (const [code, scene] of [[0, 'fair'], [3, 'clouds'], [61, 'rain'], [75, 'snow'], [45, 'fog'], [95, 'storm']] as const) {
  for (const width of [390, 1440]) {
    test(`atmospheric hero ${scene} on ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.addInitScript(() => {
        localStorage.setItem('meteoPulseLanguage', 'bg')
        localStorage.setItem('meteoPulseConfirmedLocationV1', JSON.stringify({
          name: 'Варна', lat: 43.2141, lon: 27.9147, source: 'manual',
          geonameId: 726050, countryCode: 'BG',
        }))
      })
      const forecast = structuredClone(weather)
      forecast.current.weather_code = code
      forecast.current.time = '2026-10-13T12:00'
      const externalImages: string[] = []
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname === 'picsum.photos') externalImages.push(url.href)
        if (url.pathname === '/api/alerts' && url.searchParams.get('source') === 'nimh') {
          return route.fulfill({ json: { status: 'resolved', days: [] } })
        }
        if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/')) return route.continue()
        return route.fulfill({ json: url.hostname === 'api.open-meteo.com' ? forecast : {} })
      })
      await page.goto('/')
      const hero = page.locator('.weather-forecast-view')
      await expect(hero).toHaveClass(new RegExp(`weather-scene-${scene}`))
      await expect(hero.locator('.weather-atmosphere')).toHaveAttribute('aria-hidden', 'true')
      await expect(hero.locator('.big-temp')).toBeVisible()
      expect(await hero.evaluate(node => getComputedStyle(node).backgroundImage)).toContain('gradient')
      expect(externalImages).toHaveLength(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }
}

test('nighttime palette and reduced motion preserve readable content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    localStorage.setItem('meteoPulseLanguage', 'en')
    localStorage.setItem('meteoPulseConfirmedLocationV1', JSON.stringify({
      name: 'London', lat: 51.5074, lon: -0.1278, source: 'manual',
      geonameId: 2643743, countryCode: 'GB',
    }))
  })
  const forecast = structuredClone(weather)
  forecast.current.weather_code = 0
  forecast.current.time = '2026-10-13T22:00'
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/')) return route.continue()
    return route.fulfill({ json: url.hostname === 'api.open-meteo.com' ? forecast : {} })
  })
  await page.goto('/')
  const hero = page.locator('.weather-forecast-view')
  await expect(hero).toHaveClass(/weather-scene-night/)
  await expect(hero.locator('.big-temp')).toBeVisible()
  expect(await hero.locator('.atmosphere-orb').evaluate(node => getComputedStyle(node).animationName)).toBe('none')
  expect(await hero.locator('.big-temp').evaluate(node => getComputedStyle(node).color)).toBe('rgb(255, 255, 255)')
})

test.describe('responsive atmospheric dashboard and header', () => {
  for (const width of [360, 390, 768, 1440]) {
    for (const lang of ['bg', 'en'] as const) {
      for (const dark of [false, true]) {
        test(`${width}px ${lang} ${dark ? 'dark' : 'light'} theme`, async ({ page }, testInfo) => {
          await page.setViewportSize({ width, height: 900 })
          await page.addInitScript(language => {
            localStorage.setItem('meteoPulseLanguage', language)
            localStorage.setItem('meteoPulseConfirmedLocationV1', JSON.stringify({
              name: 'Varna', lat: 43.2141, lon: 27.9147, source: 'manual',
              geonameId: 726050, countryCode: 'BG',
            }))
          }, lang)
          const forecast = structuredClone(weather)
          forecast.current.weather_code = 3
          forecast.current.time = '2026-10-13T12:00'
          await page.route('**/*', route => {
            const url = new URL(route.request().url())
            if (url.pathname === '/api/alerts' && url.searchParams.get('source') === 'nimh') {
              return route.fulfill({ json: { status: 'resolved', days: [] } })
            }
            if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/')) return route.continue()
            return route.fulfill({ json: url.hostname === 'api.open-meteo.com' ? forecast : {} })
          })
          await page.goto('/')
          const hero = page.locator('.weather-forecast-view')
          await expect(hero).toHaveClass(/weather-scene-clouds/)
          await expect(page.locator('.header-row')).toBeVisible()
          await expect(hero.locator('.big-temp')).toBeVisible()
          if (dark) {
            const menu = page.locator('.mobile-menu-toggle')
            if (await menu.isVisible()) await menu.click()
            await page.locator('.header-menu > .icon-btn').click()
            await expect(page.locator('.weather-app')).toHaveClass(/\\bdark\\b/)
          }
          if (width <= 640) await expect(hero.locator('.metrics-toggle')).toBeVisible()
          else await expect(hero.locator('.metrics-toggle')).toBeHidden()
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
          const ink = await hero.locator('.big-temp').evaluate(node => getComputedStyle(node).color)
          expect(ink).toBe('rgb(255, 255, 255)')
          await page.screenshot({ path: testInfo.outputPath(`vivid-${width}-${lang}-${dark ? 'dark' : 'light'}.png`), fullPage: false })
        })
      }
    }
  }
})
