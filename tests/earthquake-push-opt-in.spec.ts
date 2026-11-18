import {test,expect,type Page} from '@playwright/test'
import {weather} from './forecast-order-fixture'
import {clickHeaderControl} from './header-navigation'

async function boot(page:Page,lang:'bg'|'en',options:{migrationMissing?:boolean}={}){
  await page.addInitScript(lang=>{
    localStorage.setItem('meteoPulseLanguage',lang)
    localStorage.setItem('meteo-pulse-auth',JSON.stringify({
      access_token:'push-earthquake-test-token',refresh_token:'push-earthquake-refresh',
      expires_at:Math.floor(Date.now()/1000)+3600,
      user:{id:'00000000-0000-4000-8000-000000000002',email:'quake-test@example.invalid'}
    }))
    ;(window as any).quakeNotificationPrompts=0
    Notification.requestPermission=()=>{
      ;(window as any).quakeNotificationPrompts++
      return Promise.resolve('granted')
    }
  },lang)
  const requested:{method:string;body:any;url:string}[]=[]
  let prefs={enabled:false,cities:[] as any[],categories:[] as string[]}
  let consent={contractVersion:1,enabled:false,city:null as any,optedInAt:null as string|null,
    radiusKm:300,minMagnitude:3,deviceCount:0,deliveryEnabled:false}
  const origin='http://127.0.0.1:4173'
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url())
    if(u.pathname==='/api/push'&&u.searchParams.get('channel')==='earthquakes'){
      const method=route.request().method()
      const body=method==='PUT'?route.request().postDataJSON():null
      requested.push({method,body,url:u.href})
      if(options.migrationMissing)
        return route.fulfill({status:503,json:{error:'EARTHQUAKE_CONSENT_UNAVAILABLE',deliveryEnabled:false}})
      if(method==='PUT'){
        if(body.enabled){
          consent={...consent,enabled:true,city:prefs.cities[body.cityIndex],
            optedInAt:'2026-11-18T09:45:00Z'}
        } else consent={...consent,enabled:false,city:null,optedInAt:null}
      }
      return route.fulfill({json:consent})
    }
    if(u.pathname==='/api/push'){
      if(route.request().method()==='PATCH')prefs=route.request().postDataJSON()
      return route.fulfill({json:{
        contractVersion:1,pro:false,preferences:prefs,
        devices:[],registrationEnabled:false,publicKey:null,deliveryEnabled:false
      }})
    }
    if(u.pathname==='/api/profile')return route.fulfill({json:{
      name:'Earthquake test',plan:'free',permissions:[]
    }})
    if(u.pathname==='/api/activity')return route.fulfill({json:{enabled:false}})
    if(u.pathname==='/api/alerts')return route.fulfill({json:{
      contractVersion:2,pro:false,enabled:[],alerts:[],status:'ready',
      source:'USGS',events:[],checkedAt:Date.now()
    }})
    if(u.hostname==='api.open-meteo.com')return route.fulfill({json:weather})
    if(u.origin===origin&&!u.pathname.startsWith('/api/'))return route.continue()
    return route.fulfill({json:{}})
  })
  await page.goto('/')
  await clickHeaderControl(page,page.locator('.auth-nav').getByRole('button',{
    name:lang==='bg'?'Моят профил':'My profile',exact:true
  }))
  await page.getByRole('tab',{name:lang==='bg'?'Push известия':'Push notifications'}).click()
  const section=page.locator('.earthquake-optin')
  await expect(section).toBeVisible()
  return {requested,section,weatherPrefs:()=>prefs}
}

for(const [width,lang] of [[390,'bg'],[1440,'en']] as const) {
  test(`quake consent setup ${width}px ${lang}: explicit opt-in, fixed 300 km, opt-out`,
    async({page},testInfo)=>{
      await page.setViewportSize({width,height:920})
      const state=await boot(page,lang)
      const section=state.section
      const optin=section.getByRole('checkbox')
      await expect(section).toContainText(lang==='bg'?'300 км':'300 km')
      await expect(section).toContainText('M 3.0')
      await expect(section).toContainText(lang==='bg'?'ИЗКЛЮЧЕНА':'DISABLED')
      await expect(optin).toBeDisabled()
      expect(state.requested.map(x=>x.method)).toEqual(['GET'])
      const push=page.locator('.push-settings')
      await push.getByRole('button',{name:lang==='bg'?'Добави София':'Add София',exact:true}).click()
      await push.getByLabel(lang==='bg'?'Силен вятър':'Strong wind',{exact:true}).check()
      await push.getByLabel(lang==='bg'?'Следи избраните градове и категории':
        'Monitor selected cities and categories').check()
      await push.getByRole('button',{name:lang==='bg'?'Запази push настройките':'Save push preferences'}).click()
      await expect(optin).toBeEnabled()
      await optin.check()
      await expect(section.getByRole('combobox')).toHaveValue('0')
      await expect(page.locator('.profile-draft-note')).toBeVisible()
      // Unsaved earthquake changes must prevent accidental profile closure.
      page.once('dialog',async dialog=>{expect(dialog.type()).toBe('confirm');await dialog.dismiss()})
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeVisible()
      await section.getByRole('button',{name:lang==='bg'?'Запази съгласието':'Save consent'}).click()
      await expect(section).toContainText(lang==='bg'?'Съгласието е запазено':'Consent saved')
      await expect(page.locator('.profile-draft-note')).toHaveCount(0)
      expect(state.requested.filter(x=>x.method==='PUT').map(x=>x.body))
        .toEqual([{enabled:true,cityIndex:0}])
      expect(state.requested.every(x=>new URL(x.url).searchParams.size===1)).toBe(true)
      expect(await page.evaluate(()=>(window as any).quakeNotificationPrompts)).toBe(0)
      await optin.uncheck()
      await section.getByRole('button',{name:lang==='bg'?'Запази съгласието':'Save consent'}).click()
      await expect(section).toContainText(lang==='bg'?'оттеглено':'withdrawn')
      expect(state.requested.filter(x=>x.method==='PUT').map(x=>x.body))
        .toEqual([{enabled:true,cityIndex:0},{enabled:false}])
      await section.screenshot({path:testInfo.outputPath(`quake-consent-${width}-${lang}.png`),
        animations:'disabled'})
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    })
}

test('missing database migration fails closed: no consent persisted or Push sent',async({page})=>{
  await page.setViewportSize({width:390,height:850})
  const {requested,section}=await boot(page,'bg',{migrationMissing:true})
  await expect(section).toContainText('Настройките не могат да бъдат проверени')
  await expect(section.getByRole('checkbox')).toHaveCount(0)
  expect(requested.map(x=>x.method)).toEqual(['GET'])
  expect(await page.evaluate(()=>(window as any).quakeNotificationPrompts)).toBe(0)
})
