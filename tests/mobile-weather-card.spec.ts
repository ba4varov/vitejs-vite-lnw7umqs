// @ts-nocheck
import { test, expect } from '@playwright/test'
const times=Array.from({length:360},(_,i)=>new Date(Date.UTC(2026,9,8,i)).toISOString().slice(0,16));
const fields={temperature_2m:18,weather_code:2,precipitation:0.2,wind_speed_10m:12,surface_pressure:1015,relative_humidity_2m:72,visibility:16000,dew_point_2m:12,cloud_cover:40,apparent_temperature:17,precipitation_probability:35};
const hourly={time:times};for(const [k,v] of Object.entries(fields))hourly[k]=times.map(()=>v);
const daily={time:times.filter((_,i)=>i%24===0).map(t=>t.slice(0,10))};
for(const [k,v] of Object.entries({weather_code:2,temperature_2m_max:22,temperature_2m_min:14,precipitation_sum:1.2,precipitation_probability_max:35,wind_speed_10m_max:18,uv_index_max:3,apparent_temperature_max:21}))daily[k]=daily.time.map(()=>v);
daily.sunrise=daily.time.map(t=>t+'T07:15');daily.sunset=daily.time.map(t=>t+'T18:45');
const data={current:{...fields,time:'2026-10-08T23:15',uv_index:3},hourly,daily};

for (const width of [360,390,430,640,641,1440]) for (const lang of ['bg','en']) for (const dark of [false,true]) {
  test(`current weather ${width} ${lang} ${dark ? 'dark' : 'light'}`, async ({page}) => {
    await page.setViewportSize({width,height:900})
    await page.addInitScript(lang => localStorage.setItem('meteoPulseLanguage',lang),lang)
    await page.route('**/*', route => {
      const url=route.request().url()
      if(new URL(url).hostname==='127.0.0.1') return route.continue()
      if(url.includes('api.open-meteo.com/v1/forecast')) return route.fulfill({json:data})
      if(url.includes('marine-api')) return route.fulfill({json:{current:{sea_surface_temperature:20},hourly:{time:times,sea_surface_temperature:times.map(()=>20)}}})
      return route.fulfill({json:{}})
    })
    await page.goto('/')
    const card=page.locator('.main-card'), toggle=card.locator('.metrics-toggle')
    await expect(card.locator('.big-temp')).toBeVisible()
    if(dark) await page.locator('.header-btns > .icon-btn').click()
    const overflow=async()=> expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await overflow()
    if(width>640) {
      await expect(toggle).toBeHidden()
      await expect(card.locator('.stat-box:visible')).toHaveCount(14)
      await expect(card.locator('.mobile-weather-summary')).toBeHidden()
      return
    }
    if(width===390 && lang==='bg' && !dark) await card.screenshot({path:'work/mobile-weather-card.png'})
    await expect(toggle).toHaveText(lang==='bg'?'Всички показатели':'All metrics')
    await expect(toggle).toHaveAttribute('aria-expanded','false')
    await expect(toggle).toHaveAttribute('aria-controls','current-weather-metrics')
    await expect(card.locator('.stat-box:visible')).toHaveCount(4)
    await expect(card.locator('.mobile-weather-summary')).toContainText('14° / 22°')
    const boxes=await card.locator('.stat-box:visible').evaluateAll(els=>els.map(e=>({className:e.className,x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y})))
    expect(boxes.map(b=>b.className)).toEqual(expect.arrayContaining(['stat-box metric-humidity','stat-box metric-precipProb','stat-box metric-wind','stat-box metric-cloudCover']))
    expect(new Set(boxes.map(b=>Math.round(b.x))).size).toBe(2)
    expect(new Set(boxes.map(b=>Math.round(b.y))).size).toBe(2)
    expect(await toggle.evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    await toggle.focus();await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded','true')
    await expect(card.locator('.stat-box:visible')).toHaveCount(12)
    await expect(card.locator('.sea-temp-box')).toContainText('20°C')
    await overflow()
    await page.keyboard.press('Space')
    await expect(toggle).toHaveAttribute('aria-expanded','false')
    await expect(card.locator('.stat-box:visible')).toHaveCount(4)
    await expect(toggle).toBeFocused()
    await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true')
    await page.locator('.lang-btn').click()
    await expect(toggle).toHaveText(lang==='bg'?'Fewer metrics':'По-малко показатели')
    await toggle.click();await expect(card.locator('.stat-box:visible')).toHaveCount(4)
    await page.setViewportSize({width:1440,height:900})
    await expect(card.locator('.stat-box:visible')).toHaveCount(14)
    await expect(toggle).toBeHidden()
  })
}
