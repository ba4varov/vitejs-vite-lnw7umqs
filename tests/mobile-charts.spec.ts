import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'

const widths = [320, 360, 390, 430, 640, 641, 768, 1440]
for (const width of widths) for (const lang of ['bg', 'en']) for (const dark of [false, true]) {
  test(`charts ${width} ${lang} ${dark}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(() => {
      const prototype = CanvasRenderingContext2D.prototype
      const clear = prototype.clearRect, fill = prototype.fillText
      prototype.clearRect = function (...args) { (this.canvas as any).drawnText = []; return clear.apply(this, args) }
      prototype.fillText = function (text, x, y, ...rest) {
        const metrics = this.measureText(text), w = metrics.width
        const left = this.textAlign === 'center' ? x - w / 2 : this.textAlign === 'right' ? x - w : x
        ;((this.canvas as any).drawnText ||= []).push({ text, left, right: left + w, y, top: y - metrics.actualBoundingBoxAscent })
        return fill.call(this, text, x, y, ...rest)
      }
    })
    await page.goto(`/tests/chart-fixture.html?lang=${lang}${dark ? '&dark' : ''}`)
    const tabs = page.getByRole('tab'), chart = page.locator('.charts-section')
    if (width <= 760) {
      await expect(tabs).toHaveCount(4)
      if (width <= 640) {
        const boxes = await tabs.evaluateAll(es => es.map(e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, h: b.height, overflow: e.scrollWidth > e.clientWidth } }))
        expect(boxes[0].y).toBe(boxes[1].y)
        expect(boxes[2].y).toBe(boxes[3].y)
        expect(boxes[2].y).toBeGreaterThan(boxes[0].y)
        for (const box of boxes) { expect(box.h).toBeGreaterThanOrEqual(44); expect(box.overflow).toBe(false) }
        await tabs.first().focus()
        expect(await tabs.first().evaluate(e => getComputedStyle(e).outlineStyle)).toBe('solid')
        await page.keyboard.press('Tab')
        await expect(tabs.nth(1)).toBeFocused()
        await page.keyboard.press('Space')
        await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
        await tabs.first().focus()
        await page.keyboard.press('Enter')
        await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
      }
    } else await expect(tabs).toHaveCount(0)
    for (let metric = 0; metric < 4; metric++) {
      if (width <= 760) { await tabs.nth(metric).scrollIntoViewIfNeeded(); await tabs.nth(metric).click(); await expect(tabs.nth(metric)).toHaveAttribute('aria-selected', 'true') }
      if (width <= 640) {
        const contrast = await tabs.nth(metric).evaluate(e => {
          const s = getComputedStyle(e)
          const luminance = (color: string) => {
            const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
            return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
          }
          const a = luminance(s.color), b = luminance(s.backgroundColor)
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
        })
        expect(contrast).toBeGreaterThanOrEqual(4.5)
      }
      const article = chart.locator('.mini-chart').nth(width <= 760 ? 0 : metric)
      const canvas = article.locator('canvas'), tooltip = article.getByRole('status')
      await expect.poll(() => canvas.evaluate(e => Boolean(e.style.width))).toBe(true)
      if (width <= 640) {
        const texts = await canvas.evaluate(e => ({ texts: (e as any).drawnText, width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height }))
        for (const text of texts.texts) { expect(text.left).toBeGreaterThanOrEqual(0); expect(text.right).toBeLessThanOrEqual(texts.width + .5) }
        const times = texts.texts.filter((text: any) => text.y === texts.height - 5)
        expect(times[0].text).toBe(lang === 'en' ? 'Now' : 'Сега')
        expect(times.at(-1).text).toBe('23:00')
        for (let i = 1; i < times.length; i++) expect(times[i].left).toBeGreaterThanOrEqual(times[i - 1].right + 9)
      }
      await canvas.focus()
      await expect(tooltip).toContainText('00:00')
      if (metric === 0) await expect(tooltip).toContainText('-12°C')
      for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight')
      await expect(tooltip).toContainText('23:00')
      const { frame, tip } = await article.evaluate(e => {
        const f = e.querySelector('.chart-frame')!.getBoundingClientRect(), t = e.querySelector('.chart-tooltip')!.getBoundingClientRect()
        return { frame: { x: f.x, y: f.y, width: f.width, height: f.height }, tip: { x: t.x, y: t.y, width: t.width, height: t.height } }
      })
      if (width <= 640) {
        expect(tip.x).toBeGreaterThanOrEqual(frame.x)
        expect(tip.x + tip.width).toBeLessThanOrEqual(frame.x + frame.width)
        expect(tip.y + tip.height).toBeLessThanOrEqual(frame.y + frame.height)
        const textTop = await canvas.evaluate(e => Math.min(...(e as any).drawnText.map((text: any) => text.top)))
        expect(tip.y + tip.height - frame.y).toBeLessThan(textTop)
      }
      if (lang === 'en') expect(await article.getAttribute('aria-label')).not.toMatch(/[А-Яа-я]/u)
      await canvas.blur()
      if (width <= 640 && test.info().config.configFile?.endsWith('playwright.charts.config.ts')) await expect(chart).toHaveScreenshot(`${width}-${lang}-${dark}-${metric}.png`, { animations: 'disabled' })
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const lang of ['bg', 'en']) for (const state of ['missing', 'zero', 'gap']) {
  test(`chart ${state} ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    await page.goto(`/tests/chart-fixture.html?lang=${lang}&${state}`)
    if (state === 'zero') {
      await page.getByRole('tab').nth(1).click()
      await expect(page.locator('.no-rain')).toContainText(lang === 'en' ? 'No precipitation expected' : 'Не се очакват валежи')
      await expect(page.locator('canvas')).toHaveCount(0)
    } else {
      for (let metric = 0; metric < 4; metric++) {
        await page.getByRole('tab').nth(metric).click()
        await page.locator('canvas').focus()
        await expect(page.locator('.chart-tooltip')).toContainText(lang === 'en' ? 'No data' : 'Няма данни')
        await page.keyboard.press('ArrowRight')
        if (state === 'gap') await expect(page.locator('.chart-tooltip')).not.toContainText(lang === 'en' ? 'No data' : 'Няма данни')
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('chart selection survives the 640px boundary and desktop overview', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 })
  await page.goto('/tests/chart-fixture.html?lang=en')
  await page.getByRole('tab').nth(1).click()
  for (const width of [641, 640, 768, 640]) {
    await page.setViewportSize({ width, height: 900 })
    if (width > 760) await expect(page.locator('.mini-chart')).toHaveCount(4)
    else {
      await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('.mini-chart h4')).toHaveText('Precipitation')
      const rows = await page.getByRole('tab').evaluateAll(es => es.map(e => e.getBoundingClientRect().y))
      expect(rows[2] > rows[0]).toBe(width <= 640)
    }
  }
})

