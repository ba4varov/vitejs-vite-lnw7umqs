import { test, expect, type Page } from '@playwright/test'
import { weather } from './forecast-order-fixture'
import { clickHeaderControl } from './header-navigation'
import fs from 'node:fs/promises'

test.use({ hasTouch: true })
type Mode='fast'|'slow'|'denied'|'missing'|'late'|'manual'|'default'|'no-permissions'|'stalled-permission'|'denied-callback'|'slow-label'
const gps={latitude:43.2256,longitude:27.8888}
const sofia={id:'00000000-0000-0000-0000-000000000010',name:'Sofia',latitude:42.6977,longitude:23.3219,geoname_id:null,country_code:null,admin1_id:null}
async function setup(page:Page,mode:Mode,lang='en',width=390,dark=false){
 const calls:{source:string,lat:string|null}[]=[], images:string[]=[]
 let releaseDefault=()=>{},releaseLabel=()=>{}
 let temperatureOverride:number|null=null
 const defaultWait=new Promise<void>(r=>{releaseDefault=r}),labelWait=new Promise<void>(r=>{releaseLabel=r})
 await page.setViewportSize({width,height:900});await page.clock.install({time:new Date('2026-10-14T09:00:00Z')});await page.clock.pauseAt(new Date('2026-10-14T09:01:00Z'))
 await page.addInitScript(({mode,lang})=>{
  localStorage.setItem('meteoPulseLanguage',lang)
  if(mode==='default')localStorage.setItem('meteo-pulse-auth',JSON.stringify({access_token:'gps-fixture-token',refresh_token:'gps-fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'00000000-0000-0000-0000-000000000002'}}))
  const w=window as any;w.gpsCalls=[];w.forecastHistory=[]
  window.addEventListener('DOMContentLoaded',()=>{
   new MutationObserver(()=>{
    const temp=document.querySelector('.big-temp')?.textContent
    if(!temp)return
    const value={temp,heading:document.querySelector('.main-card h2')?.textContent,background:document.querySelector('.main-card > img')?.getAttribute('src')}
    if(JSON.stringify(w.forecastHistory.at(-1))!==JSON.stringify(value))w.forecastHistory.push(value)
   }).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['src']})
  })
  Object.defineProperty(navigator,'permissions',{configurable:true,value:mode==='no-permissions'?undefined:{query:()=>mode==='stalled-permission'?new Promise(()=>{}):Promise.resolve({state:mode==='denied'?'denied':mode==='no-permissions'?'prompt':'granted'})}})
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:mode==='missing'?undefined:{getCurrentPosition:(success:any,error:any,options:any)=>{w.gpsCalls.push({success,error,options})}}})
 },{mode,lang})
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url()),source=u.hostname==='api.open-meteo.com'?'weather':u.hostname==='marine-api.open-meteo.com'?'marine':u.hostname==='air-quality-api.open-meteo.com'?'aqi':null
  if(source){calls.push({source,lat:u.searchParams.get('latitude')});if(source==='weather'){const lat=Number(u.searchParams.get('latitude'));return route.fulfill({json:{...weather,current:{...weather.current,temperature_2m:temperatureOverride??(lat===gps.latitude?13:lat===sofia.latitude?17:12)}}})}return route.fulfill({json:source==='marine'?{current:{sea_surface_temperature:20}}:{current:{european_aqi:35,pm10:12,pm2_5:6}}})}
  if(u.hostname==='nominatim.openstreetmap.org'){if(mode==='slow-label')await labelWait;return route.fulfill({json:{address:{city:u.searchParams.get('accept-language')==='bg'?'Варна':'Varna',suburb:u.searchParams.get('accept-language')==='bg'?'Трошево':'Troshevo'}}}).catch(()=>{})}
  if(u.pathname.startsWith('/rest/v1/')){if(mode==='default')await defaultWait;return route.fulfill({json:u.pathname.endsWith('/favorite_places')?[sofia]:[{default_place_id:sofia.id}]})}
  if(u.hostname==='picsum.photos'){images.push(u.href);return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#123456"/></svg>'})}
  if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/'))return route.continue()
  if(u.pathname==='/api/weather-advice')return route.fulfill({json:{advice:'Weather advice fixture.'}})
  if(u.pathname==='/api/alerts')return route.fulfill({json:{contractVersion:2,pro:false,enabled:[],alerts:[]}})
  return route.fulfill({json:{}})
 })
 await page.goto('/')
 if(dark){await clickHeaderControl(page,page.locator('.header-menu > .icon-btn'));if(await page.locator('.mobile-menu-toggle').isVisible())await page.locator('.mobile-menu-toggle').click()}
 const locate=async(index=0,coords=gps)=>{await expect.poll(()=>page.evaluate(()=> (window as any).gpsCalls.length)).toBeGreaterThan(index);await page.evaluate(({index,coords})=>(window as any).gpsCalls[index].success({coords}),{index,coords})}
 const stable=async()=>({temp:await page.locator('.big-temp').textContent(),heading:await page.locator('.main-card h2').textContent(),background:await page.locator('.main-card > img').getAttribute('src')})
 return {calls,images,locate,stable,releaseDefault,releaseLabel,changeTemperature:(value:number)=>{temperatureOverride=value},weatherCalls:()=>calls.filter(c=>c.source==='weather')}
}
for(const width of [390,1440])for(const lang of ['bg','en'])for(const dark of [false,true])for(const mode of ['fast','slow','denied','missing','late','manual','default'] as Mode[]){
 test(`startup ${mode} ${width} ${lang} ${dark}`,async({page},info)=>{
  const s=await setup(page,mode,lang,width,dark)
  const gpsMode=['fast','slow','late','manual','default'].includes(mode)
  if(gpsMode){await expect.poll(()=>page.evaluate(()=>(window as any).gpsCalls.length)).toBe(1);expect(s.calls).toHaveLength(0);await expect(page.locator('.main-card')).toHaveCount(0)}
  if(mode==='slow'){await page.clock.fastForward(3800);expect(s.calls).toHaveLength(0)}
  if(mode==='fast'||mode==='slow')await s.locate()
  if(mode==='manual'){await page.locator('.city-row .city-btn').nth(1).click();await s.locate()}
  if(mode==='default'){await s.locate();await page.clock.fastForward(1000);expect(s.calls).toHaveLength(0);s.releaseDefault()}
  if(mode==='late')await page.clock.fastForward(5000)
  const temperature=mode==='fast'||mode==='slow'?'13°C':mode==='manual'||mode==='default'?'17°C':'12°C'
  await expect(page.locator('.big-temp')).toHaveText(temperature)
  await expect(page.locator('.main-card > img')).toBeVisible()
  const first=await s.stable();if(mode==='late')await s.locate()
  await page.clock.fastForward(10000)
  expect(await s.stable()).toEqual(first)
  expect(s.weatherCalls()).toHaveLength(1)
  for(const source of ['weather','marine','aqi'])expect(s.calls.filter(c=>c.source===source)).toHaveLength(1)
  expect(s.images).toHaveLength(1)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  if(mode==='slow'&&width===390&&lang==='bg'&&!dark){
   const history=await page.evaluate(()=>(window as any).forecastHistory)
   expect([...new Set(history.map((value:any)=>value.temp))]).toEqual(['13°C'])
   expect([...new Set(history.map((value:any)=>value.heading))]).toEqual([first.heading])
   expect([...new Set(history.map((value:any)=>value.background))]).toEqual([first.background])
   await page.screenshot({path:info.outputPath('gps-first-forecast.png'),fullPage:true})
   await fs.writeFile(info.outputPath('stable-startup.json'),JSON.stringify({gpsDeliveryMs:3800,additionalObservationMs:10000,first,afterLateWindow:await s.stable(),domHistory:history,calls:s.calls,images:s.images},null,2))
   await info.attach('stable-startup',{path:info.outputPath('stable-startup.json'),contentType:'application/json'})
  }
 })
}
for(const mode of ['no-permissions','stalled-permission','denied-callback','slow-label'] as Mode[])test(`bounded startup ${mode}`,async({page})=>{
 const s=await setup(page,mode)
 if(mode==='denied-callback'){await expect.poll(()=>page.evaluate(()=>(window as any).gpsCalls.length)).toBe(1);await page.evaluate(()=>(window as any).gpsCalls[0].error({code:1}))}
 if(mode==='slow-label')await s.locate()
 if(mode==='slow-label')await expect(page.locator('.big-temp')).toHaveText('13°C')
 if(mode==='stalled-permission')await page.clock.fastForward(5000)
 await expect(page.locator('.big-temp')).toHaveText(mode==='slow-label'?'13°C':'12°C')
 const first=await s.stable();s.releaseLabel();await page.clock.fastForward(10000);expect(await s.stable()).toEqual(first);expect(s.weatherCalls()).toHaveLength(1)
})
test('late default is loaded but cannot reorder an already displayed fallback',async({page})=>{
 const s=await setup(page,'default');await page.clock.fastForward(5000);await expect(page.locator('.big-temp')).toHaveText('12°C');const first=await s.stable();s.releaseDefault();await expect(page.locator('.place-chip')).toHaveCount(1);expect(await s.stable()).toEqual(first);expect(s.weatherCalls()).toHaveLength(1)
})
test('explicit location remains available after fallback; manual selection cancels explicit GPS',async({page})=>{
 const s=await setup(page,'denied');await expect(page.locator('.big-temp')).toHaveText('12°C')
 await page.getByRole('button',{name:'Use my location',exact:true}).click();await s.locate();await expect(page.locator('.big-temp')).toHaveText('13°C')
 await page.getByRole('button',{name:'Use my location',exact:true}).click();await page.locator('.city-row .city-btn').nth(1).click();await s.locate(1);await expect(page.locator('.big-temp')).toHaveText('17°C');await page.clock.fastForward(10000);await expect(page.locator('.big-temp')).toHaveText('17°C');expect(s.weatherCalls()).toHaveLength(3)
})
test('same-coordinate selections and 15 minute refresh retain the background without duplicate requests',async({page})=>{
 const s=await setup(page,'denied');await expect(page.locator('.big-temp')).toHaveText('12°C');const first=await s.stable()
 await page.locator('.city-row .city-btn').first().click();await page.getByRole('button',{name:'Use my location',exact:true}).click();await s.locate(0,{latitude:43.2141,longitude:27.9147});await page.clock.fastForward(1000)
 expect(s.weatherCalls()).toHaveLength(1);expect((await s.stable()).background).toBe(first.background)
 s.changeTemperature(14)
 await page.clock.fastForward(15*60*1000);await expect.poll(()=>s.weatherCalls().length).toBe(2);await expect(page.locator('.big-temp')).toHaveText('14°C');await expect(page.locator('.forecast-refresh')).toHaveCount(0);expect((await s.stable()).background).toBe(first.background);expect(s.images).toHaveLength(1)
})
test('explicit GPS timeout does not block startup, and a later explicit result is ignored',async({page})=>{
 const s=await setup(page,'slow');await page.getByRole('button',{name:'Use my location',exact:true}).click();await page.clock.fastForward(5000);await expect(page.locator('.big-temp')).toHaveText('12°C');await s.locate(1);await page.clock.fastForward(1000);await expect(page.locator('.big-temp')).toHaveText('12°C');expect(s.weatherCalls()).toHaveLength(1)
})

test('language change can localize GPS after first forecast without another weather request',async({page})=>{
 const s=await setup(page,'slow-label','en');await s.locate();await expect(page.locator('.big-temp')).toHaveText('13°C');await clickHeaderControl(page,page.locator('.lang-btn'));s.releaseLabel()
 await expect(page.locator('.big-temp')).toHaveText('13°C');await expect(page.locator('.main-card h2')).toContainText('Варна');await expect(page.locator('.main-card h2')).toContainText('Трошево')
 const first=await s.stable();await page.clock.fastForward(10000);expect(await s.stable()).toEqual(first);expect(s.weatherCalls()).toHaveLength(1)
})
