import {test,expect} from '@playwright/test'
import {calculatePlanner} from '../server/planner-logic.js'

async function fixture(page:any, plan='pro') {
  await page.clock.install({time:new Date('2026-10-09T00:00:00Z')})
  if(plan!=='guest') await page.addInitScript(()=>localStorage.setItem('meteo-pulse-auth',JSON.stringify({access_token:'isolated-token',refresh_token:'isolated-refresh',expires_at:1791543600,user:{id:'00000000-0000-0000-0000-000000000002',email:'planner@example.invalid'}})))
  await page.route('**/*',(r:any)=>new URL(r.request().url()).hostname==='127.0.0.1'?r.fallback():r.fulfill({json:{}}))
  await page.route('**/api/profile',async(r:any)=>{await new Promise(resolve=>setTimeout(resolve,150));return r.fulfill({json:{name:'Isolated planner',plan,permissions:plan==='pro'?['planner:advanced']:[]}})})
  await page.route('**/api/activity',(r:any)=>r.fulfill({json:{enabled:false}}))
  await page.route('**/api/weather-advice',(r:any)=>r.fulfill({json:{advice:'Isolated forecast'}}))
  await page.route('**/api/weather-chat',(r:any)=>r.fulfill({json:{answer:'Isolated Bobby response'}}))
  const time=Array.from({length:96},(_,i)=>new Date(Date.UTC(2026,9,9,3+i)).toISOString().slice(0,16)),hourly:any={time}
  for(const key of ['temperature_2m','apparent_temperature','weather_code','precipitation','precipitation_probability','wind_speed_10m','surface_pressure','relative_humidity_2m','visibility','dew_point_2m','cloud_cover']) hourly[key]=time.map(()=>key==='weather_code'||key==='precipitation'?0:key==='wind_speed_10m'?5:key==='precipitation_probability'?10:20)
  const daily:any={time:['2026-10-09','2026-10-10','2026-10-11']}
  for(const key of ['temperature_2m_min','temperature_2m_max','weather_code','precipitation_sum','precipitation_probability_max','wind_speed_10m_max','uv_index_max','apparent_temperature_max']) daily[key]=daily.time.map(()=>key==='weather_code'?0:20)
  daily.sunrise=daily.time.map((d:string)=>d+'T07:00');daily.sunset=daily.time.map((d:string)=>d+'T19:00')
  await page.route('https://api.open-meteo.com/**',(r:any)=>r.fulfill({json:{timezone:'Europe/Sofia',current:{time:'2026-10-09T03:00',weather_code:0,temperature_2m:20,relative_humidity_2m:50,wind_speed_10m:5,apparent_temperature:20,surface_pressure:1010,uv_index:2},hourly,daily}}))
  let status=200;const calls:any[]=[]
  await page.route('**/api/planner',(r:any)=>{
    const input=r.request().postDataJSON();calls.push(input)
    return r.fulfill({status,json:status===200?calculatePlanner(input,Date.parse('2026-10-09T00:00:00Z')):{error:'TEST_FAILURE'}})
  })
  return {calls,setStatus:(value:number)=>{status=value}}
}
for(const plan of ['guest','free','pro']) for(const width of [390,768,1440]) for(const lang of ['bg','en']) for(const dark of [false,true]) {
  test(`planner ${plan} ${width} ${lang} ${dark?'dark':'light'}`,async({page})=>{
    await page.setViewportSize({width,height:1000});const state=await fixture(page,plan)
    await page.goto('/');await expect(page.locator('.weather-forecast-view')).toBeVisible()
    if(lang==='en')await page.locator('button.lang-btn').click()
    if(dark)await page.getByRole('button',{name:'🌙',exact:true}).click()
    const planner=page.locator('.weather-planner')
    await expect(planner).toContainText(lang==='bg'?'Моят метео планер':'My Weather Planner')
    if(plan==='pro'){
      await expect(planner.locator('select')).toBeVisible()
      await planner.getByRole('button').click();await expect(planner.locator('li')).toHaveCount(3)
      await expect(planner).toContainText('Europe/Sofia')
      expect(state.calls).toHaveLength(1);expect(state.calls[0].hours).toHaveLength(72)
    } else {await expect(planner.locator('select')).toHaveCount(0);expect(state.calls).toHaveLength(0)}
    await planner.locator('summary').click();await planner.scrollIntoViewIfNeeded()
    expect(await planner.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
    await planner.screenshot({path:`docs/planner-screenshots/${plan}-${width}-${lang}-${dark?'dark':'light'}.png`})
  })
}
test('failed calculation clears old result; explicit retry succeeds; same session downgrade denies',async({page})=>{
  const state=await fixture(page)
  await page.goto('/');const planner=page.locator('.weather-planner');await expect(planner.locator('select')).toBeVisible()
  await planner.getByRole('button').click();await expect(planner.locator('li')).toHaveCount(3)
  await planner.locator('select').selectOption('sport');await expect(planner.locator('li')).toHaveCount(0)
  state.setStatus(503);await planner.getByRole('button').click();await expect(planner.getByRole('alert')).toBeVisible();await expect(planner.locator('li')).toHaveCount(0)
  state.setStatus(200);await planner.getByRole('button').click();await expect(planner.locator('li')).toHaveCount(3)
  state.setStatus(403);await planner.getByRole('button').click();await expect(planner.locator('select')).toHaveCount(0);await expect(planner.locator('li')).toHaveCount(0)
  await expect(page.locator('.weather-forecast-view')).toBeVisible()
  await page.locator('.chat-suggestions button').first().click();await expect(page.locator('.chat-messages')).toContainText('Isolated Bobby response')
})
test('guest invitation opens existing sign-in',async({page})=>{
  await fixture(page,'guest');await page.goto('/');await page.locator('.weather-planner a').click();await expect(page.getByRole('dialog')).toBeVisible()
})
test('missing data, unsuitable forecast and expired server session are clear',async({page})=>{
  await fixture(page);await page.goto('/');const planner=page.locator('.weather-planner')
  await expect(planner.locator('select')).toBeVisible()
  for(const status of ['insufficient','unsuitable']) {
    await page.route('**/api/planner',r=>r.fulfill({json:{status,timeZone:'Europe/Sofia',windows:[]}}))
    await planner.getByRole('button').click();await expect(planner).toContainText(status==='insufficient'?'Няма достатъчно':'Не намерихме подходящ')
    await expect(planner.locator('li')).toHaveCount(0)
  }
  await page.route('**/api/planner',r=>r.fulfill({status:401,json:{error:'INVALID_SESSION'}}))
  await planner.getByRole('button').click();await expect(planner.locator('select')).toHaveCount(0);await expect(planner.locator('a')).toBeVisible()
})
test('logout discards a late calculation and leaves Free weather available',async({page})=>{
  await fixture(page);await page.goto('/');const planner=page.locator('.weather-planner')
  await expect(planner.locator('select')).toBeVisible()
  let release:()=>void
  const pending=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/api/planner',async r=>{await pending;await r.fulfill({json:{status:'ok',timeZone:'Europe/Sofia',windows:[{start:1791518400000,end:1791525600000,feelsLikeMin:20,feelsLikeMax:20,rainProbability:10,rain:0,wind:5}]}}).catch(()=>{})})
  await planner.getByRole('button').click();await page.locator('.auth-nav').getByRole('button',{name:'Изход',exact:true}).click();release!()
  await expect(planner.locator('select')).toHaveCount(0);await expect(planner.locator('li')).toHaveCount(0);await expect(page.locator('.weather-forecast-view')).toBeVisible()
})
