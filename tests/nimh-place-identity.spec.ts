import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { parseNimh } from '../server/nimh-warnings.js'
import { weather } from './forecast-order-fixture'
const geo = { id: 726050, name: 'Варна', latitude: 43.21912, longitude: 27.91024, country_code: 'BG', admin1_id: 726051, admin1: 'Област Варна', admin2: 'Варна', country: 'България' }
const official = parseNimh(readFileSync('tests/fixtures/nimh/varna-2026-11-13.html', 'utf8'), 'VAR', '2026-11-13')

for (const quick of [true, false]) for (const repeat of [false, true]) test(`legacy confirmed Varna restores identity (${quick ? 'quick' : 'geocoded'} coordinates, repeat:${repeat})`, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-13T12:00:00Z') })
  await page.addInitScript(({ quick, repeat }) => {
    localStorage.setItem('meteoPulseLanguage', 'bg')
    if (!localStorage.getItem('meteoPulseConfirmedLocationV1')) localStorage.setItem('meteoPulseConfirmedLocationV1', JSON.stringify({ name: 'Варна', lat: quick ? 43.2141 : 43.21912, lon: quick ? 27.9147 : 27.91024, source: 'manual' }))
    if (repeat) localStorage.setItem('meteoPulsePlacesV1', JSON.stringify([{ name: 'Варна', lat: quick ? 43.2141 : 43.21912, lon: quick ? 27.9147 : 27.91024 }]))
  }, { quick, repeat })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  if (!repeat) release()
  let lookups = 0
  let recover = !repeat
  const queries: string[] = []
  await page.route('**/*', async route => {
    const u = new URL(route.request().url())
    if (u.pathname === '/api/alerts' && u.searchParams.get('source') === 'nimh') {
      queries.push(u.search)
      return route.fulfill({ json: { municipality: 'Варна', region: 'Област Варна', days: [{ date: '2026-11-13', status: 'verified', checkedAt: Date.parse('2026-11-13T12:00:00Z'), warnings: [...official.municipalities.Варна, ...official.warnings] }] } })
    }
    if (u.hostname === 'geocoding-api.open-meteo.com') {
      lookups++
      if (!recover) return route.fulfill({ json: { results: [] } })
      await gate
      return route.fulfill({ json: u.pathname.endsWith('/search') ? { results: [geo] } : geo })
    }
    if (u.hostname === 'api.open-meteo.com') return route.fulfill({ json: weather })
    if (u.hostname === '127.0.0.1' && !u.pathname.startsWith('/api/')) return route.continue()
    return route.fulfill({ json: {} })
  })
  await page.goto('/')
  const section = page.locator('.official-warnings')
  if (repeat) {
    await expect(section).toHaveCount(0)
    await expect(page.locator('.place-select')).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.locator('.city-row').getByRole('button', { name: 'Варна', exact: true }).click()
    await expect(section.locator('article')).toHaveCount(2)
    const previousLookups = lookups
    recover = true
    await page.locator('.place-select').click()
    await expect.poll(() => lookups).toBeGreaterThan(previousLookups)
    await page.locator('.place-select').click()
    release()
  }
  await expect(section.locator('article')).toHaveCount(2)
  expect(queries.every(q => q.includes('id=726050'))).toBe(true)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('meteoPulseConfirmedLocationV1')!).geonameId)).toBe(726050)
  await page.reload()
  await expect(section.locator('article')).toHaveCount(2)
  await page.locator('.city-row').getByRole('button', { name: 'Варна', exact: true }).click()
  await expect(section.locator('article')).toHaveCount(2)
  await page.locator('input[type=search]').fill('Варна')
  await page.locator('.suggestion-item').first().click()
  await expect(section.locator('article')).toHaveCount(2)
  await expect(section.locator('.official-warning-yellow')).toContainText('Община: Варна')
  await expect(section.locator('.official-warning-orange')).toContainText('Област: Варна')
})

for (const administrative of [true, false]) test(`restored GPS requires administrative evidence: ${administrative}`, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-13T12:00:00Z') })
  await page.addInitScript(() => {
    localStorage.setItem('meteoPulseLanguage', 'bg')
    localStorage.setItem('meteoPulseConfirmedLocationV1', JSON.stringify({ name: 'Варна', lat: 43.2141, lon: 27.9147, source: 'geolocation', accuracy: 25 }))
    Object.defineProperty(navigator, 'permissions', { value: { query: async () => ({ state: 'denied' }) } })
  })
  const queries: string[] = []
  let identityLookups = 0
  await page.route('**/*', async route => {
    const u = new URL(route.request().url())
    if (u.pathname === '/api/alerts' && u.searchParams.get('source') === 'nimh') {
      queries.push(u.search)
      return route.fulfill({ json: { days: [{ date: '2026-11-13', status: 'verified', checkedAt: Date.parse('2026-11-13T12:00:00Z'), warnings: [...official.municipalities.Варна, ...official.warnings] }] } })
    }
    if (u.hostname === 'geocoding-api.open-meteo.com') { identityLookups++; return route.fulfill({ json: { results: [geo] } }) }
    if (u.hostname === 'nominatim.openstreetmap.org') return route.fulfill({ json: { address: administrative ? { country_code: 'bg', state: 'Варна', 'ISO3166-2-lvl4': 'BG-03', municipality: 'Община Варна', city: 'Варна' } : { city: 'Варна' } } })
    if (u.hostname === 'api.open-meteo.com') return route.fulfill({ json: weather })
    if (u.hostname === '127.0.0.1' && !u.pathname.startsWith('/api/')) return route.continue()
    return route.fulfill({ json: {} })
  })
  await page.goto('/')
  const section = page.locator('.official-warnings')
  if (administrative) {
    await expect(section.locator('article')).toHaveCount(2)
    expect(queries[0]).toContain('region=VAR')
    expect(queries[0]).toContain('municipality=')
  } else {
    await expect(section).toHaveCount(0)
    await expect(section.locator('article')).toHaveCount(0)
    expect(queries).toEqual([])
  }
  expect(identityLookups).toBe(0)
})
