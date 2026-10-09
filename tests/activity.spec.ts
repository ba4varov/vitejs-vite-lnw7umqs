import {test,expect} from '@playwright/test'
import {setup} from './admin-fixture'
import {navigate} from './admin-navigation'
for (const width of [390,768,1440]) for (const lang of ['bg','en'] as const) for (const dark of [false,true]) {
 test(`activity ${width} ${lang} ${dark?'dark':'light'}`,async({page})=>{
  await page.setViewportSize({width,height:1000});await setup(page)
  await page.addInitScript(({lang,dark})=>{localStorage.setItem('meteoPulseLanguage',lang);localStorage.setItem('meteo-admin-theme',dark?'dark':'light')},{lang,dark})
  await page.route('**/api/activity',r=>r.fulfill({json:{enabled:false,revision:null}}))
  await page.route('**/api/admin?**',r=>{
   const q=new URL(r.request().url()).searchParams
   if(q.get('action')!=='activity')return r.fallback()
   const period=Number(q.get('period')||30)
   return r.fulfill({json:{period,timezone:'UTC',consenting:12,dau:3,wau:7,mau:10,hasData:true,actions:{forecast_view:42,search_complete:15,chat_use:9,favorite_add:6,favorite_remove:2},days:Array.from({length:period},(_,i)=>({date:new Date(Date.UTC(2026,9,8-period+1+i)).toISOString().slice(0,10),count:i%5}))}})
  })
  await page.goto('/admin')
  await navigate(page,lang==='bg'?'Потребителска активност':'User activity')
  await expect(page.locator('.admin-activity .admin-chart-day')).toHaveCount(30)
  await page.getByLabel(lang==='bg'?'Период':'Period',{exact:true}).selectOption('90')
  await expect(page.locator('.admin-activity .admin-chart-day')).toHaveCount(90)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`docs/activity-screenshots/activity-${width}-${lang}-${dark?'dark':'light'}.png`,fullPage:true})
  await page.getByLabel(lang==='bg'?'Период':'Period',{exact:true}).selectOption('7')
  await expect(page.locator('.admin-activity .admin-chart-day')).toHaveCount(7)
 })
}
test('missing migration and empty measurements preserve existing dashboard with explicit explanation',async({page})=>{
 await setup(page);await page.route('**/api/activity',r=>r.fulfill({status:503,json:{error:'ACTIVITY_UNAVAILABLE'}}))
 await page.route('**/api/admin?**',r=>new URL(r.request().url()).searchParams.get('action')==='activity'?r.fulfill({status:503,json:{error:'ADMIN_CONFIGURATION_MISSING'}}):r.fallback())
 await page.goto('/admin');await expect(page.locator('.admin-activity')).toContainText('миграцията')
 await expect(page.locator('.admin-stats').first()).toContainText('Регистрирани потребители')
 await page.route('**/api/admin?**',r=>new URL(r.request().url()).searchParams.get('action')==='activity'?r.fulfill({json:{hasData:false,consenting:0,dau:0,wau:0,mau:0,days:[],actions:{}}}):r.fallback())
 await page.locator('.admin-activity').getByRole('button',{name:'Опитай отново'}).click()
 await expect(page.locator('.admin-activity')).toContainText('няма измерена активност')
 await expect(page.locator('.admin-activity .admin-stats')).toHaveCount(0)
})

