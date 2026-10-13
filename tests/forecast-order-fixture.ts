import { expect, type Page } from '@playwright/test'

const times = Array.from({ length: 360 }, (_, i) => new Date(Date.UTC(2026, 9, 13, i)).toISOString().slice(0, 16))
const hourly: Record<string, string[] | number[]> = { time: times }
for (const [field, value] of Object.entries({ temperature_2m: 18, apparent_temperature: 17, weather_code: 2, precipitation: .2, precipitation_probability: 35, wind_speed_10m: 12, surface_pressure: 1015, relative_humidity_2m: 72, visibility: 16000, dew_point_2m: 12, cloud_cover: 40 })) hourly[field] = times.map(() => value)
const days = times.filter((_, i) => i % 24 === 0).map(time => time.slice(0, 10))
const daily: Record<string, string[] | number[]> = { time: days, sunrise: days.map(day => `${day}T07:15`), sunset: days.map(day => `${day}T18:45`) }
for (const [field, value] of Object.entries({ weather_code: 2, temperature_2m_max: 22, temperature_2m_min: 14, precipitation_sum: 1.2, precipitation_probability_max: 35, wind_speed_10m_max: 18, uv_index_max: 3, apparent_temperature_max: 21 })) daily[field] = days.map(() => value)
export const weather = { timezone: 'Europe/Sofia', current: { time: times[0], temperature_2m: 18, apparent_temperature: 17, weather_code: 2, relative_humidity_2m: 72, wind_speed_10m: 12, surface_pressure: 1015, uv_index: 3 }, hourly, daily }

export async function fixture(page: Page, lang: 'bg' | 'en' = 'bg', account: 'guest' | 'user' | 'admin' = 'guest', url = '/') {
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
  await page.goto(url)
  await expect(page.locator('.main-card .big-temp')).toBeVisible({ timeout: 15000 })
  return requests
}

