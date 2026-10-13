import { test, expect, type Page } from '@playwright/test'
import { openHeaderMenu } from './header-navigation'

const times = Array.from({ length: 360 }, (_, i) => new Date(Date.UTC(2026, 9, 13, i)).toISOString().slice(0, 16))
const hourly: Record<string, string[] | number[]> = { time: times }
for (const [field, value] of Object.entries({ temperature_2m: 18, apparent_temperature: 17, weather_code: 2, precipitation: .2, precipitation_probability: 35, wind_speed_10m: 12, surface_pressure: 1015, relative_humidity_2m: 72, visibility: 16000, dew_point_2m: 12, cloud_cover: 40 })) hourly[field] = times.map(() => value)
const days = times.filter((_, i) => i % 24 === 0).map(time => time.slice(0, 10))
const daily: Record<string, string[] | number[]> = { time: days, sunrise: days.map(day => `${day}T07:15`), sunset: days.map(day => `${day}T18:45`) }
for (const [field, value] of Object.entries({ weather_code: 2, temperature_2m_max: 22, temperature_2m_min: 14, precipitation_sum: 1.2, precipitation_probability_max: 35, wind_speed_10m_max: 18, uv_index_max: 3, apparent_temperature_max: 21 })) daily[field] = days.map(() => value)
const weather = { timezone: 'Europe/Sofia', current: { time: times[0], temperature_2m: 18, apparent_temperature: 17, weather_code: 2, relative_humidity_2m: 72, wind_speed_10m: 12, surface_pressure: 1015, uv_index: 3 }, hourly, daily }

async function fixture(page: Page, lang: 'bg' | 'en' = 'bg', account: 'guest' | 'user' | 'admin' = 'guest') {
  const requests: string[] = []
  await page.addInitScript(({ lang, account }) => {
    localStorage.setItem('meteoPulseLanguage', lang)
    if (account !== 'guest') localStorage.setItem('meteo-pulse-auth', JSON.stringify({ access_token: 'navigation-test-token', refresh_token: 'navigation-test-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: '00000000-0000-0000-0000-000000000002', email: 'navigation@example.invalid' } }))
  }, { lang, account })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/')) return route.continue()
    if (url.hostname === 'api.open-meteo.com') return route.fulfill({ json: weather })
    if (url.hostname.includes('marine-api')) return route.fulfill({ json: { current: { sea_surface_temperature: 20 } } })
    if (url.pathname === '/api/admin') {
      requests.push('admin')
      return route.fulfill({ status: account === 'admin' ? 200 : 403, json: account === 'admin' ? { authorized: true } : { error: 'FORBIDDEN' } })
    }
    if (url.pathname === '/api/alerts') {
      requests.push('alerts')
      return route.fulfill({ json: { contractVersion: 2, pro: false, enabled: [], alerts: [] } })
    }
    if (url.pathname === '/api/profile') return route.fulfill({ json: { name: 'Navigation test', email: 'navigation@example.invalid', plan: 'free', permissions: [] } })
    if (url.pathname === '/api/activity') return route.fulfill({ json: { enabled: false, offer: false } })
    return route.fulfill({ json: {} })
  })
  await page.goto('/')
  await expect(page.locator('.main-card .big-temp')).toBeVisible()
  return requests
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const boxes = await page.locator('.header-row, .brand-home, .search-wrapper, .info-line, .city-row, .header-menu.is-open, .notification-panel').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, width: rect.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, cities: element.classList.contains('city-row') }
  }))
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1)
    if (!box.cities) expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1)
  }
}

