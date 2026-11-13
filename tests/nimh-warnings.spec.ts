import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { weather } from './forecast-order-fixture'
import { clickHeaderControl } from './header-navigation'
import { parseNimh } from '../server/nimh-warnings.js'
const official=parseNimh(readFileSync('tests/fixtures/nimh/varna-2026-11-13.html','utf8'),'VAR','2026-11-13')
for(const width of [390,1440]) for(const lang of ['bg','en']) for(const dark of [false,true]) {
 test(`NIMH Varna ${width} ${lang} dark:${dark}`,async({page})=>{
  await page.setViewportSize({width,height:1000})
  await page.clock.install({time:new Date('2026-11-13T12:00:00Z')})
  await page.addInitScript(lang=>{
   localStorage.setItem('meteoPulseLanguage',lang)
   localStorage.setItem('meteoPulseConfirmedLocationV1',JSON.stringify({name:'Varna',lat:43.21912,lon:27.91024,source:'manual',geonameId:726050,countryCode:'BG'}))
  },lang)
  let unavailable=false,requests=0
  const forecast=structuredClone(weather)
  forecast.hourly.wind_gusts_10m=Array(360).fill(80)
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url())
   if(u.pathname==='/api/alerts'&&u.searchParams.get('source')==='nimh'){
    requests++
    return route.fulfill({json:unavailable?{status:'unavailable'}:{placeId:726050,municipality:'Варна',region:'Област Варна',days:[{date:'2026-11-13',status:'verified',checkedAt:Date.parse('2026-11-13T12:00:00Z'),warnings:[...official.municipalities.Варна,...official.warnings]},{date:'2026-11-14',status:'verified',checkedAt:Date.parse('2026-11-13T12:00:00Z'),warnings:[]}]}})
   }
   if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/'))return route.continue()
   return route.fulfill({json:u.hostname==='api.open-meteo.com'?forecast:{}})
  })
  await page.goto('/')
  const section=page.locator('.official-warnings')
  await expect(section.locator('article')).toHaveCount(3)
  await expect(section).toContainText(lang==='bg'?'Жълт код':'Yellow warning')
  await expect(section).toContainText(lang==='bg'?'Община: Варна':'Municipality: Варна')
  await expect(section).toContainText(lang==='bg'?'Област: Варна':'District: Варна')
  await expect(section).toContainText('Фьон с пориви до 32 m/s.')
  await expect(section).toContainText('2026')
  await expect(page.locator('.alerts-container')).toContainText('80 km/h')
  if(dark){await clickHeaderControl(page,page.locator('.header-menu > .icon-btn'));const toggle=page.locator('.mobile-menu-toggle');if(await toggle.isVisible())await toggle.click()}
  expect(await section.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
  expect((await section.boundingBox())!.y).toBeLessThan((await page.locator('.main-card').boundingBox())!.y)
  await section.screenshot({path:`work/nimh-${width}-${lang}-${dark}.png`})
  expect(requests).toBe(1)
  unavailable=true
  await page.clock.fastForward(15*60*1000)
  await expect(section.locator('article')).toHaveCount(0)
  await expect(section).toContainText(lang==='bg'?'недостъпни':'unavailable')
  await page.getByRole('button',{name:lang==='bg'?'София':'Sofia',exact:true}).click()
  await expect(section.locator('article')).toHaveCount(0)
 })
}
