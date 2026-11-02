import { test, expect } from '@playwright/test'
import { weather } from './forecast-order-fixture'
import { clickHeaderControl } from './header-navigation'

// These fixtures test an existing forecast, starting from a confirmed city.
test.beforeEach(async ({page}) => {
 await page.addInitScript(() => localStorage.setItem('meteoPulseConfirmedLocationV1',JSON.stringify({name:'Varna',lat:43.2141,lon:27.9147,source:'manual'})))
})
for (const width of [390,1440]) for (const lang of ['bg','en']) for (const dark of [false,true]) {
 test(`rain warning ${width} ${lang} ${dark}`, async ({page})=>{
  await page.setViewportSize({width,height:1000})
  await page.clock.install({time:new Date('2026-10-12T20:59:00Z')})
  await page.addInitScript(lang=>localStorage.setItem('meteoPulseLanguage',lang),lang)
  let hold=false
  const pending: (()=>void)[]=[]
  const data=structuredClone(weather)
  data.hourly.precipitation=Array.from({length:360},(_,i)=>i<24?(i===0?4.7:i===23?2:1.9):0)
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url())
   if(url.hostname==='127.0.0.1'&&!url.pathname.startsWith('/api/'))return route.continue()
   if(url.hostname==='api.open-meteo.com'){
    if(hold)await new Promise<void>(resolve=>pending.push(resolve))
    return route.fulfill({json:data})
   }
   return route.fulfill({json:{}})
  })
  await page.goto('/')
  const warning=page.locator('.rain-warning')
  await expect(warning).toBeVisible()
  await expect(warning).toContainText(lang==='bg'?'48,5':'48.5')
  await expect(warning).toContainText('Open-Meteo')
  await expect(warning).toContainText(lang==='bg'?'Местно време':'Local time')
  await expect(warning).not.toContainText('Europe/Sofia')
  if(dark){
   await clickHeaderControl(page,page.locator('.header-menu > .icon-btn'))
   const toggle=page.locator('.mobile-menu-toggle')
   if(await toggle.isVisible())await toggle.click()
  }
  expect(await warning.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
  expect((await warning.boundingBox())!.y).toBeLessThan((await page.locator('.main-card').boundingBox())!.y)
  await page.clock.fastForward(15*60*1000)
  await expect(warning).toHaveCount(1)
  hold=true
  await page.getByRole('button',{name:lang==='bg'?'София':'Sofia',exact:true}).click()
  await expect(warning).toHaveCount(0)
  await expect(page.locator('.forecast-loading')).toBeVisible()
  hold=false;pending.splice(0).forEach(resolve=>resolve())
  await expect(warning).toHaveCount(1)
 })
}

test('GPS pending clears the warning and new forecast restores it', async ({page})=>{
 await page.clock.install({time:new Date('2026-10-12T20:59:00Z')})
 const data=structuredClone(weather)
 data.hourly.precipitation=Array(360).fill(2)
 await page.route('**/*',route=>{
  const url=new URL(route.request().url())
  if(url.hostname==='127.0.0.1'&&!url.pathname.startsWith('/api/'))return route.continue()
  return route.fulfill({json:url.hostname==='api.open-meteo.com'?data:{}})
 })
 await page.goto('/')
 const warning=page.locator('.rain-warning')
 await expect(warning).toBeVisible()
 await page.evaluate(()=>{
  navigator.geolocation.getCurrentPosition=(success)=>{(window as any).gpsSuccess=success}
 })
 await page.locator('.location-btn').click()
 await expect(warning).toHaveCount(0)
 await page.evaluate(()=>(window as any).gpsSuccess({coords:{latitude:42,longitude:23,accuracy:25}}))
 await expect(warning).toBeVisible()
 await expect(warning).toContainText('48')
})