for (const width of [320, 360, 390, 430, 640, 641, 650, 768, 1440]) for (const lang of ['bg', 'en'] as const) for (const dark of [false, true]) {
  test(`navigation layout ${width} ${lang} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await fixture(page, lang)
    const toggle = page.locator('.mobile-menu-toggle')
    if (dark) {
      await openHeaderMenu(page)
      await page.locator('.header-menu > .icon-btn').click()
      if (width <= 640) await toggle.click()
    }
    await expect(page.locator('.weather-app')).toHaveClass(dark ? /dark/ : /^weather-app$/)
    await noOverflow(page)
    await expect(page.locator('.auth-nav')).toHaveCount(1)
    await expect(page.locator('.weather-notifications')).toHaveCount(1)
    await expect(page.locator('.info-line')).toContainText('Open-Meteo')
    await expect(page.locator('.info-line')).toContainText('15')
    if (width > 640) {
      await expect(toggle).toBeHidden()
      await expect(page.locator('.header-title-wrapper .subtitle')).toBeVisible()
      await expect(page.locator('.auth-nav > button')).toHaveCount(2)
      await expect(page.locator('.auth-nav > button').first()).toBeVisible()
      if (width > 650) {
        const order = await page.locator('.auth-nav, .weather-notifications, .header-menu > .lang-btn, .header-menu > .icon-btn').evaluateAll(elements => elements.map(element => ({ x: element.getBoundingClientRect().x, name: element.className })).sort((a, b) => a.x - b.x).map(element => element.name))
        expect(order).toEqual(['auth-nav', 'weather-notifications', 'lang-btn', 'icon-btn'])
      }
      return
    }
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-controls', 'header-menu')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.auth-nav > button').first()).toBeHidden()
    const header = (await page.locator('.header-row').boundingBox())!
    const brand = (await page.locator('.brand-home').boundingBox())!
    const bell = (await page.locator('.weather-notifications > button').boundingBox())!
    const menuButton = (await toggle.boundingBox())!
    expect(header.height).toBeLessThanOrEqual(64)
    expect(brand.x + brand.width).toBeLessThanOrEqual(bell.x)
    expect(bell.x + bell.width).toBeLessThanOrEqual(menuButton.x)
    expect(Math.abs(brand.y - bell.y)).toBeLessThan(2)
    expect((await page.locator('.search-wrapper').boundingBox())!.y - header.y - header.height).toBeLessThanOrEqual(11)
    for (const box of [brand, bell, menuButton]) expect(box.height).toBeGreaterThanOrEqual(44)
    const cities = page.locator('.city-row')
    expect(await cities.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
    expect(new Set(await cities.locator('button').evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().y)))).size).toBe(1)
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.auth-nav > button').first()).toBeFocused()
    await noOverflow(page)
    const targets = await page.locator('.header-menu button:visible').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))
    expect(targets.every(height => height >= 44)).toBe(true)
    if (width === 390 && lang === 'bg') await page.screenshot({ path: `work/navigation-390-${dark ? 'dark' : 'light'}-open.png` })
    await page.keyboard.press('Escape')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toBeFocused()
    await page.keyboard.press('Space')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await page.locator('.mobile-menu-close').click()
    await expect(toggle).toBeFocused()
    const sofia = cities.getByRole('button', { name: lang === 'bg' ? 'София' : 'Sofia', exact: true })
    await sofia.click()
    await expect(sofia).toHaveAttribute('aria-pressed', 'true')
    await expect(sofia).toHaveClass('city-btn active')
    const tokyo = cities.getByRole('button', { name: lang === 'bg' ? 'Токио' : 'Tokyo', exact: true })
    await tokyo.focus()
    await page.keyboard.press('Enter')
    await expect(tokyo).toHaveAttribute('aria-pressed', 'true')
    await noOverflow(page)
  })
}

for (const lang of ['bg', 'en'] as const) {
  test(`menu closes on outside interaction and focus leaving, restores desktop ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await fixture(page, lang)
    const toggle = page.locator('.mobile-menu-toggle')
    await openHeaderMenu(page)
    await page.locator('.header-row').click({ position: { x: 5, y: 30 } })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await openHeaderMenu(page)
    await page.locator('input[type=search]').focus()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('input[type=search]')).toBeFocused()
    await openHeaderMenu(page)
    await page.locator('.header-menu > .icon-btn').focus()
    await page.keyboard.press('Tab')
    await expect(page.locator('.weather-notifications > button')).toBeFocused()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await openHeaderMenu(page)
    await page.locator('.header-menu > .lang-btn').click()
    await expect(toggle).toHaveAccessibleName(lang === 'bg' ? 'Close menu' : 'Затвори менюто')
    await expect(page.locator('.city-row .active')).toHaveText(lang === 'bg' ? 'Varna' : 'Варна')
    await page.locator('.header-menu > .icon-btn').click()
    await expect(page.locator('.weather-app')).toHaveClass(/dark/)
    await toggle.focus()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(toggle).toBeHidden()
    await expect(page.locator('.auth-nav > button').first()).toBeFocused()
    await expect(page.locator('.header-menu')).not.toHaveClass(/is-open/)
    await page.setViewportSize({ width: 320, height: 700 })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.header-menu > .lang-btn')).toBeHidden()
    await openHeaderMenu(page)
    await page.locator('.header-menu > .icon-btn').click()
    await expect(page.locator('.weather-app')).not.toHaveClass(/dark/)
    await noOverflow(page)
  })
}

