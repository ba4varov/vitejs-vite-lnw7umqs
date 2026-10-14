import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fixture } from './forecast-order-fixture'

test.describe.configure({ mode: 'parallel' })
// Compare against unchanged main with identical AQI observations.
test.skip(!process.env.BASELINE_URL, 'Requires a local unchanged-main server')
for (const width of [641,768,1440]) for (const lang of ['bg','en'] as const) for (const dark of [false,true]) {
  test(`AQI desktop matches main ${width} ${lang} ${dark}`, async ({ page, context }, testInfo) => {
    test.setTimeout(120000)
    const baseline = await context.newPage()
    for (const [target, url] of [[page, '/'], [baseline, process.env.BASELINE_URL!]] as const) {
      await target.setViewportSize({ width, height: 900 })
      await target.clock.setFixedTime(new Date('2026-10-13T08:00:00Z'))
      await fixture(target, lang, 'guest', url)
      await target.route('https://air-quality-api.open-meteo.com/**', route => route.fulfill({ json: { current: { european_aqi: 42, pm10: 12.5, pm2_5: 8.2 }, hourly: { time: ['2026-10-13T08:00'], european_aqi: [42] } } }))
      await target.route('https://embed.windy.com/**', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#b8d6e9"></body>' }))
      await target.reload()
      await expect(target.locator('.aqi-section .value').first()).toHaveText('42', { timeout: 15000 })
      if (dark) await target.locator('.header-menu > .icon-btn').click()
      await expect(target.locator('.hourly-row button')).toHaveCount(24)
      await target.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' })
      await target.mouse.move(0, 0)
    }
    for (const selector of ['.aqi-section', '.charts-section', '.map-section', '.main-card', '.weather-chat', '.hourly-section', '.forecast-section']) {
      const geometry = (element: Element) => {
        const box = element.getBoundingClientRect()
        return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height }
      }
      expect(await page.locator(selector).evaluate(geometry)).toEqual(await baseline.locator(selector).evaluate(geometry))
      if (selector === '.main-card') {
        const metrics = (element: Element) => [...element.querySelectorAll('.stat-box .label, .stat-box .value')].map(node => {
          const box = node.getBoundingClientRect(), parent = element.getBoundingClientRect(), style = getComputedStyle(node)
          return { text: node.textContent, x: box.x - parent.x, y: box.y - parent.y, width: box.width, height: box.height, font: style.font, color: style.color }
        })
        expect(await page.locator(selector).evaluate(metrics)).toEqual(await baseline.locator(selector).evaluate(metrics))
      }
      // Generate the expected image from main for this run, under ignored work/.
      const name = `${width}-${lang}-${dark}-${selector.slice(1)}.png`
      const path = testInfo.snapshotPath(name)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, await baseline.locator(selector).screenshot({ animations: 'disabled' }))
      // AQI/charts/map require zero differing pixels. Retain the existing
      // forecast comparison tolerance for text rasterization in other sections.
      await expect(page.locator(selector)).toHaveScreenshot(name, { animations: 'disabled', ...(selector === '.aqi-section' || selector === '.charts-section' || selector === '.map-section' ? { maxDiffPixels: 0 } : { threshold: .2, maxDiffPixelRatio: .005 }), timeout: 20000 })
    }
    await baseline.close()
  })
}
