import { test, expect, type Page, type Route } from '@playwright/test'
import { weather as fixtureWeather } from './forecast-order-fixture'
import { openHeaderMenu } from './header-navigation'
import fs from 'node:fs/promises'
import path from 'node:path'
const weather = { ...fixtureWeather, current: { ...fixtureWeather.current, visibility:16000, cloud_cover:40 } }
const marine = {current:{sea_surface_temperature:20},hourly:{time:weather.hourly.time,sea_surface_temperature:weather.hourly.time.map(()=>20)}}
const aqi = {current:{european_aqi:35,pm10:12.5,pm2_5:6.5},hourly:{time:weather.hourly.time,european_aqi:weather.hourly.time.map(()=>35)}}
type Source = 'weather'|'marine'|'aqi'
async function setup(page:Page, lang='en', dark=false) {
 const pending:Record<Source,Route[]>={weather:[],marine:[],aqi:[]}
 await page.clock.install({time:new Date('2026-10-13T08:00:00Z')})
 await page.addInitScript(lang=>{
  localStorage.setItem('meteoPulseLanguage',lang)
  // The unchanged base makes a rehearsal request; the updated app starts once.
  // Tags exist only in this fully mocked fixture.
  const original=window.fetch;let generation=0
  window.fetch=(input,options)=>{
   const url=String(input)
   if(url.startsWith('https://api.open-meteo.com/'))generation++
   if(url.includes('open-meteo.com/'))return original(input,{...options,headers:{...options?.headers,'x-fixture-generation':String(generation)}})
   return original(input,options)
  }
 },lang)
 await page.route('**/*',route=>{
  const url=new URL(route.request().url())
  const source:Source|undefined=url.hostname==='api.open-meteo.com'?'weather':url.hostname==='marine-api.open-meteo.com'?'marine':url.hostname==='air-quality-api.open-meteo.com'?'aqi':undefined
  if(source){const generation=Number(route.request().headers()['x-fixture-generation']);const baseline=new URL(page.url()).port==='4174';if(baseline&&generation===1)return route.abort();pending[source][generation-(baseline?2:1)]=route;return}
  if(url.hostname==='127.0.0.1'&&!url.pathname.startsWith('/api/'))return route.continue()
  if(url.pathname==='/api/weather-advice')return route.fulfill({json:{advice:'Weather advice fixture.'}})
  if(url.pathname==='/api/alerts')return route.fulfill({json:{contractVersion:2,pro:false,enabled:[],alerts:[]}})
  return route.fulfill({json:{}})
 })
 const finish=async(source:Source, data:any=source==='weather'?weather:source==='marine'?marine:aqi, status=200,index=0)=>{
  await expect.poll(()=>pending[source].length).toBeGreaterThan(index)
  await pending[source][index].fulfill({status,json:data}).catch(()=>{})
 }
 const open=async(url='/')=>{
  await page.goto(url);await expect.poll(()=>pending.weather.filter(Boolean).length).toBeGreaterThan(0)
  if(dark){await openHeaderMenu(page);await page.locator('.header-menu > .icon-btn').click();if(await page.locator('.mobile-menu-toggle').isVisible())await page.locator('.mobile-menu-toggle').click()}
  await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'} )
 }
 return {pending,finish,open}
}
const mainVisible=async(page:Page)=>{
 await expect(page.locator('.big-temp')).toHaveText('18°C')
 await expect(page.locator('.hourly-section .forecast-period-card')).toHaveCount(24)
 await expect(page.locator('.forecast-section .forecast-period-card')).toHaveCount(14)
 await expect(page.locator('.charts-section canvas').first()).toBeVisible()
 await expect(page.locator('.projects-section')).toBeAttached()
 await expect(page.locator('.forecast-loading')).toHaveCount(0)
}
test('main renders while BOTH supplemental HTTP requests remain pending; timing evidence',async({page},info)=>{
 const s=await setup(page);await s.open();const started=Date.now()
 await s.finish('weather');await mainVisible(page);const ready=Date.now()
 await expect(page.locator('.aqi-section .value').first()).toContainText('Loading')
 await expect(page.locator('.aqi-section .chart-header p')).toContainText('Loading')
 expect(s.pending.aqi).toHaveLength(1);expect(s.pending.marine).toHaveLength(1)
 await page.screenshot({path:info.outputPath('primary-before-supplements.png'),fullPage:true})
 await s.finish('marine');await s.finish('aqi');const complete=Date.now()
 await expect(page.locator('.aqi-section .value').first()).toHaveText('35')
 await expect(page.locator('.sea-temp-box').first()).toContainText('20°C')
 await fs.writeFile(info.outputPath('timing.json'),JSON.stringify({mainReleasedAt:started,primaryObservedAt:ready,supplementsReleasedAt:complete,primaryBeforeSupplementRelease:ready<complete,bothSupplementRoutesHeldAtPrimary:true},null,2))
 await info.attach('timing',{path:info.outputPath('timing.json'),contentType:'application/json'})
})
test('supplements finish before main, remain available when main renders',async({page})=>{
 const s=await setup(page);await s.open();await s.finish('aqi');await s.finish('marine')
 await expect(page.locator('.forecast-loading')).toBeVisible();await expect(page.locator('.main-card')).toHaveCount(0)
 await s.finish('weather');await mainVisible(page);await expect(page.locator('.aqi-section .value').first()).toHaveText('35')
})
for(const failed of [['marine'],['aqi'],['marine','aqi']] as Source[][])test(`optional failures ${failed}`,async({page})=>{
 const s=await setup(page);await s.open();await s.finish('weather');await mainVisible(page)
 for(const source of ['marine','aqi'] as Source[])await s.finish(source,undefined,failed.includes(source)?503:200)
 await expect(page.locator('.aqi-section .value').first()).toHaveText(failed.includes('aqi')?'No data':'35')
 await expect(page.locator('.aqi-section')).not.toContainText('Loading')
})
test('main fails initially and retry works',async({page})=>{
 const s=await setup(page);await s.open();await s.finish('weather',{},503)
 const retry=page.getByRole('button',{name:'Try Again',exact:true});await expect(retry).toBeVisible();await expect(page.locator('.main-card')).toHaveCount(0)
 await retry.click();await s.finish('weather',weather,200,1);await mainVisible(page)
})
test('switch cities with all older requests pending; no mixed location content',async({page})=>{
 const s=await setup(page);await s.open();await page.locator('.city-row .city-btn').nth(1).click()
 await expect.poll(()=>s.pending.weather.length).toBe(2)
 await s.finish('marine', {current:{sea_surface_temperature:99}},200,0);await s.finish('aqi',{current:{european_aqi:99}},200,0);await s.finish('weather',{...weather,current:{...weather.current,temperature_2m:99}},200,0)
 await s.finish('weather',weather,200,1);await mainVisible(page)
 await expect(page.locator('.aqi-section .value').first()).toContainText('Loading');await expect(page.locator('.main-card')).not.toContainText('99')
 await s.finish('aqi',aqi,200,1);await s.finish('marine',marine,200,1)
 await expect(page.locator('.aqi-section .value').first()).toHaveText('35')
 // A further city change must hide all of this city's data immediately.
 await page.locator('.city-row .city-btn').nth(2).click();await expect(page.locator('.main-card')).toHaveCount(0);await expect(page.locator('.forecast-loading')).toBeVisible()
})
for(const mode of ['pending','failed','main-failed','malformed'])test(`15 minute refresh retains last valid data: ${mode}`,async({page})=>{
 const s=await setup(page);await s.open();await s.finish('weather');await s.finish('marine');await s.finish('aqi');await mainVisible(page)
 await expect(page.locator('.aqi-section .value').first()).toHaveText('35');await page.clock.fastForward(15*60*1000)
 await expect.poll(()=>s.pending.weather.length).toBe(2)
 await s.finish('weather',mode==='malformed'?{current:{}}:weather,mode==='main-failed'?503:200,1)
 if(mode==='failed'){await s.finish('marine',{},503,1);await s.finish('aqi',{},503,1)}
 if(mode==='malformed'){await s.finish('marine',{current:{}},200,1);await s.finish('aqi',{current:{}},200,1)}
 await mainVisible(page);await expect(page.locator('.aqi-section .value').first()).toHaveText('35');await expect(page.locator('.sea-temp-box').first()).toContainText('20°C')
})
test('zero and missing observations, timestamp joins, daily means and live open detail enrichment',async({page})=>{
 const s=await setup(page);await s.open();await s.finish('weather')
 await page.locator('.hourly-section .forecast-period-card').first().click();await page.locator('.chart-tab').last().click();await expect(page.locator('.popup-card')).toContainText('Loading')
 await s.finish('marine',{current:{sea_surface_temperature:0},hourly:{time:[weather.hourly.time[25],weather.hourly.time[24],weather.hourly.time[1]],sea_surface_temperature:[22.4,0,7]}})
 await expect(page.locator('.sea-temp-box').first()).toContainText('0°C');await expect(page.locator('.popup-card')).toContainText('n/a')
 await page.locator('.popup-card button').first().click();await page.locator('.hourly-section .forecast-period-card').nth(1).click();await page.locator('.chart-tab').last().click();await expect(page.locator('.popup-card .sea-temp-box')).toContainText('7°C')
 await page.locator('.popup-card button').first().click();await page.locator('.forecast-section .forecast-period-card').first().click();await page.locator('.chart-tab').last().click();await expect(page.locator('.popup-card .sea-temp-box')).toContainText('11°C');await page.locator('.popup-card button').first().click()
 await s.finish('aqi',{current:{european_aqi:0,pm10:0,pm2_5:null},hourly:{time:[weather.hourly.time[1],weather.hourly.time[0]],european_aqi:[70,0]}})
 await expect(page.locator('.aqi-section .value').nth(0)).toHaveText('0');await expect(page.locator('.aqi-section .value').nth(1)).toHaveText('0 µg/m³');await expect(page.locator('.aqi-section .value').nth(2)).toHaveText('No data')
 const chart=page.locator('.aqi-section canvas');await chart.focus();await expect(page.locator('.aqi-section .chart-tooltip')).toContainText('00:00 — 0 AQI');await chart.press('ArrowRight');await expect(page.locator('.aqi-section .chart-tooltip')).toContainText('01:00 — 70 AQI')
})
for(const width of [320,360,390,430,768,1440])for(const lang of ['bg','en'])for(const dark of [false,true])test(`skeleton and loaded comparison ${width} ${lang} ${dark}`,async({page,context},info)=>{
 test.setTimeout(90000)
 await page.setViewportSize({width,height:900});const s=await setup(page,lang,dark);await s.open()
 await expect(page.locator('.forecast-loading')).toBeVisible();await expect(page.locator('.projects-section')).toHaveCount(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 const geometry=await page.locator('.forecast-loading').boundingBox();expect(geometry!.height).toBeGreaterThan(1000)
 const footer=await page.locator('.footer').boundingBox();expect(footer!.y).toBeGreaterThan(900)
 const contrast=await page.locator('.skeleton-heading h2').evaluate(element=>{
  const luminance=(color:string)=>{const rgb=color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722}
  const text=luminance(getComputedStyle(element).color),background=luminance(getComputedStyle(element.closest('.card')!).backgroundColor)
  return (Math.max(text,background)+.05)/(Math.min(text,background)+.05)
 })
 expect(contrast).toBeGreaterThanOrEqual(4.5)
 await page.screenshot({path:info.outputPath('skeleton.png'),fullPage:true})
 if(process.env.SKELETON_ONLY)return
 await s.finish('weather');await s.finish('marine');await s.finish('aqi');await mainVisible(page)
 await expect(page.locator('.aqi-section .value').first()).toHaveText('35')
 await expect(page.locator('.weather-advice')).toBeVisible()
 const before=await context.newPage();await before.setViewportSize({width,height:900});const b=await setup(before,lang,dark);await b.open('http://127.0.0.1:4174/')
 await b.finish('marine');await b.finish('aqi');await b.finish('weather');await mainVisible(before);await expect(before.locator('.aqi-section .value').first()).toHaveText('35');await expect(before.locator('.weather-advice')).toBeVisible()
 await before.locator('.main-card').scrollIntoViewIfNeeded();await page.locator('.main-card').scrollIntoViewIfNeeded()
 // Compare the same fully populated forecast, excluding unrelated page timers.
 for(const selector of ['.main-card','.hourly-section','.forecast-section','.charts-section','.aqi-section']){
  const name=selector.slice(1);const baseline=await before.locator(selector).screenshot({animations:'disabled'});await fs.writeFile(info.outputPath(`before-${name}.png`),baseline)
  const after=await page.locator(selector).screenshot({animations:'disabled'});await fs.writeFile(info.outputPath(`after-${name}.png`),after)
  const expectedPath=info.snapshotPath(`${width}-${lang}-${dark}-${name}.png`)
  await fs.mkdir(path.dirname(expectedPath),{recursive:true});await fs.writeFile(expectedPath,baseline)
  expect(await page.locator(selector).evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))).toEqual(await before.locator(selector).evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})))
  await expect(page.locator(selector)).toHaveScreenshot(`${width}-${lang}-${dark}-${name}.png`,{animations:'disabled',threshold:.2,maxDiffPixelRatio:.005})
 }
 await before.close()
})

test('current primary missing values stay missing and actual zero stays zero',async({page})=>{
 const s=await setup(page);await s.open();await s.finish('weather',{...weather,current:{...weather.current,temperature_2m:0,apparent_temperature:null,relative_humidity_2m:null,visibility:null,cloud_cover:null,uv_index:null},daily:{...weather.daily,precipitation_sum:weather.daily.time.map(()=>null),precipitation_probability_max:weather.daily.time.map(()=>null)}})
 await expect(page.locator('.big-temp')).toHaveText('0°C')
 for(const metric of ['metric-summary','metric-precipProb','metric-cloudCover','metric-humidity'])await expect(page.locator(`.current-weather-metrics .${metric} .value`).last()).toHaveText('—')
})