for (const lang of ['bg', 'en'] as const) for (const account of ['guest', 'user', 'admin'] as const) {
  test(`existing auth, notifications and permissions ${lang} ${account}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    const requests = await fixture(page, lang, account)
    const toggle = page.locator('.mobile-menu-toggle')
    const auth = page.locator('.auth-nav')
    await openHeaderMenu(page)
    await expect(auth.getByRole('button', { name: lang === 'bg' ? (account === 'guest' ? 'Вход' : 'Моят профил') : (account === 'guest' ? 'Sign in' : 'My profile'), exact: true })).toBeVisible()
    const adminLink = page.locator('.header-menu > a')
    if (account === 'admin') await expect(adminLink).toHaveAttribute('href', '/admin')
    else await expect(adminLink).toHaveCount(0)
    const adminReads = requests.filter(request => request === 'admin').length
    for (let index = 0; index < 3; index++) { await toggle.click(); await toggle.click() }
    expect(requests.filter(request => request === 'admin').length).toBe(adminReads)
    await expect(auth).toHaveCount(1)
    await expect(page.locator('.weather-notifications')).toHaveCount(1)
    const profile = auth.getByRole('button').first()
    await profile.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog')).toBeFocused()
    await expect(page.locator('.auth-close')).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(profile).toBeFocused()
    if (account === 'guest') {
      await auth.getByRole('button', { name: lang === 'bg' ? 'Регистрация' : 'Register', exact: true }).click()
      await expect(page.getByRole('dialog').locator('h2')).toHaveText(lang === 'bg' ? 'Регистрация' : 'Register')
      await page.keyboard.press('Escape')
    }
    await page.keyboard.press('Escape')
    await expect(toggle).toBeFocused()
    const bell = page.getByRole('button', { name: lang === 'bg' ? 'Известия' : 'Notifications', exact: true })
    await bell.click()
    await expect(page.locator('.notification-panel')).toBeVisible()
    await noOverflow(page)
    await page.keyboard.press('Escape')
    await expect(page.locator('.notification-panel')).toHaveCount(0)
    await expect(bell).toBeFocused()
    await bell.click()
    await page.locator('.notification-close').click()
    await expect(bell).toBeFocused()
    if (account !== 'guest') {
      await openHeaderMenu(page)
      await auth.getByRole('button', { name: lang === 'bg' ? 'Изход' : 'Sign out', exact: true }).click()
      await expect(auth.getByRole('button', { name: lang === 'bg' ? 'Вход' : 'Sign in', exact: true })).toBeVisible()
      await expect(adminLink).toHaveCount(0)
      await expect(page.locator('.weather-notifications')).toHaveCount(1)
    }
  })
}

for (const lang of ['bg', 'en'] as const) {
  test(`search suggestions, keyboard selection, empty and failed states ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await fixture(page, lang)
    let mode: 'results' | 'empty' | 'error' = 'results'
    await page.route('**/geocoding-api.open-meteo.com/**', route => mode === 'error' ? route.fulfill({ status: 503 }) : route.fulfill({ json: { results: mode === 'empty' ? [] : [
      { id: 1, name: 'Test City', latitude: 48, longitude: 3, admin1: 'A very long region for a narrow viewport', country: 'Test country' },
      { id: 2, name: 'Second City', latitude: 49, longitude: 4, country: 'Test country' },
    ] } }))
    const search = page.locator('input[type=search]')
    await search.fill('Test')
    await expect(page.locator('.suggestion-item')).toHaveCount(2)
    await noOverflow(page)
    await search.press('Tab')
    await expect(page.locator('.suggestion-item').first()).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.locator('.suggestion-item').nth(1)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('.main-card h2')).toContainText('Second City')
    await expect(page.locator('.suggestion-item')).toHaveCount(0)
    await search.fill('Test')
    await expect(page.locator('.suggestion-item')).toHaveCount(2)
    await search.press('Enter')
    await expect(page.locator('.main-card h2')).toContainText('Test City')
    await search.fill('Again')
    await expect(page.locator('.suggestion-item')).toHaveCount(2)
    await search.press('Escape')
    await expect(page.locator('.suggestion-item')).toHaveCount(0)
    mode = 'empty'
    await search.fill('Empty')
    await expect(page.locator('.search-feedback')).toHaveText(lang === 'bg' ? 'Няма намерено място. Опитай друго изписване.' : 'No places found. Try another spelling.')
    mode = 'error'
    await search.fill('Failed')
    await expect(page.locator('.search-feedback')).toHaveText(lang === 'bg' ? 'Търсенето не се зареди. Опитай пак.' : 'Search failed. Try again.')
    await noOverflow(page)
  })
}

for (const lang of ['bg', 'en'] as const) {
  test(`resizing an existing auth dialog preserves its focus and return target ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await fixture(page, lang)
    const login = page.locator('.auth-nav > button').first()
    await login.click()
    const email = page.getByRole('dialog').locator('input[type=email]')
    await email.fill('navigation@example.invalid')
    await page.setViewportSize({ width: 320, height: 700 })
    await expect(email).toBeFocused()
    await expect(email).toHaveValue('navigation@example.invalid')
    await expect(page.locator('.mobile-menu-toggle')).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(login).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('.mobile-menu-toggle')).toBeFocused()
  })
}