async function site(page:any,enabled=false) {
 await setup(page)
 let consent={enabled,revision:'60000000-0000-0000-0000-000000000001'}, events:any[]=[], fail=false
 await page.route('**/api/profile',r=>r.fulfill({json:{name:'Isolated test',email:'isolated@example.invalid',plan:'free'}}))
 await page.route('**/api/activity',async(r:any)=>{
  const method=r.request().method()
  if(method==='PATCH'){consent={enabled:r.request().postDataJSON().enabled,revision:'60000000-0000-0000-0000-000000000002'};if(!consent.enabled)events.length=0;return r.fulfill({json:consent})}
  if(method==='POST'){events.push(r.request().postDataJSON());return r.fulfill({status:fail?503:200,json:{recorded:!fail}})}
  return r.fulfill({json:consent})
 })
 await page.route('https://auth.example.invalid/rest/v1/**',(r:any)=>{
  if(r.request().method()==='POST'){
   const b=r.request().postDataJSON();return r.fulfill({json:[{id:'isolated-place',...b}]})
  }
  return r.fulfill({json:[]})
 })
 await page.route('**/*',(r:any)=>{
  const url=new URL(r.request().url())
  if(url.hostname==='127.0.0.1' || url.hostname==='auth.example.invalid')return r.fallback()
  if(url.hostname==='api.open-meteo.com')return r.fallback()
  if(url.hostname==='geocoding-api.open-meteo.com')return r.fulfill({json:{results:[{id:727011,name:'София',country:'България',country_code:'BG',latitude:42.6977,longitude:23.3219}]}})
  return r.fulfill({json:{}})
 })
 const time=Array.from({length:48},(_,i)=>new Date(Date.UTC(2026,9,8,0+i)).toISOString().slice(0,16))
 const hourly:any={time};for(const key of ['temperature_2m','apparent_temperature','weather_code','precipitation','precipitation_probability','wind_speed_10m','surface_pressure','relative_humidity_2m','visibility','dew_point_2m','cloud_cover'])hourly[key]=time.map(()=>key==='weather_code'?0:20)
 const daily:any={time:['2026-10-08','2026-10-09']};for(const key of ['temperature_2m_min','temperature_2m_max','weather_code','precipitation_sum','precipitation_probability_max','wind_speed_10m_max','uv_index_max','apparent_temperature_max'])daily[key]=[20,20]
 daily.sunrise=['2026-10-08T07:00','2026-10-09T07:00'];daily.sunset=['2026-10-08T19:00','2026-10-09T19:00']
 await page.route('https://api.open-meteo.com/**',(r:any)=>r.fulfill({json:{current:{time:'2026-10-08T10:00',weather_code:0,temperature_2m:20,relative_humidity_2m:50,wind_speed_10m:5,apparent_temperature:20,surface_pressure:1010,uv_index:2},hourly,daily}}))
 await page.route('**/api/weather-advice',(r:any)=>r.fulfill({json:{advice:'Изолирана тестова прогноза'}}))
 await page.route('**/api/weather-chat',(r:any)=>r.fulfill({json:{answer:'Изолиран тестов отговор'}}))
 return {events,setFailure:()=>{fail=true}}
}
for(const width of [390,768,1440]) for(const lang of ['bg','en'] as const) for(const dark of [false,true]) {
 test(`consent profile ${width} ${lang} ${dark?'dark':'light'}`,async({page})=>{
  await page.setViewportSize({width,height:1000});const fixture=await site(page)
  await page.goto('/');await page.getByRole('button',{name:'Моят профил',exact:true}).click()
  if(lang==='en'){await page.getByRole('button',{name:'Затвори',exact:true}).click();await page.locator('button.lang-btn').click();await page.getByRole('button',{name:'My profile',exact:true}).click()}
  if(dark){await page.getByRole('button',{name:lang==='bg'?'Затвори':'Close',exact:true}).click();await page.getByRole('button',{name:'🌙',exact:true}).click();await page.getByRole('button',{name:lang==='bg'?'Моят профил':'My profile',exact:true}).click()}
  const checkbox=page.locator('.activity-consent input')
  await expect(checkbox).toBeEnabled();await expect(checkbox).not.toBeChecked();expect(fixture.events).toHaveLength(0)
  await page.screenshot({path:`docs/activity-screenshots/consent-${width}-${lang}-${dark?'dark':'light'}.png`,fullPage:false})
  await checkbox.check();await expect(checkbox).toBeEnabled();await expect(checkbox).toBeChecked()
  await checkbox.uncheck();await expect(checkbox).toBeEnabled();await expect(checkbox).not.toBeChecked();expect(fixture.events).toHaveLength(0)
 })
}
test('actual feature use; auto refresh excluded; analytics failure does not block chat or favorites',async({page})=>{
 const fixture=await site(page,true)
 await page.clock.install({time:new Date('2026-10-08T10:00:00Z')})
 await page.goto('/');await expect(page.locator('.weather-forecast-view')).toBeVisible()
 await page.locator('.weather-forecast-view').scrollIntoViewIfNeeded()
 await expect.poll(()=>fixture.events.filter(e=>e.action==='forecast_view').length).toBe(1)
 await page.clock.fastForward(15*60*1000+1000)
 await expect(page.locator('.weather-forecast-view')).toBeVisible()
 expect(fixture.events.filter(e=>e.action==='forecast_view')).toHaveLength(1)
 const search=page.getByRole('searchbox')
 await search.fill('Со');await page.clock.runFor(400)
 expect(fixture.events.filter(e=>e.action==='search_complete')).toHaveLength(0)
 await search.press('Enter')
 await expect.poll(()=>fixture.events.filter(e=>e.action==='search_complete').length).toBe(1)
 await page.locator('.weather-forecast-view').scrollIntoViewIfNeeded()
 await expect.poll(()=>fixture.events.filter(e=>e.action==='forecast_view').length).toBe(2)
 fixture.setFailure()
 await page.locator('.chat-suggestions button').first().click()
 await expect(page.locator('.chat-messages')).toContainText('Изолиран тестов отговор')
 await expect.poll(()=>fixture.events.filter(e=>e.action==='chat_use').length).toBe(1)
 await page.locator('.star-btn').click();await expect(page.locator('.star-btn')).toHaveText('⭐')
 await expect.poll(()=>fixture.events.filter(e=>e.action==='favorite_add').length).toBe(1)
 await page.locator('.star-btn').click();await expect(page.locator('.star-btn')).toHaveText('☆')
 await expect.poll(()=>fixture.events.filter(e=>e.action==='favorite_remove').length).toBe(1)
 for(const event of fixture.events)expect(Object.keys(event).sort()).toEqual(['action','operationId','revision'])
})

test('guests use forecasts and chatbot without any activity request',async({page})=>{
 const fixture=await site(page,true)
 await page.addInitScript(()=>localStorage.removeItem('meteo-pulse-auth'))
 const requests:string[]=[];page.on('request',r=>{if(r.url().endsWith('/api/activity'))requests.push(r.method())})
 await page.goto('/');await expect(page.locator('.weather-forecast-view')).toBeVisible()
 await page.locator('.chat-suggestions button').first().click()
 await expect(page.locator('.chat-messages')).toContainText('Изолиран тестов отговор')
 expect(fixture.events).toHaveLength(0);expect(requests).toHaveLength(0)
})
