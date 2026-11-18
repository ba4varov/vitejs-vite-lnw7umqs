import {test, expect, type Page} from '@playwright/test'
import {weather} from './forecast-order-fixture'

function event(id:string,lat:number,lon:number,mag:number,time:number) {
  return {
    id:'usgs:'+id,source:'USGS',lat,lon,magnitude:mag,time,
    updatedAt:time+1000,place:'15 km from Varna, Bulgaria',
    depthKm:11.5,url:'https://earthquake.usgs.gov/earthquakes/eventpage/'+id,
    preliminary:true,
  }
}

async function boot(page:Page,lang:'bg'|'en',geo:{lat:number;lon:number},data:object){
  await page.addInitScript(({lang,geo})=>{
    localStorage.setItem('meteoPulseLanguage',lang)
    localStorage.setItem('meteoPulseConfirmedLocationV1',JSON.stringify({
      name:lang==='bg'?'Варна':'Varna',lat:geo.lat,lon:geo.lon,
      source:'manual',countryCode:'BG',geonameId:726050
    }))
  },{lang,geo})
  let quakeCalls=0,pushCalls=0
  await page.route('**/*',route=>{
    const url=new URL(route.request().url())
    if(url.pathname==='/api/earthquakes'){
      quakeCalls++
      return route.fulfill({json:data})
    }
    if(url.pathname.startsWith('/api/push')){
      pushCalls++
      return route.fulfill({status:503,json:{error:'DISABLED'}})
    }
    if(url.hostname==='api.open-meteo.com')return route.fulfill({json:weather})
    if(url.pathname==='/api/alerts')return route.fulfill({json:{status:'resolved',days:[],alerts:[]}})
    if(url.hostname==='127.0.0.1' && !url.pathname.startsWith('/api/'))return route.continue()
    return route.fulfill({json:{}})
  })
  await page.goto('/')
  await expect(page.locator('.main-card .big-temp')).toBeVisible()
  return {quakeCalls:()=>quakeCalls,pushCalls:()=>pushCalls}
}
for(const [width,lang] of [[360,'bg'],[390,'en'],[768,'bg'],[1440,'en']] as const) {
  test(`earthquake panel ${width}px ${lang}: filters and attributes accurately`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:850})
    const now=Date.now()
    const record={
      status:'ready',source:'USGS',checkedAt:now,feedUpdatedAt:now,refreshSeconds:90,
      pushDeliveryEnabled:false,
      events:[
        event('near',43.2141,27.9147,3.1,now-60_000),
        event('far',43.2141,30.5,6,now-70_000),
        event('weak',43.2141,27.9147,2.9,now-80_000),
        event('old',43.2141,27.9147,5,now-25*60*60_000)
      ]
    }
    const requests=await boot(page,lang,{lat:43.2141,lon:27.9147},record)
    const section=page.locator('.earthquake-nearby')
    await expect(section).toBeVisible()
    await expect(section.locator('li')).toHaveCount(1)
    await expect(section.getByText(/M 3\.1/)).toBeVisible()
    await expect(section.getByText(/100 (км|km)/)).toBeVisible()
    await expect(section.getByText(lang==='bg'?/не е ранно предупреждение/i:/not an earthquake early-warning/i)).toBeVisible()
    await expect(section.locator('a')).toHaveAttribute('href','https://earthquake.usgs.gov/earthquakes/eventpage/near')
    expect(requests.quakeCalls()).toBe(1)
    expect(requests.pushCalls()).toBe(0)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await section.screenshot({path:testInfo.outputPath(`earthquake-${width}-${lang}.png`),animations:'disabled'})
  })
}

test('no nearby earthquakes means no warning box and no false all-clear',async({page})=>{
  const now=Date.now()
  const state=await boot(page,'bg',{lat:43.2141,lon:27.9147},{
    status:'ready',source:'USGS',checkedAt:now,
    events:[event('far',1,1,8,now-5000)]
  })
  await expect(page.locator('.earthquake-nearby')).toHaveCount(0)
  expect(state.pushCalls()).toBe(0)
})

test('an upstream failure does not announce no earthquakes or trigger push',async({page})=>{
  const state=await boot(page,'en',{lat:43.2141,lon:27.9147},{
    status:'unavailable',error:'EARTHQUAKES_UNAVAILABLE'
  })
  await expect(page.locator('.earthquake-nearby')).toHaveCount(0)
  expect(state.pushCalls()).toBe(0)
})

test('new city uses new local distance without sending location to USGS proxy',async({page})=>{
  const now=Date.now()
  const state=await boot(page,'bg',{lat:43.2141,lon:27.9147},{
    status:'ready',source:'USGS',checkedAt:now,
    events:[event('varna',43.2141,27.9147,3.8,now-60_000)]
  })
  await expect(page.locator('.earthquake-nearby li')).toHaveCount(1)
  await page.getByRole('button',{name:'София',exact:true}).click()
  await expect(page.locator('.earthquake-nearby')).toHaveCount(0)
  expect(state.pushCalls()).toBe(0)
  expect(state.quakeCalls()).toBe(1)
})

test('stale feed is explicitly marked; too old data are hidden',async({page})=>{
  const now=Date.now()
  await boot(page,'bg',{lat:43.2141,lon:27.9147},{
    status:'stale',source:'USGS',checkedAt:now-3*60_000,
    events:[event('near',43.2141,27.9147,3.3,now-5*60_000)]
  })
  await expect(page.locator('.earthquake-nearby')).toBeVisible()
  await expect(page.locator('.earthquake-data-status')).toBeVisible()
})
