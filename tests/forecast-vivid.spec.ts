import { test, expect, type Page } from '@playwright/test'
import { weather } from './forecast-order-fixture'
import { openHeaderMenu } from './header-navigation'

async function loadScene(page: Page, code: number, lang: 'bg' | 'en') {
  await page.addInitScript(language => {
    localStorage.setItem('meteoPulseLanguage', language)
    localStorage.setItem('meteoPulseConfirmedLocationV1', JSON.stringify({
      name: 'Varna', lat: 43.2141, lon: 27.9147, source: 'manual',
      geonameId: 726050, countryCode: 'BG'
    }))
  }, lang)
  const snapshot = structuredClone(weather)
  snapshot.current.time = '2026-10-13T12:00'
  snapshot.current.weather_code = code
  snapshot.hourly.weather_code = snapshot.hourly.weather_code.map(() => code)
  snapshot.daily.weather_code = snapshot.daily.weather_code.map(() => code)
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (u.pathname === '/api/alerts' && u.searchParams.get('source') === 'nimh') {
      return route.fulfill({ json: { status: 'resolved', days: [] } })
    }
    if (u.hostname === '127.0.0.1' && !u.pathname.startsWith('/api/')) return route.continue()
    return route.fulfill({ json: u.hostname === 'api.open-meteo.com' ? snapshot : {} })
  })
  await page.goto('/')
  await expect(page.locator('.forecast-period-card').first()).toBeVisible()
}

for (const [code, tone] of [[0, 'fair'], [3, 'clouds'], [61, 'rain'], [75, 'snow'], [45, 'fog'], [95, 'storm']] as const) {
  for (const width of [390, 1440]) for (const dark of [false, true]) {
    test(`forecast tone ${tone}: ${width}px, ${dark ? 'dark' : 'light'}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await loadScene(page, code, 'bg')
      if (dark) {
        await openHeaderMenu(page)
        await page.locator('.header-menu > .icon-btn').click()
        await expect(page.locator('.weather-app')).toHaveClass(/\bdark\b/)
      }
      const hour = page.locator('.hourly-section .forecast-period-card').first()
      const day = page.locator('.forecast-section .forecast-period-card').first()
      await expect(hour).toHaveClass(new RegExp(`forecast-tone-${tone}`))
      await expect(day).toHaveClass(new RegExp(`forecast-tone-${tone}`))
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const cardSize = await hour.boundingBox()
      if (width <= 640) {
        expect(cardSize!.width).toBeLessThanOrEqual(158)
        expect(cardSize!.height).toBeGreaterThanOrEqual(210)
        expect(cardSize!.height).toBeLessThanOrEqual(230)
      } else {
        expect(cardSize!.width).toBe(174)
        expect(cardSize!.height).toBe(278)
      }
      await page.screenshot({
        path: testInfo.outputPath(`forecast-tone-${tone}-${width}-${dark ? 'dark' : 'light'}.png`),
        fullPage: false,
        animations: 'disabled'
      })
    })
  }
}

for (const width of [360, 390, 768, 1440]) for (const lang of ['bg', 'en'] as const) {
  test(`forecast selection and chart controls ${width}px ${lang}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await loadScene(page, 3, lang)
    const hour = page.locator('.hourly-section .forecast-period-card').first()
    await hour.click()
    await expect(hour).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.popup-card')).toBeVisible()
    await page.locator('.popup-card button').first().click()
    await expect(page.locator('.popup-card')).toHaveCount(0)

    const section = page.locator('.charts-section')
    await section.scrollIntoViewIfNeeded()
    const chart = section.locator('.mini-chart')
    if (width <= 760) {
      await expect(section.locator('.chart-selector')).toBeVisible()
      const buttons = section.locator('.chart-selector button')
      await expect(buttons).toHaveCount(4)
      for (const key of ['temp', 'rain', 'wind', 'pressure']) {
        const index = ['temp', 'rain', 'wind', 'pressure'].indexOf(key)
        await buttons.nth(index).click()
        await expect(chart).toHaveCount(1)
        await expect(chart.first()).toHaveClass(new RegExp(`mini-chart-${key}`))
        await expect(buttons.nth(index)).toHaveAttribute('aria-selected', 'true')
      }
    } else {
      await expect(section.locator('.chart-selector')).toBeHidden()
      await expect(chart).toHaveCount(4)
      for (const type of ['temp', 'rain', 'wind', 'pressure']) {
        await expect(section.locator(`.mini-chart-${type}`)).toHaveCount(1)
      }
    }
    await expect(chart.first().locator('canvas')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`chart-controls-${width}-${lang}.png`),
      fullPage: false,
      animations: 'disabled'
    })
  })
}

test('forecast decorations respect reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await loadScene(page, 61, 'en')
  const card = page.locator('.forecast-period-card').first()
  await expect(card).toHaveClass(/forecast-tone-rain/)
  const transition = await card.evaluate(node => getComputedStyle(node).transitionDuration)
  expect(transition.split(',').every(value => parseFloat(value) === 0)).toBe(true)
})
