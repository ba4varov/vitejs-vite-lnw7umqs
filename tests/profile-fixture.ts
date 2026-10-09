import { expect, type Page } from '@playwright/test'
export async function fixture(page: Page, lang: 'bg' | 'en', initialPlan = 'free') {
  let plan = initialPlan, failed = false, hold = false
  const requests: string[] = []
  let release = () => {}
  await page.addInitScript(lang => {
    localStorage.setItem('meteoPulseLanguage', lang)
    localStorage.setItem('meteo-pulse-auth', JSON.stringify({
      access_token: 'profile-test-token', refresh_token: 'profile-test-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '00000000-0000-0000-0000-000000000002', email: 'profile@example.invalid' },
    }))
  }, lang)
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(process.env.PROFILE_PREVIEW_URL || 'http://127.0.0.1:4173').origin
    ? route.fallback() : route.fulfill({ json: {} }))
  await page.route('**/api/push', route => route.fulfill({json:{contractVersion:1,pro:initialPlan==='pro',preferences:{enabled:false,cities:[],categories:[]},devices:[],registrationEnabled:false,publicKey:null,deliveryEnabled:false}}))
  await page.route('**/api/activity', route => route.fulfill({ json: { enabled: false } }))
  await page.route('**/api/alerts**', route => route.fulfill({ json: { contractVersion: 2, pro: false, enabled: [], alerts: [] } }))
  await page.route('**/api/profile', async route => {
    requests.push(route.request().headers().authorization)
    if (hold) await new Promise<void>(resolve => { release = resolve })
    await route.fulfill({ status: failed ? 503 : 200, json: failed ? { error: 'UNAVAILABLE' }
      : { id: '00000000-0000-0000-0000-000000000002', email: 'profile@example.invalid', name: 'Profile test', plan, permissions: [] } })
  })
  const time=Array.from({length:96},(_,i)=>new Date(Date.UTC(2026,9,9,3+i)).toISOString().slice(0,16)),hourly:any={time}
  for(const key of ['temperature_2m','apparent_temperature','weather_code','precipitation','precipitation_probability','wind_speed_10m','surface_pressure','relative_humidity_2m','visibility','dew_point_2m','cloud_cover']) hourly[key]=time.map(()=>key==='weather_code'||key==='precipitation'?0:key==='wind_speed_10m'?5:key==='precipitation_probability'?10:20)
  const daily:any={time:['2026-10-09','2026-10-10','2026-10-11']}
  for(const key of ['temperature_2m_min','temperature_2m_max','weather_code','precipitation_sum','precipitation_probability_max','wind_speed_10m_max','uv_index_max','apparent_temperature_max']) daily[key]=daily.time.map(()=>key==='weather_code'?0:20)
  daily.sunrise=daily.time.map((d:string)=>d+'T07:00');daily.sunset=daily.time.map((d:string)=>d+'T19:00')
  await page.route('https://api.open-meteo.com/**',(r:any)=>r.fulfill({json:{timezone:'Europe/Sofia',current:{time:'2026-10-09T03:00',weather_code:0,temperature_2m:20,relative_humidity_2m:50,wind_speed_10m:5,apparent_temperature:20,surface_pressure:1010,uv_index:2},hourly,daily}}))
  await page.goto(process.env.PROFILE_PREVIEW_URL || '/')
  await expect(page.getByRole('button', { name: lang === 'bg' ? 'Моят профил' : 'My profile', exact: true })).toBeVisible()
  // Let the planner's independent initial entitlement read finish before holding the profile request.
  await expect.poll(() => requests.length).toBeGreaterThan(0)
  await expect(page.locator('.weather-planner')).not.toContainText(lang === 'bg' ? 'Зареждане…' : 'Loading…')
  return { requests, setPlan: (value: string) => { plan = value }, fail: () => { failed = true },
    hold: () => { hold = true }, release: () => { hold = false; release() } }
}
