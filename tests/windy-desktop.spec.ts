import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fixture } from './forecast-order-fixture'

test.skip(!process.env.BASELINE_URL, 'Requires unchanged main on BASELINE_URL')
for (const width of [641, 768, 1440]) for (const lang of ['bg', 'en'] as const) for (const dark of [false, true]) {
  test(`Windy desktop matches main ${width} ${lang} ${dark}`, async ({ page, context }, info) => {
    test.setTimeout(120000)
    const baseline = await context.newPage()
    for (const [target, url] of [[page, '/'], [baseline, process.env.BASELINE_URL!]] as const) {
      await target.setViewportSize({ width, height: 900 })
      await target.clock.setFixedTime(new Date('2026-10-13T08:00:00Z'))
      await fixture(target, lang, 'guest', url)
      await target.route('https://embed.windy.com/**', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#b8d6e9"></body>' }))
      await target.reload()
      await expect(target.locator('.main-card .big-temp')).toBeVisible()
      if (dark) await target.locator('.header-menu > .icon-btn').click()
      await target.addStyleTag({ content: '*, *::before, *::after { animation:none!important; transition:none!important }' })
    }
    const geometry = (element: Element) => {
      const box = element.getBoundingClientRect()
      return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height }
    }
    for (const selector of ['.map-section', '.map-section iframe', '.footer']) expect(await page.locator(selector).evaluate(geometry)).toEqual(await baseline.locator(selector).evaluate(geometry))
    const path = info.snapshotPath(`${width}-${lang}-${dark}-main-map.png`)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, await baseline.locator('.map-section').screenshot({ animations: 'disabled' }))
    await expect(page.locator('.map-section')).toHaveScreenshot(`${width}-${lang}-${dark}-main-map.png`, { animations: 'disabled', maxDiffPixels: 0, timeout: 20000 })
    await baseline.close()
  })
}
