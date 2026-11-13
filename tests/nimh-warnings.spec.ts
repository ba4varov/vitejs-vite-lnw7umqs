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
  await expect(section.locator('article')).toHaveCount(2)
  await expect(section).toContainText(lang==='bg'?'Жълт код':'Yellow warning')
  await expect(section).toContainText(lang==='bg'?'Община: Варна':'Municipality: Варна')
  await expect(section).toContainText(lang==='bg'?'Област: Варна':'District: Варна')
  await expect(section).toContainText('Фьон с пориви до 32 m/s.')
  await expect(section).toContainText('2026')
  await expect(section.locator('.marine-context')).not.toHaveAttribute('open')
  await expect(page.locator('.alerts-container')).toContainText('80 km/h')
  if(dark){await clickHeaderControl(page,page.locator('.header-menu > .icon-btn'));const toggle=page.locator('.mobile-menu-toggle');if(await toggle.isVisible())await toggle.click()}
  expect(await section.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
  expect((await section.boundingBox())!.y).toBeLessThan((await page.locator('.main-card').boundingBox())!.y)
  await section.screenshot({path:`work/nimh-${width}-${lang}-${dark}.png`})
  expect(requests).toBe(1)
  unavailable=true
  await page.clock.fastForward(15*60*1000)
  await expect.poll(()=>requests).toBe(2)
  await expect(section.locator('article')).toHaveCount(2)
  await expect(section).toContainText(lang==='bg'?'може да са остарели':'may be outdated')
  // A stale warning is bounded: an outage must not leave an undated alert forever.
  await page.clock.fastForward(46*60*1000)
  await expect(section).toHaveCount(0)
  await page.getByRole('button',{name:lang==='bg'?'София':'Sofia',exact:true}).click()
  await expect(section.locator('article')).toHaveCount(0)
 })
}

for(const municipality of [true,false])test(`GPS ${municipality?'municipality':'district only'} survives unavailable forecast and location change`,async({page})=>{
 await page.clock.install({time:new Date('2026-11-13T12:00:00Z')})
 await page.addInitScript(()=>{
  localStorage.setItem('meteoPulseLanguage','bg')
  localStorage.setItem('meteoPulseConfirmedLocationV1',JSON.stringify({name:'Varna',lat:43.21912,lon:27.91024,source:'manual',geonameId:726050,countryCode:'BG'}))
  navigator.geolocation.getCurrentPosition=success=>{(window as any).gpsSuccess=success}
 })
 const queries:string[]=[]
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url())
  if(u.pathname==='/api/alerts'&&u.searchParams.get('source')==='nimh') {
   queries.push(u.search)
   if(u.searchParams.has('id'))return route.fulfill({json:{status:'unavailable'}})
   const municipal=u.searchParams.has('municipality')
   return route.fulfill({json:{coverage:municipal?'municipality':'district',region:'Варна',municipality:municipal?'Варна':null,days:[{date:'2026-11-13',checkedAt:Date.parse('2026-11-13T12:00:00Z'),status:'verified',warnings:[...(municipal?official.municipalities.Варна:[]),...official.warnings.filter(w=>municipal||w.scope==='district')]}]}})
  }
  if(u.hostname==='nominatim.openstreetmap.org')return route.fulfill({json:{address:{country_code:'bg',country:'България',state:'Варна',city:'Провадия','ISO3166-2-lvl4':'BG-03',...(municipality?{municipality:'Община Варна'}:{})}}})
  if(u.hostname==='api.open-meteo.com')return route.fulfill({status:503,json:{error:true}})
  if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/'))return route.continue()
  return route.fulfill({json:{}})
 })
 await page.goto('/')
 await expect(page.locator('.official-warnings')).toBeVisible()
 await page.locator('.location-btn').click()
 await page.evaluate(()=>(window as any).gpsSuccess({coords:{latitude:43.18,longitude:27.45,accuracy:25}}))
 const section=page.locator('.official-warnings')
 await expect(section.locator('article')).toHaveCount(municipality?2:1)
 await expect(page.locator('.main-card')).toHaveCount(0)
 await expect(section).toContainText('Област: Варна')
 if(!municipality){await expect(section).toContainText('Потвърдена е само областта');await expect(section).not.toContainText('Жълт код')}
 expect(queries.some(q=>q.includes('region=VAR'))).toBe(true)
 if(municipality){await expect(section.locator('.marine-context')).not.toHaveAttribute('open');await expect(section.locator('.marine-context summary')).toContainText('не за населеното място')}
 else await expect(section.locator('.marine-context')).toHaveCount(0)
 await page.getByRole('button',{name:'София',exact:true}).click()
 await expect(section.locator('article')).toHaveCount(0)
 await expect(section).not.toContainText('Област: Варна')
})

test('inland settlement warnings load without forecast; marine context never becomes a local danger card',async({page})=>{
 await page.clock.install({time:new Date('2026-11-13T12:00:00Z')})
 await page.addInitScript(()=>{
  localStorage.setItem('meteoPulseLanguage','en')
  localStorage.setItem('meteoPulseConfirmedLocationV1',JSON.stringify({name:'Provadia',lat:43.18,lon:27.44,source:'manual',geonameId:12345,countryCode:'BG'}))
 })
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url())
  if(u.pathname==='/api/alerts'&&u.searchParams.get('source')==='nimh')return route.fulfill({json:{coverage:'municipality',municipality:'Провадия',region:'Варна',days:[{date:'2026-11-13',status:'verified',checkedAt:Date.parse('2026-11-13T12:00:00Z'),warnings:[...official.municipalities.Провадия,...official.warnings]}]}})
  if(u.hostname==='api.open-meteo.com')return route.fulfill({status:503,json:{error:true}})
  if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/'))return route.continue()
  return route.fulfill({json:{}})
 })
 await page.goto('/')
 const section=page.locator('.official-warnings')
 await expect(section.locator('article')).toHaveCount(2)
 await expect(section).toContainText('Municipality: Провадия')
 await expect(section.locator('article').filter({hasText:'Вълнение'})).toHaveCount(0)
 await expect(section.locator('.marine-context')).not.toHaveAttribute('open')
 await expect(section.locator('summary')).toContainText('not for the settlement')
 await expect(page.locator('.main-card')).toHaveCount(0)
 await expect(page.locator('.alerts-container')).toHaveCount(0)
})

