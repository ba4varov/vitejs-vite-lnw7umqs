import {test,expect} from '@playwright/test'
import {calculatePlanner} from '../server/planner-logic.js'
import {forecastRisks} from '../server/alerts-logic.js'
async function fixture(page:any, plan='pro') {
  await page.clock.install({time:new Date('2026-10-09T00:00:00Z')})
  if(plan!=='guest') await page.addInitScript(()=>localStorage.setItem('meteo-pulse-auth',JSON.stringify({access_token:'isolated-token',refresh_token:'isolated-refresh',expires_at:1791543600,user:{id:'00000000-0000-0000-0000-000000000002',email:'planner@example.invalid'}})))
  await page.route('**/*',(r:any)=>new URL(r.request().url()).hostname==='127.0.0.1'?r.fallback():r.fulfill({json:{}}))
  await page.route('**/api/profile',async(r:any)=>{await new Promise(resolve=>setTimeout(resolve,150));return r.fulfill({json:{name:'Isolated planner',plan,permissions:plan==='pro'?['planner:advanced']:[]}})})
  await page.route('**/api/activity',(r:any)=>r.fulfill({json:{enabled:false}}))
  await page.route('**/api/weather-advice',(r:any)=>r.fulfill({json:{advice:'Isolated forecast'}}))
  await page.route('**/api/weather-chat',(r:any)=>r.fulfill({json:{answer:'Isolated Bobby response'}}))
  const time=Array.from({length:96},(_,i)=>new Date(Date.UTC(2026,9,9,3+i)).toISOString().slice(0,16)),hourly:any={time}
  for(const key of ['temperature_2m','apparent_temperature','weather_code','precipitation','precipitation_probability','wind_speed_10m','surface_pressure','relative_humidity_2m','visibility','dew_point_2m','cloud_cover']) hourly[key]=time.map((_:any,i:number)=>key==='weather_code'||key==='precipitation'?0:key==='wind_speed_10m'?(i<2?65:5):key==='precipitation_probability'?10:20)
  const daily:any={time:['2026-10-09','2026-10-10','2026-10-11']}
  for(const key of ['temperature_2m_min','temperature_2m_max','weather_code','precipitation_sum','precipitation_probability_max','wind_speed_10m_max','uv_index_max','apparent_temperature_max']) daily[key]=daily.time.map((_unused:any,_i:number)=>key==='weather_code'?0:20)
  daily.sunrise=daily.time.map((d:string)=>d+'T07:00');daily.sunset=daily.time.map((d:string)=>d+'T19:00')
  await page.route('https://api.open-meteo.com/**',(r:any)=>r.fulfill({json:{timezone:'Europe/Sofia',current:{time:'2026-10-09T03:00',weather_code:0,temperature_2m:20,relative_humidity_2m:50,wind_speed_10m:5,apparent_temperature:20,surface_pressure:1010,uv_index:2},hourly,daily}}))
  let status=200;const calls:any[]=[]
  await page.route('**/api/planner',(r:any)=>{
    const input=r.request().postDataJSON();calls.push(input)
    return r.fulfill({status,json:status===200?calculatePlanner(input,Date.parse('2026-10-09T00:00:00Z')):{error:'TEST_FAILURE'}})
  })
  return {calls,setStatus:(value:number)=>{status=value}}
}

