import { clickHeaderControl } from './header-navigation'
import {test,expect} from '@playwright/test'
import {calculatePlanner} from '../server/planner-logic.js'

test.describe.configure({ mode: 'parallel' })

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
  const weather={timezone:'Europe/Sofia',current:{time:'2026-10-09T03:00',weather_code:0,temperature_2m:20,relative_humidity_2m:50,wind_speed_10m:5,apparent_temperature:20,surface_pressure:1010,uv_index:2},hourly,daily}
  await page.route('https://api.open-meteo.com/**',(r:any)=>r.fulfill({json:weather}))
  let status=200;const calls:any[]=[]
  await page.route('**/api/planner',(r:any)=>{
    const input=r.request().postDataJSON();calls.push(input)
    return r.fulfill({status,json:status===200?calculatePlanner(input,Date.parse('2026-10-09T00:00:00Z')):{error:'TEST_FAILURE'}})
  })
  return {calls,weather,setStatus:(value:number)=>{status=value}}
}
for(const plan of ['guest','free','pro']) for(const width of [320,360,390,430,640,641,768,1440]) for(const lang of ['bg','en']) for(const dark of [false,true]) {
  test(`planner ${plan} ${width} ${lang} ${dark?'dark':'light'}`,async({page})=>{
    await page.setViewportSize({width,height:1000});const state=await fixture(page,plan)
    await page.goto('/');await expect(page.locator('.weather-forecast-view')).toBeVisible()
    if(lang==='en')await clickHeaderControl(page, page.locator('button.lang-btn'))
    if(dark)await clickHeaderControl(page, page.locator('.header-menu > .icon-btn'))
    const planner=page.locator('.weather-planner')
    await expect(planner).toContainText(lang==='bg'?'Моят метео планер':'My Weather Planner')
    if(plan==='pro'){
      await expect(planner.locator('select')).toBeVisible()
      await expect(planner.locator('select option')).toHaveText(lang==='bg'?['Разходка','Работа в градината','Спорт на открито']:['Walk','Gardening','Outdoor sport'])
      if(width<=640) for(const control of [planner.locator('select'),planner.getByRole('button')]) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await planner.getByRole('button').click();await expect(planner.locator('li')).toHaveCount(3)
      await expect(planner).toContainText('Europe/Sofia')
      expect(state.calls).toHaveLength(1);expect(state.calls[0].hours).toHaveLength(72)
      const expected=calculatePlanner(state.calls[0],Date.parse('2026-10-09T00:00:00Z'))
      for(const [index,window] of expected.windows.entries()) {
        const card=planner.locator('li').nth(index)
        const time=(epoch:number)=>new Intl.DateTimeFormat(lang==='bg'?'bg-BG':'en-GB',{timeZone:expected.timeZone,day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(epoch)
        await expect(card).toContainText(`${time(window.start)} – ${time(window.end)}`)
        for(const value of [`${window.feelsLikeMin}–${window.feelsLikeMax} °C`,`${window.wind} km/h`,`${window.rain} mm (${window.rainProbability}%)`]) await expect(card).toContainText(value)
      }
    } else {await expect(planner.locator('select')).toHaveCount(0);expect(state.calls).toHaveLength(0)}
    await expect(planner.locator('details')).not.toHaveAttribute('open','')
    await expect(planner.locator('.planner-plan-grid')).toBeHidden()
    await expect(planner.locator('.planner-note')).toBeVisible()
    await planner.locator('summary').click();await planner.scrollIntoViewIfNeeded()
    expect(await planner.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
    await planner.screenshot({path:`work/planner-screenshots/${plan}-${width}-${lang}-${dark?'dark':'light'}.png`})
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
  await fixture(page,'guest');await page.goto('/');await page.locator('.planner-sign-in').click();await expect(page.getByRole('dialog')).toBeVisible()
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
  await planner.getByRole('button').click();await expect(planner.locator('select')).toHaveCount(0);await expect(planner.locator('.planner-sign-in')).toBeVisible()
})
test('logout discards a late calculation and leaves Free weather available',async({page})=>{
  await fixture(page);await page.goto('/');const planner=page.locator('.weather-planner')
  await expect(planner.locator('select')).toBeVisible()
  let release:()=>void
  const pending=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/api/planner',async r=>{await pending;await r.fulfill({json:{status:'ok',timeZone:'Europe/Sofia',windows:[{start:1791518400000,end:1791525600000,feelsLikeMin:20,feelsLikeMax:20,rainProbability:10,rain:0,wind:5}]}}).catch(()=>{})})
  await planner.getByRole('button').click();await clickHeaderControl(page, page.locator('.auth-nav').getByRole('button',{name:'Изход',exact:true}));release!()
  await expect(planner.locator('select')).toHaveCount(0);await expect(planner.locator('li')).toHaveCount(0);await expect(page.locator('.weather-forecast-view')).toBeVisible()
})

for(const width of [320,360,390,430,640,641,768,1440]) for(const lang of ['bg','en']) for(const dark of [false,true]) {
  test(`planner transient states and keyboard ${width} ${lang} ${dark}`, async({page})=>{
    await page.setViewportSize({width,height:1000})
    const state=await fixture(page)
    let release!: () => void
    const pending = new Promise<void>(resolve=>{release=resolve})
    await page.route('**/api/profile',async r=>{await pending;await r.fulfill({status:503,json:{error:'TEST'}})})
    await page.goto('/')
    if(lang==='en')await clickHeaderControl(page,page.locator('button.lang-btn'))
    if(dark)await clickHeaderControl(page,page.locator('.header-menu > .icon-btn'))
    const planner=page.locator('.weather-planner')
    await expect(planner.getByRole('status')).toBeVisible()
    await expect(planner.locator('select')).toHaveCount(0)
    release()
    await expect(planner.getByRole('alert')).toBeVisible()
    expect(await planner.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
    await planner.locator('summary').focus();await page.keyboard.press('Enter')
    await expect(planner.locator('.planner-plan-grid')).toBeVisible()
    await page.keyboard.press('Space');await expect(planner.locator('.planner-plan-grid')).toBeHidden()

    await page.unroute('**/api/profile')
    await page.route('**/api/profile',r=>r.fulfill({json:{plan:'pro',permissions:['planner:advanced']}}))
    await page.reload()
    await expect(planner.locator('select')).toBeVisible()
    let finish!: () => void
    const calculation=new Promise<void>(resolve=>{finish=resolve})
    await page.route('**/api/planner',async r=>{await calculation;await r.fulfill({status:503,json:{error:'TEST'}})})
    await planner.getByRole('button').focus();await page.keyboard.press('Enter')
    await expect(planner.getByRole('button')).toBeDisabled()
    await expect(planner.getByRole('button')).toHaveText(lang==='bg'?'Изчисляване…':'Calculating…')
    await expect(planner.locator('.planner-note')).toBeVisible()
    finish();await expect(planner.getByRole('alert')).toBeVisible()
    expect(await planner.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)

    await page.route('https://api.open-meteo.com/**',r=>r.fulfill({json:{...state.weather,timezone:undefined}}))
    await page.reload();await expect(planner.locator('select')).toBeVisible()
    await expect(planner.getByRole('button')).toBeDisabled()
    await expect(planner).toContainText(lang==='bg'?'Почасовите данни':'Hourly data')
  })
  test(`planner guest login with closed menu ${width} ${lang} ${dark}`,async({page})=>{
    await page.setViewportSize({width,height:1000});await fixture(page,'guest');await page.goto('/')
    if(lang==='en')await clickHeaderControl(page,page.locator('button.lang-btn'))
    if(dark)await clickHeaderControl(page,page.locator('.header-menu > .icon-btn'))
    if(width<=640 && await page.locator('.mobile-menu-toggle').getAttribute('aria-expanded')==='true')await page.locator('.mobile-menu-toggle').click()
    const trigger=page.locator('.planner-sign-in')
    await trigger.focus();await page.keyboard.press('Enter')
    const dialog=page.getByRole('dialog')
    await expect(dialog).toBeVisible();await expect(dialog).toBeFocused()
    await expect(dialog.getByRole('heading',{name:lang==='bg'?'Вход':'Sign in',exact:true})).toBeVisible()
    await page.keyboard.press('Tab');expect(await dialog.evaluate(e=>e.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused()
    expect(await page.locator('.weather-planner').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
  })
}

for(const width of [320,640]) for(const lang of ['bg','en']) for(const dark of [false,true]) for(const plan of ['guest','free','pro']) {
  test(`compact initial view and contrast ${width} ${lang} ${dark} ${plan}`,async({page})=>{
    await page.setViewportSize({width,height:1000});const state=await fixture(page,plan);await page.goto('/')
    if(lang==='en')await clickHeaderControl(page,page.locator('button.lang-btn'))
    if(dark)await clickHeaderControl(page,page.locator('.header-menu > .icon-btn'))
    const planner=page.locator('.weather-planner')
    if(plan==='pro') {
      await expect(planner.locator('select')).toBeVisible()
      for(const activity of ['walk','garden','sport']) {
        await planner.locator('select').selectOption(activity)
        await planner.getByRole('button').click();await expect(planner.locator('li')).toHaveCount(3)
        expect(state.calls.at(-1).activity).toBe(activity)
      }
    } else await expect(planner.locator('select')).toHaveCount(0)
    await expect(planner.locator('.planner-plan-grid')).toBeHidden()
    const contrast=await planner.locator('.planner-note, .planner-sign-in, summary, li strong, .planner-metrics > span:not(.planner-separator), .planner-controls button, .planner-controls select').evaluateAll(elements=>elements.map(element=>{
      const luminance=(color:string)=>{
        const rgb=(color.match(/[\d.]+/g)||[]).slice(0,3).map(v=>Number(v)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
        return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722
      }
      let node:Element|null=element,background='rgb(255,255,255)'
      while(node) {const color=getComputedStyle(node).backgroundColor;if(color!=='rgba(0, 0, 0, 0)' && color!=='transparent'){background=color;break}node=node.parentElement}
      const fg=luminance(getComputedStyle(element).color),bg=luminance(background)
      return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)
    }))
    for(const ratio of contrast)expect(ratio).toBeGreaterThanOrEqual(4.5)
    expect(await planner.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
    expect(await planner.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth})).toBe(true)
    await planner.screenshot({path:`work/planner-screenshots/initial-${plan}-${width}-${lang}-${dark?'dark':'light'}.png`})
  })
}
