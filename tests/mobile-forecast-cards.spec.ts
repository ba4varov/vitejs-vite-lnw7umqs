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
        expect(style).toEqual({ touch: 'manipulation', snap: 'x mandatory' })
        if (width === 360 || width === 390) expect(await strip.evaluate(e => e.clientWidth / (e.querySelector('button')!.getBoundingClientRect().width + 8))).toBeGreaterThanOrEqual(1.85)
        // Persistent, reviewable baselines use the dedicated forecast config.
        if (testInfo.config.configFile?.endsWith('playwright.forecast-cards.config.ts')) {
          const target = page.locator(section)
          await target.scrollIntoViewIfNeeded()
          // Keep the complete clip away from the viewport edge: Chromium can
          // otherwise include a blank last row when it rounds fractional bounds.
          await target.evaluate(element => {
            const top = element.getBoundingClientRect().top + window.scrollY
            window.scrollTo({ top: Math.floor(top) - 100, behavior: 'instant' })
          })
          // Current-card height can change the section's fractional page position.
          // Align only screenshot capture to device pixels; retain strict comparison
          // and restore its original positioning before exercising the controls.
          const originalPosition = await target.evaluate(element => {
            const target = element as HTMLElement
            const original = { position: target.style.position, top: target.style.top, left: target.style.left }
            const box = target.getBoundingClientRect()
            target.style.position = 'relative'
            target.style.top = `${Math.round(box.y) - box.y}px`
            target.style.left = `${Math.round(box.x) - box.x}px`
            return original
          })
          try {
            await expect(target).toHaveScreenshot(`${width}-${lang}-${dark}-${section.slice(1)}.png`, { animations: 'disabled' })
          } finally {
            await target.evaluate((element, original) => { Object.assign((element as HTMLElement).style, original) }, originalPosition)
          }
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

test.describe('native gestures starting on forecast cards', () => {
  test.use({ isMobile: true })
  for (const width of [320, 360, 390, 430, 640]) for (const lang of ['bg', 'en'] as const) for (const dark of [false, true]) {
    test(`horizontal, vertical and pinch ${width} ${lang} ${dark}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await fixture(page, lang)
      if (dark) {
        await openHeaderMenu(page)
        await page.locator('.header-menu > .icon-btn').click()
        await page.locator('.mobile-menu-toggle').click()
      }
      const cdp = await page.context().newCDPSession(page)
      const settled = async () => {
        const position = () => page.evaluate(() => [scrollY, ...Array.from(document.querySelectorAll('.hourly-row, .daily-grid'), e => e.scrollLeft)])
        await expect.poll(async () => {
          const before = await position()
          await page.waitForTimeout(100)
          return (await position()).join(',') === before.join(',')
        }).toBe(true)
      }
      const swipe = async (x: number, y: number, dx: number, dy: number) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] })
        for (let step = 1; step <= 10; step++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 10, y: y + dy * step / 10, id: 0 }] })
          await page.waitForTimeout(16) // Deliver a real sequence of gesture frames.
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      }
      for (const row of ['.hourly-row', '.daily-grid']) {
        const strip = page.locator(row), card = strip.locator('.forecast-period-card').first()
        await card.evaluate(e => e.scrollIntoView({ block: 'center' }))
        let box = (await card.boundingBox())!
        const beforeHorizontal = await page.evaluate(() => scrollY)
        await swipe(box.x + box.width - 10, box.y + box.height / 2, -120, 8)
        await expect.poll(() => strip.evaluate(e => e.scrollLeft)).toBeGreaterThan(0)
        await settled()
        expect(await page.evaluate(() => scrollY)).toBe(beforeHorizontal)
        await expect(page.locator('.popup-card')).toHaveCount(0)

        await strip.evaluate(e => { e.scrollLeft = 0 })
        await expect.poll(() => strip.evaluate(e => e.scrollLeft)).toBeLessThanOrEqual(3)
        await card.evaluate(e => e.scrollIntoView({ block: 'center' }))
        box = (await card.boundingBox())!
        const beforeVertical = await page.evaluate(() => scrollY)
        const horizontalOffset = await strip.evaluate(e => e.scrollLeft)
        // Start on the card, rather than its surrounding section or page gutter.
        await swipe(box.x + box.width / 2, box.y + box.height / 2, 8, -140)
        await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(beforeVertical + 60)
        await settled()
        expect(await strip.evaluate(e => e.scrollLeft)).toBe(horizontalOffset)
        await expect(page.locator('.popup-card')).toHaveCount(0)

        await card.evaluate(e => e.scrollIntoView({ block: 'center' }))
        box = (await card.boundingBox())!
        const centerX = box.x + box.width / 2, centerY = box.y + box.height / 2
        const scale = await page.evaluate(() => visualViewport!.scale)
        // Headless Chromium supports page zoom through its touchpad pinch path.
        // Assert actual viewport scaling rather than forcing an emulated scale.
        await cdp.send('Input.synthesizePinchGesture', { x: centerX, y: centerY, scaleFactor: 1.5, gestureSourceType: 'mouse' })
        await expect.poll(() => page.evaluate(() => visualViewport!.scale)).toBeGreaterThan(scale + .1)
        await expect(page.locator('.popup-card')).toHaveCount(0)
        await cdp.send('Input.synthesizePinchGesture', { x: centerX, y: centerY, scaleFactor: 1 / 1.5, gestureSourceType: 'mouse' })
        await expect.poll(() => page.evaluate(base => Math.abs(visualViewport!.scale - base), scale)).toBeLessThan(.01)
        await card.tap()
        await expect(page.locator('.popup-card')).toBeVisible()
        await expect(card).toHaveAttribute('aria-pressed', 'true')
        await page.locator('.popup-card button').first().click()
      }
      await cdp.detach()
    })
  }
})

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
