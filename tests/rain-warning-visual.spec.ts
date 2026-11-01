import { test, expect } from '@playwright/test'
import { weather } from './forecast-order-fixture'
import { clickHeaderControl } from './header-navigation'

for (const width of [390, 640, 768, 1180, 1440]) for (const lang of ['bg', 'en']) for (const dark of [false, true]) for (const system of ['light', 'dark'] as const) {
 test(`rain presentation ${width} ${lang} app:${dark?'dark':'light'} system:${system}`, async ({page})=>{
  await page.setViewportSize({width,height:1100})
  await page.emulateMedia({colorScheme:system,reducedMotion:'reduce'})
  await page.clock.install({time:new Date('2026-11-02T01:59:00Z')})
  await page.addInitScript(lang=>localStorage.setItem('meteoPulseLanguage',lang),lang)
  const data=structuredClone(weather)
  data.current.time='2026-11-02T04:00'
  data.hourly.time=Array.from({length:360},(_,i)=>new Date(Date.UTC(2026,10,2,4+i)).toISOString().slice(0,16))
  data.hourly.precipitation=Array(360).fill(3)
  await page.route('**/*',route=>{
   const url=new URL(route.request().url())
   if(url.hostname==='127.0.0.1'&&!url.pathname.startsWith('/api/'))return route.continue()
   return route.fulfill({json:url.hostname==='api.open-meteo.com'?data:{}})
  })
  await page.goto('/')
  const warning=page.locator('.rain-warning')
  await expect(warning).toBeVisible({timeout:15000})
  if(dark){
   await clickHeaderControl(page,page.locator('.header-menu > .icon-btn'))
   const toggle=page.locator('.mobile-menu-toggle')
   if(await toggle.isVisible())await toggle.click()
  }
  await expect(page.locator('.weather-app')).toHaveClass(dark?'weather-app dark':'weather-app')
  await expect(warning.locator('h2')).toContainText(lang==='bg'?'Много голямо количество':'Very high rainfall')
  await expect(warning.locator('.rain-warning-period')).toHaveText(lang==='bg'?'2 ноември, 04:00 – 3 ноември, 04:00 ч.Местно време':'2 November, 04:00 – 3 November, 04:00Local time')
  await expect(warning).not.toContainText(/GMT|Гринуич|Europe\/Sofia/)
  const box=(await warning.boundingBox())!, main=(await page.locator('.main-card').boundingBox())!
  expect(Math.abs(box.x-main.x)).toBeLessThan(1)
  expect(Math.abs(box.width-main.width)).toBeLessThan(1)
  expect(box.y+box.height).toBeLessThan(main.y)
  expect(box.width+box.x).toBeLessThanOrEqual(width)
  const contrast=await warning.evaluate(element=>{
   const rgb=(value:string)=>value.match(/[\d.]+/g)!.slice(0,3).map(Number)
   const luminance=(color:number[])=>color.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)
   const background=luminance(rgb(getComputedStyle(element).backgroundColor))
   return [...element.querySelectorAll('h2,p,small,strong')].map(node=>{
    const foreground=luminance(rgb(getComputedStyle(node).color))
    return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05)
   })
  })
  expect(Math.min(...contrast)).toBeGreaterThanOrEqual(4.5)
  expect(await warning.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
  if(system==='dark'&&!dark&&lang==='bg'&&[390,1440].includes(width))await warning.screenshot({path:`work/rain-warning-${width}.png`})
 })
}
