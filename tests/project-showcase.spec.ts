import { test, expect } from '@playwright/test'
import { weather } from './forecast-order-fixture'
import { clickHeaderControl } from './header-navigation'

for (const width of [390, 1440]) for (const lang of ['bg', 'en'] as const) for (const dark of [false, true]) {
  for (const scenario of ['forecast', 'denied', 'first visit', 'weather error'] as const) {
    test(`projects remain visible: ${scenario}, ${width}, ${lang}, ${dark ? 'dark' : 'light'}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.addInitScript(({ lang, scenario }) => {
        if (location.origin !== 'http://127.0.0.1:4173') return
        localStorage.clear()
        localStorage.setItem('meteoPulseLanguage', lang)
        if (scenario === 'forecast' || scenario === 'weather error') {
          localStorage.setItem('meteoPulseConfirmedLocationV1', JSON.stringify({ name: 'Varna', lat: 43.2141, lon: 27.9147, source: 'manual' }))
        }
        Object.defineProperty(navigator, 'permissions', { value: { query: async () => ({ state: scenario === 'first visit' ? 'prompt' : 'denied' }) } })
        Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: () => { throw new Error('Unexpected automatic GPS request') } } })
      }, { lang, scenario })
      let forecastRequests = 0
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/')) return route.continue()
        if (url.hostname === 'api.open-meteo.com') {
          forecastRequests++
          return route.fulfill({ status: scenario === 'weather error' ? 503 : 200, json: weather })
        }
        return route.fulfill({ json: {} })
      })
      await page.goto('/')
      if (dark) {
        await clickHeaderControl(page, page.getByRole('button', { name: lang === 'bg' ? 'Тъмна тема' : 'Dark theme', exact: true }))
        const menu = page.locator('.mobile-menu-toggle')
        if (await menu.isVisible()) await menu.click()
      }
      if (scenario === 'forecast') await expect(page.locator('.big-temp')).toHaveText('18°C')
      else if (scenario === 'weather error') await expect(page.getByRole('button', { name: lang === 'bg' ? 'Опитай отново' : 'Try Again', exact: true })).toBeVisible()
      else await expect(page.locator('.location-choice')).toBeVisible()

      const projects = page.locator('.projects-section')
      await expect(projects).toHaveCount(1)
      await expect(projects.getByRole('heading', { name: lang === 'bg' ? 'Нашите проекти' : 'Our projects', exact: true })).toBeVisible()
      await expect(projects.locator('.project-card')).toHaveCount(4)
      for (const name of ['Искра', 'NameriGo', 'Всичко е ВКУС и ЛЮБОВ', 'Rezzervo']) {
        await expect(projects.locator('.project-name').getByText(name, { exact: true })).toBeVisible()
      }
      await expect(page.locator('.main-card')).toHaveCount(scenario === 'forecast' ? 1 : 0)
      await expect(page.locator('.ad-slot')).toHaveCount(scenario === 'forecast' ? 1 : 0)
      if (scenario === 'denied' || scenario === 'first visit') expect(forecastRequests).toBe(0)
      const previousSelector = scenario === 'forecast' ? 'main' : scenario === 'weather error' ? '.card.center-text' : '.location-choice'
      await expect(page.locator(previousSelector)).toHaveCount(1)
      expect(await projects.evaluate((section, selector) => {
        const previous = document.querySelector(selector)
        return Boolean(previous && (previous.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING))
      }, previousSelector)).toBe(true)
      if (scenario === 'forecast') {
        expect(await projects.evaluate(section => Boolean(section.compareDocumentPosition(document.querySelector('.ad-slot')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
  }
}
