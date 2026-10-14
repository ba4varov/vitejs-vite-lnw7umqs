import { test, expect } from '@playwright/test'
import { fixture } from './forecast-order-fixture'
import { openHeaderMenu } from './header-navigation'

test.describe.configure({ mode: 'parallel' })

for (const width of [320, 360, 390, 430, 640, 641, 768, 1440]) for (const lang of ['bg', 'en'] as const) for (const dark of [false, true]) {
  test(`AQI ${width} ${lang} ${dark}`, async ({ page }, info) => {
    test.setTimeout(90000)
    await page.setViewportSize({ width, height: 900 })
    await page.clock.setFixedTime(new Date('2026-10-13T08:00:00Z'))
    await fixture(page, lang)
    let current: Record<string, number | null> = { european_aqi: 42, pm10: 12.5, pm2_5: 8.2 }
    await page.route('https://air-quality-api.open-meteo.com/**', route => route.fulfill({ json: {
      current, hourly: { time: Array.from({ length: 72 }, (_, i) => new Date(Date.UTC(2026, 9, 13, i)).toISOString().slice(0, 16)), european_aqi: Array(72).fill(42) },
    } }))
    await page.reload()
    await expect(page.locator('.aqi-section .value').first()).toHaveText('42')
    const applyTheme = async () => {
      if (dark) {
        await openHeaderMenu(page)
        await page.locator('.header-menu > .icon-btn').click()
        if (width <= 640) await page.locator('.mobile-menu-toggle').click()
      }
      await expect(page.locator('.weather-app')).toHaveClass(dark ? /dark/ : /^weather-app$/)
    }
    await applyTheme()
    await page.addStyleTag({ content: '*, *::before, *::after { animation:none!important; transition:none!important }' })
    const section = page.locator('.aqi-section'), cards = section.locator('.stat-box')
    await expect(cards).toHaveCount(3)
    await expect(cards.nth(0).locator('.label')).toHaveText(lang === 'bg' ? 'AQI Индекс' : 'AQI Index')
    await expect(cards.nth(1).locator('.label')).toContainText('PM10')
    await expect(cards.nth(2).locator('.label')).toContainText('PM2.5')
    const boxes = await cards.evaluateAll(es => es.map(e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, bottom: b.bottom } }))
    if (width <= 640) {
      expect(boxes[0].w).toBeGreaterThan(boxes[1].w * 1.9)
      expect(boxes[1].y).toBe(boxes[2].y)
      expect(boxes[1].x).toBeLessThan(boxes[2].x)
      expect(boxes[1].y).toBeGreaterThanOrEqual(boxes[0].bottom)
      expect(boxes[2].bottom - boxes[0].y).toBeLessThan(230)
    }
    expect((await section.locator('.charts-grid').boundingBox())!.y).toBeGreaterThanOrEqual(Math.max(...boxes.map(b => b.bottom)))
    await expect(section.locator('.mini-chart')).toHaveCount(1)
    const readable = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const metrics = await cards.evaluateAll(es => es.flatMap(e => {
        const box = e.getBoundingClientRect()
        const lum = (s: string) => s.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
        return [...e.querySelectorAll('.label, .value')].map(p => {
          const s = getComputedStyle(p), b = p.getBoundingClientRect(), bg = lum(getComputedStyle(e).backgroundColor), fg = lum(s.color)
          return { fits: p.scrollWidth <= p.clientWidth + 1 && b.left >= box.left && b.right <= box.right && b.bottom <= box.bottom, font: parseFloat(s.fontSize), contrast: (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05) }
        })
      }))
      for (const m of metrics) { expect(m.fits).toBe(true); if (width <= 640) { expect(m.font).toBeGreaterThanOrEqual(14); expect(m.contrast).toBeGreaterThanOrEqual(4.5) } }
    }
    await readable()
    await section.screenshot({ path: info.outputPath('normal.png'), animations: 'disabled' })
    for (const [mode, values] of Object.entries({ long: { european_aqi: 123456789123456780000, pm10: 123456789123456780000, pm2_5: 123456789.123456 }, zero: { european_aqi: 0, pm10: 0, pm2_5: 0 }, missing: { european_aqi: null, pm10: null } })) {
      current = values
      await page.reload()
      await expect(cards).toHaveCount(3)
      await expect(cards.first().locator('.value')).toHaveText(mode === 'missing' ? (lang === 'bg' ? 'Няма данни' : 'No data') : mode === 'zero' ? '0' : '123456789123456780000')
      if (mode === 'zero') for (const card of [cards.nth(1), cards.nth(2)]) await expect(card.locator('.value')).toHaveText('0 µg/m³')
      if (mode === 'missing') await expect(section).not.toContainText(/undefined|null|NaN|µg/)
      await applyTheme()
      await readable()
    }
  })
}