for (const width of [320, 360, 390, 430, 640]) for (const lang of ['bg', 'en']) for (const dark of [false, true]) {
 test(`native finger scrubbing and vertical scroll ${width} ${lang} ${dark}`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  await page.goto(`/tests/chart-fixture.html?lang=${lang}${dark ? '&dark' : ''}`)
  const cdp = await context.newCDPSession(page)
  let box: { x: number, y: number, width: number, height: number }, y = 0
  const touch = (type: string, x: number, yy = y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: yy }] })
  for (let metric = 0; metric < 4; metric++) {
    await page.getByRole('tab').nth(metric).tap()
    const canvas = page.locator('canvas')
    await canvas.scrollIntoViewIfNeeded()
    box = (await canvas.boundingBox())!
    y = box.y + box.height / 2
    await touch('touchStart', box.x + 48)
    await expect(page.locator('.chart-tooltip')).toContainText('00:00')
    for (let i = 1; i <= 10; i++) await touch('touchMove', box.x + 48 + (box.width - 76) * i / 10)
    await expect(page.locator('.chart-tooltip')).toContainText('23:00')
    await touch('touchEnd', 0)
  }
  const before = await page.evaluate(() => scrollY)
  await touch('touchStart', box.x + box.width / 2)
  for (let i = 1; i <= 8; i++) await touch('touchMove', box.x + box.width / 2, y - i * 15)
  await touch('touchEnd', 0)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before)
  await context.close()
 })
}

for (const width of [641, 768, 1440]) for (const lang of ['bg', 'en']) for (const dark of [false, true]) {
  test(`unchanged main chart layout ${width} ${lang} ${dark}`, async ({ page }) => {
    test.skip(!existsSync('work/chart-baseline/fixture.html'), 'Run scripts/prepare-chart-baseline.mjs or use playwright.charts.config.ts')
    await page.setViewportSize({ width, height: 1000 })
    const suffix = `?lang=${lang}${dark ? '&dark' : ''}`
    const collect = async (url: string) => {
      await page.goto(url + suffix)
      await expect.poll(() => page.locator('canvas').evaluateAll(es => es.every(e => Boolean(e.style.width)))).toBe(true)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const geometry = await page.locator('.charts-section, .mini-chart, .chart-frame, .chart-selector, .chart-selector button').evaluateAll(es => es.map(e => {
        const r = e.getBoundingClientRect(), s = getComputedStyle(e)
        return { x: r.x, y: r.y, width: r.width, height: r.height, padding: s.padding, font: s.font, background: s.background, border: s.border, columns: s.gridTemplateColumns }
      }))
      const screenshot = await page.locator('.charts-section').screenshot({ animations: 'disabled', mask: lang === 'en' ? [page.locator('.chart-header'), page.locator('canvas')] : [] })
      return { geometry, screenshot }
    }
    const baseline = await collect('/work/chart-baseline/fixture.html')
    const actual = await collect('/tests/chart-fixture.html')
    expect(actual.geometry).toEqual(baseline.geometry)
    expect(actual.screenshot.equals(baseline.screenshot)).toBe(true)
  })
}
