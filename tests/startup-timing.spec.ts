import { test, expect } from '@playwright/test'
import { weather } from './forecast-order-fixture'
import fs from 'node:fs/promises'

// Real timers and production bundles. Both revisions receive identical synthetic
// inputs. Only fixed phase names/numeric durations are exported, never locations.
const cases = [
 {name:'desktop-no-gps',width:1440,permission:'prompt'},
 {name:'phone-fast-gps',width:390,gps:100},
 {name:'phone-gps-3800',width:390,gps:3800},
 {name:'denied-gps',width:390,permission:'denied'},
 {name:'slow-reverse',width:390,gps:100,reverse:5000},
 {name:'slow-default',width:390,gps:100,preferred:2000},
 {name:'slow-weather',width:1440,permission:'prompt',main:4000},
] as const
for(const scenario of cases)for(const revision of ['before','after'])for(let repeat=1;repeat<=3;repeat++){
 test(`${scenario.name} ${revision} ${repeat}`,async({page},info)=>{
  const s:any=scenario,counts={weather:0,marine:0,aqi:0,images:0}
  await page.setViewportSize({width:s.width,height:900})
  await page.addInitScript(({s})=>{
   const w=window as any,events:{phase:string,ms:number}[]=[]
   const mark=(phase:string)=>{if(!events.some(e=>e.phase===phase))events.push({phase,ms:Math.round(performance.now()*10)/10})}
   w.timingEvidence=events
   localStorage.setItem('meteoPulseLanguage','en')
   Math.random=()=>0.25
   if(s.preferred)localStorage.setItem('meteo-pulse-auth',JSON.stringify({access_token:'synthetic-fixture',refresh_token:'synthetic-fixture',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'00000000-0000-0000-0000-000000000002'}}))
   Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:()=>{mark('permission:start');return Promise.resolve({state:s.permission||'granted'}).then(value=>{mark('permission:end');return value})}}})
   Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(success:any)=>{mark('gps:start');setTimeout(()=>{mark('gps:end');success({coords:{latitude:43.2256,longitude:27.8888}})},s.gps||0)}}})
   const fetchOriginal=window.fetch.bind(window)
   let defaultResponses=0
   window.fetch=async(input,options)=>{
    const u=new URL(String(input),location.href)
    const source=u.hostname==='api.open-meteo.com'?'weather':u.hostname==='marine-api.open-meteo.com'?'marine':u.hostname==='air-quality-api.open-meteo.com'?'aqi':u.hostname==='nominatim.openstreetmap.org'?'reverse':u.pathname.startsWith('/rest/v1/')?'default':null
    if(source)mark(`${source}:start`)
    const response=await fetchOriginal(input,options)
    if(source==='weather'){
     mark('weather:response');const original=response.json.bind(response)
     response.json=async()=>{const value=await original();mark('weather:parsed');return value}
    }else if(source==='default'){if(++defaultResponses===2)mark('default:end')}
    else if(source)mark(`${source}:end`)
    return response
   }
   window.addEventListener('DOMContentLoaded',()=>{
    mark('dom:ready')
    new MutationObserver(()=>{
     if(document.querySelector('.skeleton-current'))mark('skeleton:commit')
     if(document.querySelector('.big-temp')&&!events.some(e=>e.phase==='card:commit')){
      mark('card:commit');requestAnimationFrame(()=>requestAnimationFrame(()=>mark('card:paint')))
     }
    }).observe(document.body,{subtree:true,childList:true,characterData:true})
   })
  },{s})
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url())
   const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms))
   if(u.hostname==='api.open-meteo.com'){counts.weather++;await delay(s.main||120);return route.fulfill({json:weather})}
   if(u.hostname==='marine-api.open-meteo.com'||u.hostname==='air-quality-api.open-meteo.com'){
    const source=u.hostname.startsWith('marine')?'marine':'aqi';counts[source]++;await delay(6000)
    return route.fulfill({json:source==='marine'?{current:{sea_surface_temperature:20}}:{current:{european_aqi:35}}}).catch(()=>{})
   }
   if(u.hostname==='nominatim.openstreetmap.org'){await delay(s.reverse||40);return route.fulfill({json:{address:{city:'Varna',suburb:'Troshevo'}}}).catch(()=>{})}
   if(u.pathname.startsWith('/rest/v1/')){await delay(s.preferred||0);return route.fulfill({json:u.pathname.endsWith('/favorite_places')?[{id:'00000000-0000-0000-0000-000000000010',name:'Sofia',latitude:42.6977,longitude:23.3219,geoname_id:null,country_code:null,admin1_id:null}]:[{default_place_id:'00000000-0000-0000-0000-000000000010'}]})}
   if(u.hostname==='picsum.photos'){counts.images++;return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#123456"/></svg>'})}
   if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/'))return route.continue()
   if(u.pathname==='/api/alerts')return route.fulfill({json:{contractVersion:2,pro:false,enabled:[],alerts:[]}})
   return route.fulfill({json:{}})
  })
  await page.goto(`http://127.0.0.1:${revision==='before'?4185:4186}/?startupTiming=1`)
  await expect(page.locator('.big-temp')).toBeVisible()
  await expect.poll(()=>page.evaluate(()=>(window as any).timingEvidence.some((e:any)=>e.phase==='card:paint'))).toBe(true)
  const visible=async()=>({temperature:await page.locator('.big-temp').textContent(),heading:await page.locator('.main-card h2').textContent(),background:await page.locator('.main-card > img').getAttribute('src')})
  const initial=await visible()
  if(s.reverse)await page.waitForTimeout(5300) // late label must not rename shown card
  expect(await visible()).toEqual(initial)
  expect(counts).toEqual({weather:1,marine:1,aqi:1,images:1})
  const events=await page.evaluate(()=>(window as any).timingEvidence)
  const get=(phase:string)=>events.find((e:any)=>e.phase===phase)?.ms
  expect(get('card:paint')).toBeGreaterThanOrEqual(get('weather:parsed'))
  for(const source of ['marine','aqi'])expect(get(`${source}:end`)===undefined||get('card:paint')<get(`${source}:end`)).toBe(true)
  if(revision==='after'){
   if(s.reverse)expect(get('weather:start')).toBeLessThan(get('reverse:end'))
   if(s.gps===3800)expect(get('weather:start')-get('gps:start')).toBeGreaterThanOrEqual(3750)
   if(s.preferred)expect(get('weather:start')).toBeGreaterThanOrEqual(get('default:end'))
  }
  const integrated=await page.evaluate(()=>(window as any).meteoStartupTiming?.()||[])
  if(revision==='after'){
   expect(integrated.some((e:any)=>e.phase==='card:paint')).toBe(true)
   expect(integrated.every((e:any)=>Object.keys(e).sort().join(',')==='ms,phase'&&typeof e.ms==='number')).toBe(true)
  }
  const proof={scenario:s.name,revision,repeat,events,integrated,requests:counts}
  await fs.writeFile(info.outputPath('timings.json'),JSON.stringify(proof,null,2))
  await info.attach('timings',{path:info.outputPath('timings.json'),contentType:'application/json'})
  if(repeat===1)await page.screenshot({path:info.outputPath('forecast.png'),fullPage:true})
 })
}
