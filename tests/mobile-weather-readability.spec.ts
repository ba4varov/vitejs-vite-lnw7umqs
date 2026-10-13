import { test, expect, type Page } from '@playwright/test'
import { weather } from './forecast-order-fixture'
import { clickHeaderControl } from './header-navigation'

const longCity = 'Свети Константин и Елена – LongSettlementNameWithoutSpacesForWrapping'
const advice = '  Оригинален AI съвет / Original AI advice. '.repeat(14) + '\nПоследен ред / Final line.  '

async function setup(page: Page, lang: 'bg' | 'en', bright = true, severe = false, initialAdvice = advice) {
  let requests = 0
  let text = initialAdvice
  let pending = false
  const releases: (() => void)[] = []
  await page.addInitScript(lang => {
    // Sandboxed advertising frames have opaque origins and no localStorage.
    if (window === window.top) localStorage.setItem('meteoPulseLanguage', lang)
  }, lang)
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/weather-advice') {
      requests++
      const original = text
      if (pending) await new Promise<void>(resolve => releases.push(resolve))
      return route.fulfill({ json: { advice: original } })
    }
    if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/')) return route.continue()
    if (url.hostname === 'api.open-meteo.com') return route.fulfill({ json: { ...weather, current: { ...weather.current, cloud_cover: 40, ...(severe ? { temperature_2m: 36, wind_speed_10m: 70, uv_index: 9, weather_code: 95 } : {}) } } })
    if (url.hostname.includes('marine-api')) return route.fulfill({ json: { current: { sea_surface_temperature: 20 } } })
    if (url.hostname.includes('geocoding-api')) return route.fulfill({ json: { results: [{ id: 1, name: longCity, latitude: 43, longitude: 27, country: 'Bulgaria' }] } })
    if (url.hostname === 'picsum.photos') return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="${bright ? '#fff' : '#101820'}"/><circle cx="1000" cy="220" r="180" fill="${bright ? '#ffe59a' : '#295775'}"/></svg>` })
    return route.fulfill({ json: {} })
  })
  await page.goto('/')
  await expect(page.locator('.weather-advice-text')).toHaveText(initialAdvice, { timeout: 15000 })
  return { count: () => requests, next: (value: string, wait = false) => { text = value; pending = wait }, release: () => releases.splice(0).forEach(resolve => resolve()) }
}

for (const width of [320,360,390,430,640,641,768,1440]) for (const lang of ['bg','en'] as const) for (const dark of [false,true]) for (const bright of [false,true]) {
  test(`readability ${width} ${lang} ${dark ? 'dark' : 'light'} ${bright ? 'bright' : 'dark'} image`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await setup(page, lang, bright, true)
    if (dark) await clickHeaderControl(page, page.locator('.header-menu > .icon-btn'))
    const search = page.locator('input[type=search]')
    await search.fill('Long city')
    await page.locator('.suggestion-item').click()
    const card = page.locator('.main-card'), text = card.locator('.weather-advice-text'), toggle = card.locator('.advice-toggle')
    await expect(card.locator('h2')).toContainText(longCity)
    await expect(text).toHaveText(advice)
    expect(await text.textContent()).toBe(advice)
    await expect(page.locator('.alert-item')).toHaveCount(4)
    await expect(card.locator('.big-temp')).toHaveText('36°C')
    await expect(card.locator('.desc')).not.toBeEmpty()
    expect(await card.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    if (width > 640) {
      await expect(toggle).toBeHidden()
      expect(await text.evaluate(element => getComputedStyle(element).display)).toBe('inline')
      await expect(card.locator('.stat-box:visible')).toHaveCount(14)
      return
    }
    await expect(toggle).toHaveText(lang === 'bg' ? 'Прочети целия съвет' : 'Read full advice')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toHaveAttribute('aria-controls', 'current-weather-advice')
    expect(await text.evaluate(element => element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight))).toBeLessThanOrEqual(2.01)
    expect(await text.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await expect(card.locator('.stat-box:visible')).toHaveCount(4)
    await expect(card.locator('.mobile-weather-summary')).toContainText('17°C')
    await expect(card.locator('.mobile-weather-summary')).toContainText('14° / 22°')
    const icon = await card.locator('.big-icon').boundingBox(), heading = await card.locator('h2').boundingBox()
    expect(icon!.x).toBeGreaterThanOrEqual(heading!.x + heading!.width)
    const name = await card.locator('h2 > span').first().boundingBox(), star = await card.locator('.star-btn').boundingBox()
    expect(star!.x).toBeGreaterThanOrEqual(name!.x + name!.width)
    expect(star!.width).toBeGreaterThanOrEqual(44)
    expect(star!.height).toBeGreaterThanOrEqual(44)
    expect(await toggle.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    const before = api.count()
    await toggle.focus(); await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await text.textContent()).toBe(advice)
    expect(await text.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true)
    await expect(toggle).toBeFocused()
    await expect(page.locator('.alert-item')).toHaveCount(4)
    await page.keyboard.press('Space')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(api.count()).toBe(before)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await card.screenshot({ path: info.outputPath('collapsed.png'), animations: 'disabled' })
    await toggle.click()
    await card.screenshot({ path: info.outputPath('expanded.png'), animations: 'disabled' })
  })
}

for (const lang of ['bg','en'] as const) {
  test(`advice absence and stale responses ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    const api = await setup(page, lang)
    const toggle = page.locator('.advice-toggle')
    await toggle.click()
    api.next('Obsolete delayed advice', true)
    await page.locator('.city-btn').nth(1).click()
    await expect(page.locator('.main-card .big-temp')).toBeVisible()
    await expect.poll(api.count).toBe(2)
    await expect(page.locator('.weather-advice')).toHaveCount(0)
    await expect(toggle).toHaveCount(0)
    // A later forecast supersedes the still-pending advice request.
    api.next('New original advice\n' + advice)
    await page.locator('.city-btn').nth(2).click()
    await expect(page.locator('.weather-advice-text')).toHaveText('New original advice\n' + advice)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const oldResponse = page.waitForResponse(async response => response.url().endsWith('/api/weather-advice') && (await response.json()).advice === 'Obsolete delayed advice')
    api.release()
    await oldResponse
    await expect(page.locator('.weather-advice-text')).toHaveText('New original advice\n' + advice)
    await toggle.click()
    // A new forecast must also reset expansion when advice text is identical.
    api.next('New original advice\n' + advice)
    await page.locator('.city-btn').first().click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(await page.locator('.weather-advice-text').textContent()).toBe('New original advice\n' + advice)
    // Existing generation treats whitespace as truthy; presentation hides it.
    api.next('   ')
    const blankResponse = page.waitForResponse(async response => response.url().endsWith('/api/weather-advice') && (await response.json()).advice === '   ')
    await page.locator('.city-btn').nth(3).click()
    await blankResponse
    await expect(page.locator('.main-card .big-temp')).toBeVisible()
    await expect(page.locator('.weather-advice')).toHaveCount(0)
  })
}

