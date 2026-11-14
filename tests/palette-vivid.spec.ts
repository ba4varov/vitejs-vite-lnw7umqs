import { expect, test } from '@playwright/test'
import { fixture } from './forecast-order-fixture'
import { openHeaderMenu } from './header-navigation'

// No new API fields, icons, dangerous-weather colors or markup are required.
test.describe('differentiated dashboard colors', () => {
  for (const width of [360, 390, 768, 1440]) {
    for (const lang of ['bg', 'en'] as const) {
      for (const dark of [false, true]) {
        test(`${width}px ${lang} ${dark ? 'dark' : 'light'} palette`, async ({ page }, testInfo) => {
          await page.setViewportSize({ width, height: 900 })
          await page.clock.setFixedTime(new Date('2026-10-13T08:00:00Z'))
          await page.addInitScript(() => {
            localStorage.setItem('meteoPulseConfirmedLocationV1', JSON.stringify({
              name: 'Varna', lat: 43.2141, lon: 27.9147, source: 'manual',
              geonameId: 726050, countryCode: 'BG'
            }))
          })
          await fixture(page, lang)
          if (dark) {
            await openHeaderMenu(page)
            await page.locator('.header-menu > .icon-btn').click()
            await expect(page.locator('.weather-app')).toHaveClass(/\bdark\b/)
          }

          const sections = page.locator('.hourly-section, .forecast-section, .weather-chat, .charts-section, .map-section, .aqi-section, .weather-planner')
          await expect(sections).toHaveCount(7)
          const surfaces = await sections.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundImage))
          expect(new Set(surfaces).size).toBe(7)
          expect(surfaces.every(surface => surface.includes('linear-gradient'))).toBe(true)

          // Weather is still represented by its WMO code, not the section's theme.
          await expect(page.locator('.weather-forecast-view')).toHaveClass(/weather-scene-clouds/)
          await expect(page.locator('.hourly-section .forecast-period-card').first()).toHaveClass(/forecast-tone-clouds/)

          // Seven visible visual categories for the hero metrics.
          const metric = page.locator('.weather-forecast-view .stats-grid > .stat-box')
          await expect(metric).toHaveCount(14)
          const stripes = await metric.evaluateAll(nodes => nodes.slice(0, 7).map(node => getComputedStyle(node).borderTopColor))
          expect(new Set(stripes).size).toBe(7)

          // AQI gets a panel theme, not a false safe/dangerous traffic-light state.
          const aqi = await page.locator('.aqi-section > .stats-grid > .stat-box').evaluateAll(nodes =>
            nodes.map(node => getComputedStyle(node).backgroundColor))
          expect(new Set(aqi).size).toBe(3)

          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          const cards = page.locator('.hourly-section .forecast-period-card')
          const dimensions = await cards.first().boundingBox()
          if (width <= 640) {
            expect(dimensions!.width).toBeLessThanOrEqual(158)
            expect(dimensions!.height).toBeGreaterThanOrEqual(210)
            expect(dimensions!.height).toBeLessThanOrEqual(230)
          } else {
            expect(dimensions!.width).toBe(174)
            expect(dimensions!.height).toBe(278)
          }

          await page.locator('.hourly-section').scrollIntoViewIfNeeded()
          await page.screenshot({path:testInfo.outputPath(`palette-${width}-${lang}-${dark ? 'dark' : 'light'}.png`),animations:'disabled',fullPage:false})
        })
      }
    }
  }

  test('chart surfaces preserve their distinct metric colors and interactivity', async ({page}) => {
    await page.setViewportSize({width:1440,height:900})
    await page.addInitScript(() => {
      localStorage.setItem('meteoPulseConfirmedLocationV1', JSON.stringify({
        name:'Varna',lat:43.2141,lon:27.9147,source:'manual',geonameId:726050,countryCode:'BG'
      }))
    })
    await fixture(page,'bg')
    const charts=page.locator('.charts-section .mini-chart')
    await expect(charts).toHaveCount(4)
    const fills=await charts.evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).backgroundImage))
    expect(new Set(fills).size).toBe(4)
    await expect(charts.first().locator('canvas')).toBeVisible()
    const first=page.locator('.hourly-section .forecast-period-card').first()
    await first.click()
    await expect(page.locator('.popup-card')).toBeVisible()
  })
})