test('NIMH appears only for active BG warnings; city changes and London never require reload',async({page})=>{
 await page.clock.install({time:new Date('2026-11-13T12:00:00Z')})
 await page.addInitScript(()=>{
  localStorage.setItem('meteoPulseLanguage','bg')
  localStorage.setItem('meteoPulseConfirmedLocationV1',JSON.stringify({name:'Варна',lat:43.2141,lon:27.9147,source:'manual',geonameId:726050,countryCode:'BG'}))
 })
 const queries:string[]=[]
 const checkedAt=Date.parse('2026-11-13T12:00:00Z')
 const london={id:2643743,name:'London',latitude:51.5085,longitude:-0.1257,country_code:'GB',country:'United Kingdom',admin1:'England'}
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url())
  if(u.pathname==='/api/alerts'&&u.searchParams.get('source')==='nimh'){
   const id=u.searchParams.get('id') || ''
   queries.push(id)
   return route.fulfill({json:{status:'resolved',days:[{date:'2026-11-13',status:'verified',checkedAt,warnings:id==='726050'?[...official.municipalities.Варна,...official.warnings]:[]},{date:'2026-11-14',status:'verified',checkedAt,warnings:[]}]}})
  }
  if(u.hostname==='geocoding-api.open-meteo.com'){
   if(u.pathname.endsWith('/search'))return route.fulfill({json:{results:u.searchParams.get('name')?.toLowerCase()==='london'?[london]:[]}})
   const id=u.searchParams.get('id')
   return route.fulfill({json:id==='726050'?{id:726050,name:'Варна',latitude:43.2141,longitude:27.9147,country_code:'BG',country:'България',admin1:'Варна'}:id==='2643743'?london:{}})
  }
  if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/'))return route.continue()
  return route.fulfill({json:u.hostname==='api.open-meteo.com'?weather:{}})
 })
 await page.goto('/')
 const section=page.locator('.official-warnings')
 await expect(section.locator('article')).toHaveCount(2)
 await page.locator('.city-row').getByRole('button',{name:'София',exact:true}).click()
 await expect(section).toHaveCount(0)
 await page.locator('.city-row').getByRole('button',{name:'Варна',exact:true}).click()
 await expect(section.locator('article')).toHaveCount(2)
 const countBeforeLondon=queries.length
 await page.locator('input[type=search]').fill('London')
 await expect(page.locator('.suggestion-item')).toBeVisible()
 await page.locator('.suggestion-item').first().click()
 await expect(section).toHaveCount(0)
 expect(queries.length).toBe(countBeforeLondon)
 expect(queries).not.toContain('2643743')
 await page.locator('.city-row').getByRole('button',{name:'Варна',exact:true}).click()
 await expect(section.locator('article')).toHaveCount(2)
})


test('NIMH refresh retains verified day on partial source failure, then removes it on confirmed green',async({page})=>{
 await page.clock.install({time:new Date('2026-11-13T12:00:00Z')})
 await page.addInitScript(()=>{
  localStorage.setItem('meteoPulseLanguage','bg')
  localStorage.setItem('meteoPulseConfirmedLocationV1',JSON.stringify({name:'Варна',lat:43.2141,lon:27.9147,source:'manual',geonameId:726050,countryCode:'BG'}))
 })
 let phase:'warning'|'partial-outage'|'green'='warning'
 let requests=0
 const initial=Date.parse('2026-11-13T12:00:00Z')
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url())
  if(u.pathname==='/api/alerts'&&u.searchParams.get('source')==='nimh'){
   requests++
   const days=phase==='partial-outage'
    ?[{date:'2026-11-13',status:'unavailable',warnings:[]},{date:'2026-11-14',status:'verified',checkedAt:initial+15*60*1000,warnings:[]}]
    :[{date:'2026-11-13',status:'verified',checkedAt:phase==='warning'?initial:initial+30*60*1000,warnings:phase==='warning'?[...official.municipalities.Варна,...official.warnings]:[]}]
   return route.fulfill({json:{status:'resolved',coverage:phase==='partial-outage'?'district':'municipality',municipality:phase==='partial-outage'?null:'Варна',region:'Област Варна',days}})
  }
  if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/'))return route.continue()
  return route.fulfill({json:u.hostname==='api.open-meteo.com'?weather:{}})
 })
 await page.goto('/')
 const section=page.locator('.official-warnings')
 await expect(section.locator('article')).toHaveCount(2)
 phase='partial-outage'
 await page.clock.fastForward(15*60*1000)
 await expect.poll(()=>requests).toBe(2)
 await expect(section.locator('article')).toHaveCount(2)
 await expect(section).toContainText('може да са остарели')
 phase='green'
 await page.clock.fastForward(15*60*1000)
 await expect.poll(()=>requests).toBe(3)
 await expect(section).toHaveCount(0)
})