for (const dark of [false,true]) test(`mobile contrast over the brightest possible image ${dark}`, async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 })
  await setup(page, 'en', true)
  if (dark) await clickHeaderControl(page, page.locator('.header-menu > .icon-btn'))
  const gradient = await page.locator('.main-card > div:last-child').evaluate(element => getComputedStyle(element).backgroundImage)
  const stops = [...gradient.matchAll(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/g)].map(match => match.slice(1).map(Number))
  expect(stops.length).toBe(3)
  for (const [r,g,b,alpha] of stops) {
    // White is the worst-case image pixel; the existing temperature overlay
    // and metric/advice panels can only darken this bound further.
    const linear = [r,g,b].map(value => (value * alpha + 255 * (1-alpha)) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722
    expect(1.05 / (luminance + .05)).toBeGreaterThanOrEqual(4.5)
    expect(alpha).toBeLessThanOrEqual(.66)
  }
  for (const selector of ['h2', '.big-temp', '.desc', '.mobile-weather-summary', '.weather-advice-text', '.stat-box .label', '.stat-box .value']) {
    const colors = await page.locator('.main-card').locator(selector).evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height > 0).map(element => ({ color: getComputedStyle(element).color, opacity: getComputedStyle(element).opacity })))
    for (const value of colors) expect(value).toEqual({ color: 'rgb(255, 255, 255)', opacity: '1' })
  }
})


