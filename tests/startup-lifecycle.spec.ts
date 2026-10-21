import {test,expect,type Page} from '@playwright/test'
import {weather} from './forecast-order-fixture'
const production=process.env.LIFECYCLE_PRODUCTION!=='0'
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function prepare(page:Page,gpsMs:number,networkMs:number,preferred:boolean,enabled=true){
 const counts={documents:0,weather:0,reverse:0,restore:0}
 await page.addInitScript(({gpsMs})=>{
  localStorage.setItem('meteoPulseLanguage','bg')
  // Expired synthetic session forces asynchronous profile restoration on each document.
  localStorage.setItem('meteo-pulse-auth',JSON.stringify({access_token:'fixture',refresh_token:'fixture-refresh',expires_at:1,user:{id:'00000000-0000-0000-0000-000000000002'}}))
  Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:async()=>({state:'granted'})}})
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(success:any)=>setTimeout(()=>success({coords:{latitude:43.2256,longitude:27.8888}}),gpsMs)}})
  const w=window as any;w.lifecycleViolations=[];w.sawForecast=false
  document.addEventListener('DOMContentLoaded',()=>{
   new MutationObserver(()=>{
    const forecast=Boolean(document.querySelector('.big-temp'))
    const initial=document.querySelector('.forecast-loading')?.textContent?.includes('Определяме началното местоположение')
    if(w.sawForecast&&initial)w.lifecycleViolations.push('initial-after-forecast')
    if(forecast)w.sawForecast=true
   }).observe(document.documentElement,{subtree:true,childList:true,characterData:true})
  })
 },{gpsMs})
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url())
  if(route.request().isNavigationRequest()&&route.request().frame()===page.mainFrame())counts.documents++
  if(u.hostname==='api.open-meteo.com'){
   counts.weather++;await delay(networkMs)
   return route.fulfill({json:weather})
  }
  if(u.hostname==='nominatim.openstreetmap.org'){counts.reverse++;await delay(2800);return route.fulfill({json:{address:{city:'Варна',suburb:'Трошево'}}}).catch(()=>{})}
  if(u.hostname==='air-quality-api.open-meteo.com'){await delay(networkMs+100);return route.fulfill({json:{current:{european_aqi:35}}})}
  if(u.hostname==='marine-api.open-meteo.com'){await delay(networkMs+200);return route.fulfill({json:{current:{sea_surface_temperature:20}}})}
  if(u.pathname==='/auth/v1/token'){counts.restore++;await delay(networkMs+150);return route.fulfill({json:{access_token:'fixture-restored',refresh_token:'fixture-rotated',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'00000000-0000-0000-0000-000000000002'}}})}
  if(u.pathname.startsWith('/rest/v1/')){await delay(networkMs+200);return route.fulfill({json:u.pathname.endsWith('/favorite_places')?(preferred?[{id:'00000000-0000-0000-0000-000000000010',name:'Варна',latitude:43.2141,longitude:27.9147}]:[]):[{default_place_id:preferred?'00000000-0000-0000-0000-000000000010':null}]})}
  if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/'))return route.continue()
  if(u.pathname==='/api/weather-advice')return route.fulfill({json:{advice:'Тестова прогноза.'}})
  if(u.pathname==='/api/alerts')return route.fulfill({json:{contractVersion:2,pro:false,enabled:[],alerts:[]}})
  return route.fulfill({json:{}})
 })
 await page.goto(enabled?'/?startupTiming=1':'/')
 return counts
}
const journal=(page:Page)=>page.evaluate(()=>(window as any).meteoStartupLifecycle())
for(const [gpsMs,networkMs,preferred] of [[800,60,false],[3800,180,false],[800,700,true]] as const)test(`one manual reload retains successful startup ${gpsMs}/${networkMs}/${preferred}`,async({page},info)=>{
 const counts=await prepare(page,gpsMs,networkMs,preferred)
 await expect(page.locator('.big-temp')).toBeVisible({timeout:15000})
 await page.evaluate(()=>navigator.serviceWorker.ready)
 await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true)
 const original=await journal(page)
 expect(original.document).toBe(1)
 await page.reload({waitUntil:'domcontentloaded'}) // The only manual refresh in this scenario.
 await expect(page.locator('.big-temp')).toBeVisible({timeout:15000})
 // Observe beyond the supplied seven-second video, including late reverse/profile data.
 await delay(7500)
 expect(counts.documents).toBe(2);expect(counts.weather).toBe(2);expect(counts.restore).toBeGreaterThanOrEqual(2)
 expect(await page.evaluate(()=>(window as any).lifecycleViolations)).toEqual([])
 const result=await journal(page),events=result.events.filter((e:any)=>e.document===result.document)
 expect(result.document).toBe(2)
 expect(result.events.some((e:any)=>e.event==='worker:controllerchange')).toBe(true)
 expect(events.filter((e:any)=>e.event==='document:start').map((e:any)=>e.navigation)).toEqual(['reload'])
 expect(events.filter((e:any)=>e.event==='root:create')).toHaveLength(1)
 const setups=events.filter((e:any)=>e.event==='app:setup')
 expect(new Set(setups.map((e:any)=>e.instance)).size).toBe(1)
 expect(setups.length).toBe(production?1:2) // StrictMode rehearsal is same-instance, dev-only.
 const views=events.filter((e:any)=>e.event==='app:view')
 const first=views.findIndex((e:any)=>e.view==='forecast');expect(first).toBeGreaterThanOrEqual(0)
 expect(views.slice(first+1).filter((e:any)=>e.view==='initial-location')).toEqual([])
 expect(events.some((e:any)=>e.event==='session:observed'&&e.authenticated)).toBe(true)
 expect(events.some((e:any)=>e.event==='location:decision')).toBe(true)
 // Real worker activation/controller change and browser lifecycle events must not reload the document.
 await page.evaluate(async()=>{await (await navigator.serviceWorker.ready).update();document.dispatchEvent(new Event('freeze'));document.dispatchEvent(new Event('resume'))})
 await delay(400)
 expect(counts.documents).toBe(2);await expect(page.locator('.big-temp')).toBeVisible()
 await info.attach('safe-lifecycle-journal',{body:JSON.stringify(await journal(page),null,2),contentType:'application/json'})
})
test('same document location loading is distinguished from initial election',async({page})=>{
 const counts=await prepare(page,800,100,false)
 await expect(page.locator('.big-temp')).toBeVisible({timeout:15000})
 await page.locator('.city-row .city-btn').nth(1).click()
 await expect(page.locator('.big-temp')).toBeVisible()
 const result=await journal(page),views=result.events.filter((e:any)=>e.event==='app:view')
 expect(views.some((e:any)=>e.view==='forecast-loading'&&e.ready)).toBe(true)
 const first=views.findIndex((e:any)=>e.view==='forecast')
 expect(views.slice(first+1).some((e:any)=>e.view==='initial-location')).toBe(false)
 expect(counts.documents).toBe(1)
})
test('lifecycle persistence and browser API are absent without opt-in',async({page})=>{
 await prepare(page,800,60,false,false)
 await expect(page.locator('.big-temp')).toBeVisible({timeout:15000})
 expect(await page.evaluate(()=>({api:typeof (window as any).meteoStartupLifecycle,journal:sessionStorage.getItem('meteo-startup-lifecycle-v1')}))).toEqual({api:'undefined',journal:null})
})

if(!production)test('controlled real React remount changes instance within the same document',async({page})=>{
 await prepare(page,800,60,false)
 await page.goto('/tests/lifecycle-remount.html?startupTiming=1')
 await expect(page.locator('.big-temp')).toBeVisible({timeout:15000})
 const before=await journal(page)
 await page.evaluate(()=>(window as any).remountFixture())
 await expect.poll(async()=>{const j=await journal(page);return new Set(j.events.filter((e:any)=>e.document===j.document&&e.event==='app:setup').map((e:any)=>e.instance)).size}).toBe(2)
 await expect(page.locator('.big-temp')).toBeVisible({timeout:15000})
 const after=await journal(page)
 expect(after.document).toBe(before.document)
 const events=after.events.filter((e:any)=>e.document===after.document)
 expect(events.filter((e:any)=>e.event==='root:create')).toHaveLength(1)
 expect(events.filter((e:any)=>e.event==='app:view'&&e.view==='initial-location')).toHaveLength(2)
})
