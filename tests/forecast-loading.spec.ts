import { test, expect } from '@playwright/test'
import { weather } from './forecast-order-fixture'
import { clickHeaderControl } from './header-navigation'

for (const width of [390, 1440]) for (const lang of ['bg', 'en'] as const) for (const dark of [false, true]) {
  test(`loading lifecycle ${width} ${lang} ${dark}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.clock.install()
    await page.addInitScript(lang => localStorage.setItem('meteoPulseLanguage', lang), lang)
    let fail = false, hold = true, count = 0
    const pending: (() => void)[] = []
    const release = () => { hold = false; pending.splice(0).forEach(resolve => resolve()) }
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.hostname === '127.0.0.1') return route.continue()
      if (url.hostname === 'api.open-meteo.com') {
        count++
        const failing = fail
        if (hold) await new Promise<void>(resolve => pending.push(resolve))
        return route.fulfill({ status: failing ? 503 : 200, json: weather })
      }
      return route.fulfill({ json: {} })
    })
    await page.goto('/')
    await page.evaluate(() => {
      (window as any).prematureProjects = false
      new MutationObserver(() => {
        if (document.querySelector('.ad-slot') && !document.querySelector('.main-card')) (window as any).prematureProjects = true
      }).observe(document.body, { childList: true, subtree: true })
    })
    if (dark) {
      await clickHeaderControl(page, page.locator('.header-menu > .icon-btn'))
      const menu = page.locator('.mobile-menu-toggle')
      if (await menu.isVisible()) await menu.click()
    }
    await expect(page.locator('.forecast-loading')).toBeVisible()
    await expect(page.locator('.forecast-loading')).toContainText(lang === 'bg' ? 'Подготвяме' : 'Preparing')
    await expect(page.locator('.ad-slot')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: lang === 'bg' ? 'Нашите проекти' : 'Our projects' })).toHaveCount(0)
    expect((await page.locator('.forecast-loading').boundingBox())!.height).toBeLessThan(220)
    if (width === 390 && lang === 'bg' && !dark) await page.locator('.forecast-loading').screenshot({ path: 'work/forecast-loading.png' })
    release()
    await expect(page.locator('.big-temp')).toHaveText('18°C')
    await expect(page.locator('.ad-slot')).toHaveCount(1)
    hold = true
    await page.clock.fastForward(15 * 60 * 1000)
    await expect(page.locator('.forecast-refresh')).toBeVisible()
    await expect(page.locator('.big-temp')).toHaveText('18°C')
    await expect(page.locator('.forecast-loading')).toHaveCount(0)
    release()
    await expect(page.locator('.forecast-refresh')).toHaveCount(0)
    hold = true; fail = true
    await page.getByRole('button', { name: lang === 'bg' ? 'София' : 'Sofia', exact: true }).click()
    await expect(page.locator('.forecast-loading')).toBeVisible()
    await expect(page.locator('.main-card')).toHaveCount(0)
    await expect(page.locator('.ad-slot')).toHaveCount(0)
    release()
    const retry = page.getByRole('button', { name: lang === 'bg' ? 'Опитай отново' : 'Try Again', exact: true })
    await expect(retry).toBeVisible()
    await expect(page.locator('.ad-slot')).toHaveCount(0)
    fail = false
    await retry.click()
    await expect(page.locator('.big-temp')).toHaveText('18°C')
    await expect(page.locator('.main-card h2')).toContainText(lang === 'bg' ? 'София' : 'Sofia')
    expect(count).toBeGreaterThanOrEqual(4)
    expect(await page.evaluate(() => (window as any).prematureProjects)).toBe(false)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const scenario of ['initial error', 'geolocation stale response', 'manual selection wins']) {
  test(scenario, async ({ page }) => {
    let fail = scenario === 'initial error'
    const delayed: (() => void)[] = []
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (success: any) => { (window as any).locate = success } } })
    })
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.hostname === '127.0.0.1') return route.continue()
      if (url.hostname === 'api.open-meteo.com') {
        const lat = url.searchParams.get('latitude')
        if (scenario !== 'initial error' && lat === '43.2141') await new Promise<void>(resolve => delayed.push(resolve))
        return route.fulfill({ status: fail ? 503 : 200, json: { ...weather, current: { ...weather.current, temperature_2m: lat === '43.2141' ? 18 : 25 } } })
      }
      return route.fulfill({ json: {} })
    })
    await page.goto('/')
    if (scenario === 'initial error') {
      await expect(page.getByRole('button', { name: 'Опитай отново', exact: true })).toBeVisible()
      await expect(page.locator('.ad-slot')).toHaveCount(0)
      await expect(page.locator('.main-card')).toHaveCount(0)
      fail = false
      await page.getByRole('button', { name: 'Опитай отново', exact: true }).click()
      await expect(page.locator('.big-temp')).toHaveText('18°C')
    } else {
      if (scenario === 'manual selection wins') await page.getByRole('button', { name: 'София', exact: true }).click()
      await page.evaluate(() => (window as any).locate({ coords: { latitude: 42, longitude: 24 } }))
      await expect(page.locator('.big-temp')).toHaveText('25°C')
      delayed.splice(0).forEach(resolve => resolve())
      await page.waitForLoadState('networkidle')
      await expect(page.locator('.big-temp')).toHaveText('25°C')
      await expect(page.locator('.main-card h2')).toContainText(scenario === 'manual selection wins' ? 'София' : 'Моето местоположение')
    }
  })
}