for (const width of [320,360,390,430,640]) for (const lang of ['bg','en'] as const) for (const dark of [false,true]) {
  test(`advice actual line overflow ${width} ${lang} ${dark}`, async ({ page }) => {
    const layoutErrors: string[] = []
    page.on('pageerror', error => layoutErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error' && /ResizeObserver|flushSync/.test(message.text())) layoutErrors.push(message.text()) })
    await page.setViewportSize({ width, height: 900 })
    const one = lang === 'bg' ? 'Вземи чадър.' : 'Bring an umbrella.'
    const two = lang === 'bg' ? 'Вземи чадър.\nОблечи яке.' : 'Bring an umbrella.\nWear a jacket.'
    const api = await setup(page, lang, true, false, one)
    if (dark) {
      await clickHeaderControl(page, page.locator('.header-menu > .icon-btn'))
      await page.locator('.mobile-menu-toggle').click()
    }
    const text = page.locator('#current-weather-advice'), toggle = page.locator('.advice-toggle')
    const lines = () => text.evaluate(element => element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight))
    await expect(toggle).toHaveCount(0)
    expect(await lines()).toBeCloseTo(1, 1)
    const compact = async () => {
      const gap = await text.evaluate(element => {
        const parent = element.parentElement!, padding = parseFloat(getComputedStyle(parent).paddingBottom)
        return parent.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom - padding
      })
      expect(Math.abs(gap)).toBeLessThan(1)
    }
    await compact()
    api.next(two)
    await page.locator('.city-btn').nth(1).click()
    await expect(text).toHaveText(two)
    await expect(toggle).toHaveCount(0)
    expect(await text.textContent()).toBe(two)
    expect(await lines()).toBeCloseTo(2, 1)
    await compact()
    api.next(advice)
    await page.locator('.city-btn').nth(2).click()
    await expect(text).toHaveText(advice)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(await lines()).toBeCloseTo(2, 1)
    const requests = api.count()
    await toggle.focus(); await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await lines()).toBeGreaterThan(2)
    expect(await text.textContent()).toBe(advice)
    await page.keyboard.press('Space')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(api.count()).toBe(requests)
    expect(layoutErrors).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const lang of ['bg','en'] as const) for (const dark of [false,true]) {
  test(`advice remeasures width language and font ${lang} ${dark}`, async ({ page }) => {
    const layoutErrors: string[] = []
    page.on('pageerror', error => layoutErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error' && /ResizeObserver|flushSync/.test(message.text())) layoutErrors.push(message.text()) })
    await page.setViewportSize({ width: 320, height: 900 })
    const original = lang === 'bg' ? 'Вземи чадър или непромокаемо яке – вероятността за валеж е 98%.' : 'Bring an umbrella or a waterproof jacket – the chance of rain is 98%. Stay warm and keep your shoes dry.'
    const api = await setup(page, lang, true, false, original)
    if (dark) {
      await clickHeaderControl(page, page.locator('.header-menu > .icon-btn'))
      await page.locator('.mobile-menu-toggle').click()
    }
    const text = page.locator('#current-weather-advice'), toggle = page.locator('.advice-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await page.setViewportSize({ width: 640, height: 900 })
    await expect(toggle).toHaveCount(0)
    await expect(text).toHaveText(original)
    expect(await text.evaluate(e => e.scrollHeight <= e.clientHeight)).toBe(true)
    await page.setViewportSize({ width: 320, height: 900 })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const before = api.count()
    await clickHeaderControl(page, page.locator('.lang-btn'))
    await expect(toggle).toHaveText(lang === 'bg' ? 'Read full advice' : 'Прочети целия съвет')
    await page.locator('.mobile-menu-toggle').click()
    expect(await text.textContent()).toBe(original)
    await page.setViewportSize({ width: 641, height: 900 })
    await expect(toggle).toHaveCount(0)
    expect(await text.evaluate(e => getComputedStyle(e).display)).toBe('inline')
    await page.setViewportSize({ width: 320, height: 900 })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(api.count()).toBe(before)
    // Changing the rendered font without changing text must trigger remeasurement.
    await page.addStyleTag({ content: '.main-card .weather-advice { font-size: 8px !important; }' })
    await expect(toggle).toHaveCount(0)
    await page.addStyleTag({ content: '.main-card .weather-advice { font-size: 24px !important; }' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    api.next(lang === 'bg' ? 'Да.' : 'Yes.')
    await page.locator('.city-btn').nth(1).click()
    await expect(text).toHaveText(lang === 'bg' ? 'Да.' : 'Yes.')
    await expect(toggle).toHaveCount(0)
    expect(layoutErrors).toEqual([])
  })
}
