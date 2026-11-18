import {test,expect,type Page} from '@playwright/test'
import {weather} from './forecast-order-fixture'
import {openHeaderMenu} from './header-navigation'

function event(id:string,lat:number,lon:number,time:number,mag=3.6) {
  return {id:'usgs:'+id,source:'USGS',lat,lon,magnitude:mag,time,
    updatedAt:time+1000,place:id+' epicentre',depthKm:9.5,
    url:'https://earthquake.usgs.gov/earthquakes/eventpage/'+id,preliminary:true}
}
function catalog(period:7|30) {
  const now=Date.now(),day=86_400_000
  const shared=[
    event('sofia',42.7,23.3,now-2*day,3.2),
    event('varna',43.2,27.9,now-1*day,3.6),
    ...Array.from({length:12},(_,i)=>event('athens'+i,37.9+i*.001,23.7,now-3*day-i*60_000,4.1))
  ]
  return {
    status:'ready',source:'USGS',periodDays:period,checkedAt:now,
    limitReached:false,limit:500,pushDeliveryEnabled:false,
    events:period===30?[...shared,event('historic',42.7,23.3,now-18*day,3.4)]:shared
  }
}

async function bootstrap(page:Page,lang:'bg'|'en',opts:{
  noLocation?:boolean; fail?:boolean; empty?:boolean; stale?:boolean
}={}) {
  await page.addInitScript(({lang,noLocation})=>{
    localStorage.setItem('meteoPulseLanguage',lang)
    if(!noLocation)localStorage.setItem('meteoPulseConfirmedLocationV1',JSON.stringify({
      name:lang==='bg'?'Варна':'Varna',lat:43.2141,lon:27.9147,
      source:'manual',countryCode:'BG',geonameId:726050
    }))
  },{lang,noLocation:opts.noLocation??false})
  const queries:string[]=[],pushes:string[]=[]
  await page.route('**/*',route=>{
    const u=new URL(route.request().url())
    if(u.pathname==='/api/alerts'&&u.searchParams.get('source')==='earthquake-history') {
      queries.push(u.search)
      const period=Number(u.searchParams.get('period'))
      if(opts.fail)return route.fulfill({status:503,json:{status:'unavailable'}})
      const data=catalog(period===30?30:7)
      if(opts.empty)data.events=[]
      if(opts.stale)data.status='stale'
      return route.fulfill({json:data})
    }
    if(u.pathname.startsWith('/api/push')) {
      pushes.push(u.pathname)
      return route.fulfill({status:503,json:{error:'DISABLED'}})
    }
    if(u.pathname==='/api/alerts'&&u.searchParams.get('source')==='earthquakes')
      return route.fulfill({json:{status:'ready',source:'USGS',events:[],checkedAt:Date.now()}})
    if(u.hostname==='api.open-meteo.com')return route.fulfill({json:weather})
    if(u.pathname==='/api/alerts')return route.fulfill({json:{contractVersion:2,pro:false,enabled:[],alerts:[]}})
    if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/'))return route.continue()
    return route.fulfill({json:{}})
  })
  await page.goto('/')
  await expect(page.locator('.earthquake-history')).toBeVisible()
  return {queries,pushes}
}

for(const [width,lang,dark] of [
  [360,'bg',false],[390,'en',false],[768,'bg',false],[1440,'en',false],
  [360,'en',true],[390,'bg',true],[768,'en',true],[1440,'bg',true]
] as const) {
  test(`regional history accessible ${width}px ${lang} ${dark?'dark':'light'}`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:850})
    const {queries,pushes}=await bootstrap(page,lang)
    const panel=page.locator('.earthquake-history')
    expect(queries).toHaveLength(0) // lazy; no FDSN query for every visitor
    if(dark){
      await openHeaderMenu(page)
      await page.locator('.header-menu > .icon-btn').click()
      await expect(page.locator('.weather-app')).toHaveClass(/\bdark\b/)
    }
    const toggle=panel.locator('.earthquake-history-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded','false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded','true')
    await expect(panel.locator('.earthquake-history-list li')).toHaveCount(2)
    expect(queries).toHaveLength(1)
    expect(queries[0]).toBe('?source=earthquake-history&period=7')
    await expect(panel.getByText(/M 3\.2/)).toBeVisible()
    await panel.getByRole('button',{name:lang==='bg'?'Балканите':'Balkans',exact:true}).click()
    await expect(panel.locator('.earthquake-history-list li')).toHaveCount(10)
    expect(queries).toHaveLength(1) // filtering is local, no new API call
    await panel.locator('.earthquake-history-more').click()
    await expect(panel.locator('.earthquake-history-list li')).toHaveCount(14)
    expect(pushes).toHaveLength(0)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await panel.screenshot({path:testInfo.outputPath(`quake-history-${width}-${lang}-${dark?'dark':'light'}.png`),animations:'disabled'})
  })
}

test('changing 7 to 30 days gets separate cached history, without changing 300km alerts',async({page})=>{
  await page.setViewportSize({width:390,height:850})
  const {queries,pushes}=await bootstrap(page,'bg')
  const panel=page.locator('.earthquake-history')
  await panel.getByRole('button',{name:/Виж историята/}).click()
  await expect(panel.locator('.earthquake-history-list li')).toHaveCount(2)
  await panel.getByRole('button',{name:'30 дни'}).click()
  await expect(panel.locator('.earthquake-history-list li')).toHaveCount(3)
  await expect(panel.getByText('historic epicentre')).toBeVisible()
  expect(queries).toHaveLength(2)
  expect(queries[1]).toBe('?source=earthquake-history&period=30')
  expect(pushes).toHaveLength(0)
})

test('history works without a chosen city or permission to obtain GPS coordinates',async({page})=>{
  await page.setViewportSize({width:360,height:800})
  const {queries}=await bootstrap(page,'en',{noLocation:true})
  await expect(page.locator('.earthquake-nearby')).toHaveCount(0)
  await page.getByRole('button',{name:'Browse history'}).click()
  await expect(page.locator('.earthquake-history-list li')).toHaveCount(2)
  expect(queries).toHaveLength(1)
  expect(queries[0]).not.toMatch(/lat=|lon=/)
})

test('no USGS catalog results is not portrayed as confirmed absence of earthquakes',async({page})=>{
  await bootstrap(page,'bg',{empty:true})
  await page.getByRole('button',{name:'Виж историята'}).click()
  await expect(page.locator('.earthquake-history-list li')).toHaveCount(0)
  await expect(page.getByText(/не е потвърждение за липса на земетресения/)).toBeVisible()
})

test('upstream errors show retry rather than an all-clear or fabricated history',async({page})=>{
  await bootstrap(page,'en',{fail:true})
  await page.getByRole('button',{name:'Browse history'}).click()
  await expect(page.getByText(/source is temporarily unavailable/i)).toBeVisible()
  await expect(page.locator('.earthquake-history-list li')).toHaveCount(0)
})

test('stale history visibly flags its freshness instead of showing it as current',async({page})=>{
  await bootstrap(page,'en',{stale:true})
  await page.getByRole('button',{name:'Browse history'}).click()
  await expect(page.getByText(/may be outdated/i)).toBeVisible()
})
