import { test, expect, type Page } from '@playwright/test'
import { fixture } from './forecast-order-fixture'
import { openHeaderMenu } from './header-navigation'

test.use({ hasTouch: true })

async function readableCards(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const cards = await page.locator('.forecast-period-card').evaluateAll(elements => elements.map(element => {
    const parent = element.getBoundingClientRect()
    const children = [...element.children].map(child => {
      const box = child.getBoundingClientRect()
      return { icon: child.getAttribute('data-category') === 'icon', top: box.top, bottom: box.bottom, left: box.left, right: box.right,
        width: child.clientWidth, scrollWidth: child.scrollWidth, height: child.clientHeight, scrollHeight: child.scrollHeight }
    })
    return { top: parent.top, bottom: parent.bottom, left: parent.left, right: parent.right, children }
  }))
  for (const card of cards) {
    for (const [index, child] of card.children.entries()) {
      expect(child.left).toBeGreaterThanOrEqual(card.left)
      expect(child.right).toBeLessThanOrEqual(card.right)
      expect(child.top).toBeGreaterThanOrEqual(card.top)
      expect(child.bottom).toBeLessThanOrEqual(card.bottom)
      expect(child.scrollWidth).toBeLessThanOrEqual(child.width + 1)
      // Emoji ink can extend past its line box without clipping (overflow is visible).
      if (!child.icon) expect(child.scrollHeight).toBeLessThanOrEqual(child.height + 1)
      if (index) expect(child.top).toBeGreaterThanOrEqual(card.children[index - 1].bottom)
    }
  }
}

async function mobileTypography(page: Page) {
  const metrics = await page.locator('.forecast-period-card').first().evaluate(card => {
    const luminance = (color: string) => {
      const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => {
        const s = v / 255
        return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4
      })
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
    }
    const background = luminance(getComputedStyle(card).backgroundColor)
    return [...card.querySelectorAll('.forecast-period strong, .forecast-period small, .forecast-condition, .forecast-temperature, .forecast-secondary')].map(child => {
      const style = getComputedStyle(child), foreground = luminance(style.color)
      return { category: child.className || child.tagName, font: parseFloat(style.fontSize), contrast: (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05) }
    })
  })
  for (const metric of metrics) {
    expect(metric.font).toBeGreaterThanOrEqual(metric.category === 'SMALL' ? 13 : metric.category === 'forecast-temperature' ? 26 : 14)
    expect(metric.contrast).toBeGreaterThanOrEqual(4.5)
  }
}

for (const width of [320, 360, 390, 430, 640, 641, 768, 1440]) for (const lang of ['bg', 'en'] as const) for (const dark of [false, true]) {
  test(`forecast cards ${width} ${lang} ${dark ? 'dark' : 'light'}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.clock.setFixedTime(new Date('2026-10-13T08:00:00Z'))
    await fixture(page, lang)
    if (dark) {
      await openHeaderMenu(page)
      await page.locator('.header-menu > .icon-btn').click()
      if (width <= 640) await page.locator('.mobile-menu-toggle').click()
    }
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' })
    await page.mouse.move(0, 0)
    await readableCards(page)
    for (const [section, row, rain, temperature] of [
      ['.hourly-section', '.hourly-row', '0.2', '18°C'],
      ['.forecast-section', '.daily-grid', '1.2', '22°C'],
    ]) {
      const strip = page.locator(row), card = strip.locator('.forecast-period-card').first()
      await expect(card.locator('.forecast-temperature')).toHaveText(temperature)
      await expect(card.locator('[data-category="precipitation"]')).toHaveText(`🌧 ${rain}${lang === 'bg' ? ' мм' : ' mm'}`)
      await expect(card).toHaveAccessibleName(lang === 'bg' ? /скорост|Скорост/ : /wind speed/i)
      const geometry = await card.boundingBox()
      if (width <= 640) {
        await mobileTypography(page)
        expect(geometry!.height).toBeGreaterThanOrEqual(210)
        expect(geometry!.height).toBeLessThanOrEqual(230)
        expect(geometry!.width).toBeLessThanOrEqual(158)
        const style = await strip.evaluate(e => ({ touch: getComputedStyle(e).touchAction, snap: getComputedStyle(e).scrollSnapType }))
        expect(style).toEqual({ touch: 'pan-x pinch-zoom', snap: 'x mandatory' })
        if (width === 360 || width === 390) expect(await strip.evaluate(e => e.clientWidth / (e.querySelector('button')!.getBoundingClientRect().width + 8))).toBeGreaterThanOrEqual(1.85)
        // Persistent, reviewable baselines use the dedicated forecast config.
        if (testInfo.config.configFile?.endsWith('playwright.forecast-cards.config.ts')) {
          await expect(page.locator(section)).toHaveScreenshot(`${width}-${lang}-${dark}-${section.slice(1)}.png`, { animations: 'disabled' })
        }
      } else {
        expect(geometry!.width).toBe(174)
        expect(geometry!.height).toBe(278)
      }
      await page.locator(section + ' .forecast-scroll-controls button').last().click()
      await expect.poll(() => strip.evaluate(e => e.scrollLeft)).toBeGreaterThan(0)
      await page.locator(section + ' .forecast-scroll-controls button').first().click()
      await expect.poll(() => strip.evaluate(e => e.scrollLeft)).toBeLessThanOrEqual(3)
      await strip.focus()
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => strip.evaluate(e => e.scrollLeft)).toBeGreaterThan(0)
      await card.focus()
      await page.keyboard.press('Space')
      await expect(page.locator('.popup-card')).toBeVisible()
      await expect(card).toHaveAttribute('aria-pressed', 'true')
      if (width <= 640) await mobileTypography(page)
      await page.locator('.popup-card button').first().click()
      await card.tap()
      await expect(page.locator('.popup-card')).toBeVisible()
      await page.locator('.popup-card button').first().click()
      if (width <= 640) {
        await strip.evaluate(e => { e.scrollLeft = 0 })
        await strip.scrollIntoViewIfNeeded()
        const box = (await strip.boundingBox())!
        const y = Math.max(1, box.y + 80), x = box.x + box.width - 15
        const scrollY = await page.evaluate(() => window.scrollY)
        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
        for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - step * 15, y: y + step * 2 }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect.poll(() => strip.evaluate(e => e.scrollLeft)).toBeGreaterThan(0)
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
        await cdp.detach()
      }
    }
  })
}

for (const width of [320, 360, 390, 430, 640]) for (const lang of ['bg', 'en']) for (const dark of [false, true]) {
  test(`long and missing content ${width} ${lang} ${dark}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    for (const missing of [false, true]) {
      await page.goto(`/tests/forecast-card-fixture.html?lang=${lang}&dark=${dark}&missing=${missing}`)
      await expect(page.locator('.forecast-period-card')).toHaveCount(6)
      await readableCards(page)
      const card = page.locator('.forecast-period-card').first()
      await expect(card.locator('.forecast-temperature')).toHaveText(missing ? '—' : '-123456789.123456°C')
      await expect(card.locator('[data-category="precipitation"]')).toHaveText(missing ? '🌧 —' : `🌧 123456789.123456${lang === 'bg' ? ' мм' : ' mm'}`)
      expect((await card.boundingBox())!.height).toBeGreaterThan(230)
      await card.tap()
      await expect(card).toHaveAttribute('aria-pressed', 'true')
      if (!missing && width === 320) await page.screenshot({ path: testInfo.outputPath(`long-${lang}-${dark}.png`), fullPage: true })
    }
  })
}