async function alertFixture(page:any,plan:string){
 await fixture(page,plan)
 let enabled=plan==='pro'?['wind','walk']:['wind'], rows:any[]=[],pro=plan==='pro', unavailable=false
 await page.route('**/api/alerts',r=>{
  if(unavailable)return r.fulfill({status:503,json:{error:'UNAVAILABLE'}})
  const method=r.request().method(),b=method==='GET'||method==='DELETE'?{}:r.request().postDataJSON()
  if(method==='POST')for(const event of [...forecastRisks(b.forecast,Date.parse('2026-10-09T00:00Z')),...(pro&&enabled.includes('walk')?calculatePlanner({...b.forecast,activity:'walk'},Date.parse('2026-10-09T00:00Z')).windows.map((w:any)=>({kind:'walk',...w})):[])]){const key=JSON.stringify([b.locationKey,event.kind,event.start]);if(!rows.some(row=>row.key===key))rows.push({key,city:b.city,zone:b.forecast.timeZone,event,updated:Date.parse('2026-10-09T00:00Z'),read:false})}
  if(method==='DELETE')rows=[]
  if(b.readKey)rows=rows.map(row=>row.key===b.readKey?{...row,read:true}:row)
  if(b.hideKey)rows=rows.filter(row=>row.key!==b.hideKey)
  if(b.enabled)enabled=b.enabled
  return r.fulfill({json:{pro,enabled,alerts:rows.filter(row=>pro||!['walk','garden','sport'].includes(row.event.kind))}})
 })
 return {offline:()=>{unavailable=true},revoke:()=>{pro=false}}
}
for(const plan of ['guest','free','pro'])for(const width of [390,768,1440])for(const lang of ['bg','en'])for(const dark of [false,true])test(`alerts ${plan} ${width} ${lang} ${dark?'dark':'light'}`,async({page})=>{
 await page.setViewportSize({width,height:1000});await alertFixture(page,plan);await page.goto('/')
 await expect(page.locator('.weather-forecast-view')).toBeVisible()
 if(lang==='en')await page.locator('button.lang-btn').click()
 if(dark)await page.getByRole('button',{name:'🌙',exact:true}).click()
 await page.getByRole('button',{name:lang==='bg'?'Известия':'Notifications',exact:true}).click()
 const panel=page.locator('.notification-panel');await expect(panel.locator('li')).toHaveCount(plan==='pro'?4:1)
 await expect(panel).toContainText(lang==='bg'?'Ориентировъчно предупреждение по прогноза':'Indicative forecast warning')
 await expect(panel).toContainText('65');await expect(panel).toContainText('Europe/Sofia')
 expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
 await panel.screenshot({path:`docs/alerts-screenshots/${plan}-${width}-${lang}-${dark?'dark':'light'}.png`})
 await panel.getByRole('button',{name:lang==='bg'?'Прочетено':'Mark read',exact:true}).first().click();if(plan==='pro')await expect(page.locator('.notification-count')).toContainText('3');else await expect(page.locator('.notification-count')).toHaveCount(0)
 await panel.getByRole('button',{name:lang==='bg'?'Изчисти известията':'Clear notifications',exact:true}).click();await expect(panel.locator('li')).toHaveCount(0)
})
test('notification outage keeps weather and Bobby available; profile settings remain separate from analytics',async({page})=>{
 const state=await alertFixture(page,'free');state.offline();await page.goto('/');await expect(page.locator('.weather-forecast-view')).toBeVisible()
 await page.getByRole('button',{name:'Известия',exact:true}).click();await expect(page.locator('.notification-panel')).toContainText('временно са недостъпни')
 await page.locator('.chat-suggestions button').first().click();await expect(page.locator('.chat-messages')).toContainText('Isolated Bobby response')
})
test('settings saved, activities only Pro, forecast refresh does not repeat read notifications',async({page})=>{
 await alertFixture(page,'pro');await page.goto('/');await expect(page.locator('.weather-forecast-view')).toBeVisible()
 await page.locator('.auth-nav').getByRole('button',{name:'Моят профил',exact:true}).click()
 const settings=page.locator('.notification-settings');await expect(settings).toBeVisible();await expect(settings.locator('input')).toHaveCount(8)
 await settings.getByText('Време за градинарство',{exact:false}).click();await expect(settings.locator('input').nth(6)).toBeChecked()
 await page.getByRole('button',{name:'Затвори',exact:true}).click()
 await page.getByRole('button',{name:'Известия',exact:true}).click();const panel=page.locator('.notification-panel');for(const button of await panel.getByRole('button',{name:'Прочетено',exact:true}).all())await button.click()
 await page.clock.fastForward(15*60000);await expect(panel.locator('li')).toHaveCount(4);await expect(page.locator('.notification-count')).toHaveCount(0)
})

test('same active session loses Pro notifications on rights refresh and regains them',async({page})=>{
 const state=await alertFixture(page,'pro');await page.goto('/');await expect(page.locator('.weather-forecast-view')).toBeVisible()
 await page.getByRole('button',{name:'Известия',exact:true}).click();const panel=page.locator('.notification-panel');await expect(panel.locator('li')).toHaveCount(4)
 state.revoke();await page.clock.fastForward(60000);await expect(panel.locator('li')).toHaveCount(1)
})

test('late notification request after city change is discarded; guest hides survive refresh',async({page})=>{
 await alertFixture(page,'free');let release:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});let count=0
 await page.route('**/api/alerts',async r=>{
  if(r.request().method()!=='POST')return r.fallback()
  count++
  if(count===1){await pending;return r.fulfill({json:{pro:false,enabled:['wind'],alerts:[{key:'stale',city:'STALE SECRET CITY',zone:'UTC',event:{kind:'wind',start:1791504000000,end:1791511200000,min:65,max:65},updated:1791504000000,read:false}]}}).catch(()=>{})}
  return r.fallback()
 })
 await page.goto('/');await expect(page.locator('.weather-forecast-view')).toBeVisible();await page.locator('.city-row').getByRole('button',{name:'София',exact:true}).click();release!()
 await page.getByRole('button',{name:'Известия',exact:true}).click();await expect(page.locator('.notification-panel')).not.toContainText('STALE SECRET CITY');await expect(page.locator('.notification-panel')).toContainText('София')
})
test('guest read and hide state survives automatic forecast refresh without server history',async({page})=>{
 await alertFixture(page,'guest');let requests=0;await page.route('**/api/alerts',r=>{requests++;return r.fulfill({status:401,json:{}})})
 await page.goto('/');await expect(page.locator('.weather-forecast-view')).toBeVisible();await page.getByRole('button',{name:'Известия',exact:true}).click()
 const panel=page.locator('.notification-panel');await panel.getByRole('button',{name:'Скрий',exact:true}).click();await page.clock.fastForward(15*60000);await expect(panel.locator('li')).toHaveCount(0);expect(requests).toBe(0)
})
