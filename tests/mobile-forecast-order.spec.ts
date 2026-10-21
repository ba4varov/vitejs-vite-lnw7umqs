import { test, expect } from '@playwright/test'
import { fixture } from './forecast-order-fixture'
import { openHeaderMenu } from './header-navigation'

const sections = '.forecast-dashboard > .main-card, .forecast-dashboard > .weather-chat, .forecast-dashboard > .hourly-section, .forecast-dashboard > .forecast-section, .forecast-dashboard > .charts-section'
async function order(page: import('@playwright/test').Page, width: number) {
  // matchMedia change notifications arrive asynchronously after viewport resize.
  await expect.poll(() => page.locator(sections).evaluateAll(nodes => nodes.map(n => n.className))).toEqual(width <= 640
    ? ['card main-card weather-forecast-view', 'card hourly-section', 'card forecast-section', 'card weather-chat', 'card charts-section']
    : ['card main-card weather-forecast-view', 'card weather-chat', 'card hourly-section', 'card forecast-section', 'card charts-section'])
  const boxes = await page.locator(sections).evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top))
  for (let i = 1; i < boxes.length; i++) expect(boxes[i]).toBeGreaterThanOrEqual(boxes[i - 1])
}
for (const width of [320,360,390,430,640,641,768,1440]) for (const lang of ['bg','en'] as const) for (const dark of [false,true]) {
  test(`forecast order and interactions ${width} ${lang} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await fixture(page, lang)
    if (dark) {
      await openHeaderMenu(page)
      await page.locator('.header-menu > .icon-btn').click()
      if (width <= 640) await page.locator('.mobile-menu-toggle').click()
    }
    await order(page, width)
    await expect(page.locator('.weather-chat')).toHaveCount(1)
    await expect(page.locator('.hourly-row button')).toHaveCount(24)
    await expect(page.locator('.daily-grid button')).toHaveCount(14)
    await expect(page.locator('.weather-chat')).toHaveAccessibleName(lang === 'bg' ? 'Попитай Nimbo за времето' : 'Ask Nimbo about the weather')
    await expect(page.locator('.chat-message.bot p').first()).toHaveText(lang === 'bg' ? 'Здравей! Аз съм Nimbo. Попитай ме как да се подготвиш за времето.' : "Hi! I'm Nimbo. Ask me how to prepare for the weather.")
    await expect(page.locator('.chat-messages')).toHaveAttribute('aria-live', 'polite')
    for (const [section, row] of [['.hourly-section','.hourly-row'],['.forecast-section','.daily-grid']]) {
      const strip = page.locator(row)
      expect(await strip.evaluate(e => getComputedStyle(e).overflowX)).toMatch(/auto|scroll/)
      await page.locator(section + ' .forecast-scroll-controls button').last().click()
      await expect.poll(() => strip.evaluate(e => e.scrollLeft)).toBeGreaterThan(0)
      await page.locator(section + ' .forecast-scroll-controls button').first().click()
      await expect.poll(() => strip.evaluate(e => e.scrollLeft)).toBeLessThanOrEqual(3)
      await strip.locator('button').first().focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('.popup-card')).toBeVisible()
      await expect(strip.locator('button').first()).toHaveAttribute('aria-pressed', 'true')
      await page.locator('.popup-card button').first().click()
      await expect(page.locator('.popup-card')).toHaveCount(0)
    }
    // Native Tab traversal must cross forecast controls and chat in DOM order.
    const first = width <= 640 ? '.hourly-section' : '.weather-chat'
    const last = width <= 640 ? '.weather-chat' : '.forecast-section'
    await page.locator(first + ' button').first().focus()
    const visited: string[] = []
    for (let i = 0; i < 50; i++) {
      const section = await page.evaluate(() => document.activeElement?.closest('section')?.className || '')
      if (!visited.includes(section)) visited.push(section)
      if (section.includes(last.slice(1))) break
      await page.keyboard.press('Tab')
    }
    expect(visited.filter(n => /hourly-section|forecast-section|weather-chat/.test(n))).toEqual(width <= 640
      ? ['card hourly-section','card forecast-section','card weather-chat']
      : ['card weather-chat','card hourly-section','card forecast-section'])
  })
}
for (const lang of ['bg','en'] as const) test(`chat and DOM identity survive repeated resize ${lang}`, async ({ page }) => {
  await fixture(page, lang)
  let release!: () => void
  let calls = 0
  await page.route('**/api/weather-chat', async route => {
    calls++
    if (calls === 1) await new Promise<void>(resolve => { release = resolve })
    await route.fulfill({ json: { answer: `Response ${calls}` } })
  })
  await page.evaluate(() => {
    const w = window as any
    w.savedSections = [...document.querySelectorAll('.weather-chat, .hourly-section, .forecast-section')]
    w.savedInput = document.querySelector('.chat-form input')
  })
  const input = page.locator('.chat-form input')
  await input.fill('Draft message')
  await input.focus()
  for (const width of [320,641,640,1440,390,768]) {
    await page.setViewportSize({ width, height: 900 })
    await order(page, width)
    await expect(input).toHaveValue('Draft message')
    await expect(input).toBeFocused()
    expect(await page.evaluate(() => (window as any).savedSections.every((n: Element) => n.isConnected) && (window as any).savedInput === document.querySelector('.chat-form input'))).toBe(true)
  }
  await input.press('Enter')
  await expect.poll(() => calls).toBe(1)
  await expect(input).toBeDisabled()
  await page.setViewportSize({ width: 640, height: 900 })
  await expect(page.locator('.chat-message.user')).toHaveText('Draft message')
  release()
  await expect(page.locator('.chat-messages')).toContainText('Response 1')
  await expect(input).toBeEnabled()
  await page.locator('.chat-suggestions button').first().click()
  await expect(page.locator('.chat-messages')).toContainText('Response 2')
  await input.fill('Another draft')
  await page.setViewportSize({ width: 641, height: 900 })
  await expect(input).toHaveValue('Another draft')
  await expect(page.locator('.chat-messages')).toContainText('Response 1')
  await expect(page.locator('.chat-messages')).toContainText('Response 2')
  expect(calls).toBe(2)
})
for (const lang of ['bg','en'] as const) test(`forecast scroll and selection survive resize ${lang}`, async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 })
  await fixture(page, lang)
  for (const row of ['.hourly-row','.daily-grid']) {
    await page.locator(row).evaluate(e => { e.scrollLeft = 180 })
    await expect.poll(() => page.locator(row).evaluate(e => e.scrollLeft)).toBeGreaterThan(100)
    const snappedIndex = () => page.locator(row).evaluate(e => {
      const cards = e.querySelectorAll('button')
      const stride = cards[1].getBoundingClientRect().left - cards[0].getBoundingClientRect().left
      return Math.round(e.scrollLeft / stride)
    })
    const index = await snappedIndex()
    for (const width of [641,390]) {
      await page.setViewportSize({ width, height: 900 })
      // Responsive card widths change pixel offsets; keep the same snapped item.
      await expect.poll(snappedIndex).toBe(index)
    }
    const selected = page.locator(row + ' button').nth(2)
    await selected.click()
    await expect(page.locator('.popup-card')).toBeVisible()
    const details = await page.locator('.popup-card').textContent()
    await page.setViewportSize({ width: 768, height: 900 })
    await expect(selected).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.popup-card')).toHaveText(details)
    await page.locator('.popup-card button').first().click()
    await page.setViewportSize({ width: 640, height: 900 })
  }
})
