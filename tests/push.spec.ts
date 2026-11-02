import { clickHeaderControl } from './header-navigation'
import {test,expect} from '@playwright/test'
const publicKey=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url')
const preferences={enabled:false,cities:[],categories:[]}
async function setup(page:any,{permission='granted',registrationEnabled=true,pro=false,failure=false,missingMigration=false,diagnostic=false,publicKeyAvailable=true,sessionDiagnostic=false}:{permission?:string;registrationEnabled?:boolean;pro?:boolean;failure?:boolean;missingMigration?:boolean;diagnostic?:boolean;publicKeyAvailable?:boolean;sessionDiagnostic?:boolean}={}) {
 await page.addInitScript(({permission,publicKey,sessionDiagnostic}:any)=>{
  localStorage.setItem('meteo-pulse-auth',JSON.stringify({access_token:'isolated-token',refresh_token:'isolated-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'00000000-0000-0000-0000-000000000002',email:'push@example.invalid'}}))
  const scope:any=window;scope.localNotifications=0;scope.pushPrompts=0;scope.pushUnsubscribes=0;scope.pushSubscribes=0
  let permissionValue='default',subscription:any=null
  scope.setTestPushPermission=(value:string)=>{permissionValue=value}
  scope.stalePushSubscription=()=>{subscription={options:{applicationServerKey:new Uint8Array(65).buffer},unsubscribe:async()=>{scope.pushUnsubscribes++;return true}}}
  scope.diagnosticSubscription=(kind:string)=>{scope.diagnosticWorkerMissing=kind==='worker';subscription=kind==='missing'?null:{endpoint:kind==='device'?'https://fcm.googleapis.com/wp/other':'https://fcm.googleapis.com/wp/isolated',options:{applicationServerKey:kind==='vapid'?new Uint8Array(65).buffer:Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)).buffer},getKey:(name:string)=>name==='p256dh'?Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)).buffer:new Uint8Array(16).fill(1).buffer,unsubscribe:()=>{throw Error('Unexpected unsubscribe')},toJSON:()=>{throw Error('Unexpected serialization')}}}
  Object.defineProperty(navigator.serviceWorker,'getRegistration',{configurable:true,value:async()=>(scope.renewalRegistration||(scope.diagnosticWorkerMissing?undefined:{scope:location.origin+'/',active:{scriptURL:location.origin+'/push-sw.js'},showNotification:async()=>{scope.localNotifications++},pushManager:{getSubscription:async()=>subscription}}))})
  Object.defineProperty(Notification,'permission',{get:()=>permissionValue})
  Notification.requestPermission=()=>{scope.pushPrompts++;permissionValue=permission;return Promise.resolve(permission as NotificationPermission)}
  Object.defineProperty(navigator.serviceWorker,'register',{value:async()=>({pushManager:{
   getSubscription:async()=>subscription,
   subscribe:async()=>{scope.pushSubscribes++;subscription={options:{applicationServerKey:Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)).buffer},endpoint:'https://fcm.googleapis.com/wp/isolated',toJSON:()=>({endpoint:'https://fcm.googleapis.com/wp/isolated',expirationTime:null,keys:{p256dh:publicKey,auth:'AQEBAQEBAQEBAQEBAQEBAQ'}}),unsubscribe:async()=>{scope.pushUnsubscribes++;subscription=null;return true}};return subscription},
  }})})
  if(sessionDiagnostic){permissionValue='granted';scope.diagnosticSubscription('match')}
 },{permission,publicKey,sessionDiagnostic})
 const origin=new URL(process.env.PUSH_PREVIEW_URL||'http://127.0.0.1:4173').origin
 // Even hosted Preview checks only fetch static assets. All account APIs are fixtures.
 await page.route('**/*',(r:any)=>new URL(r.request().url()).origin===origin?(new URL(r.request().url()).pathname.startsWith('/api/')?r.fulfill({status:503,json:{error:'ISOLATED_TEST'}}):r.fallback()):r.fulfill({json:{}}))
 await page.route('**/api/profile',(r:any)=>r.fulfill({json:{name:'Push Test',plan:pro?'pro':'free',permissions:pro?['planner:advanced']:[]}}))
 await page.route('**/api/activity',(r:any)=>r.fulfill({json:{enabled:false}}))
 await page.route('**/api/alerts',(r:any)=>r.fulfill({json:{contractVersion:2,pro,enabled:[],alerts:[]}}))
 const hash=await import('node:crypto').then(c=>c.createHash('sha256').update('https://fcm.googleapis.com/wp/isolated').digest('hex'))
 const sessionCalls:any[]=[]
 await page.route('**/api/push-operator',async(r:any)=>{
  const body=r.request().postDataJSON();sessionCalls.push(body)
  const result=body.operation==='access'?{code:'rights:allowed',allowed:sessionDiagnostic,target:sessionDiagnostic?{deviceId:'b1000000-0000-0000-0000-000000000001',label:'Desktop Chrome synthetic'}:null}:body.operation==='prepare'?{code:'device:ready',permitId:'b0000000-0000-0000-0000-000000000002',expiresAt:new Date(Date.now()+120000).toISOString()}:body.operation==='cancel'?{code:'device:closed'}:{code:'fcm:accepted',diagnostic:{category:'accepted',providerStatus:201}}
  return r.fulfill({json:{...result,deliveryEnabled:false,phoneDelivery:'unconfirmed'}})
 })
 if(sessionDiagnostic)await page.route('**/api/push-key-diagnostics',r=>r.fulfill({json:{keys:{p256dh:'match',auth:'match'}}}))
 const calls:any[]=[];let prefs:any={...preferences},devices:any[]=diagnostic?[{id:sessionDiagnostic?'b1000000-0000-0000-0000-000000000001':'00000000-0000-0000-0000-000000000003',label:sessionDiagnostic?'Desktop Chrome synthetic':'Note 13 Pro',fingerprint:hash,createdAt:'2026-10-14T00:00:00Z'}]:[]
 await page.route('**/api/push',async(r:any)=>{
  const method=r.request().method(),body=r.request().postDataJSON();calls.push({method,body})
  if(missingMigration)return r.fulfill({status:503,json:{error:'PUSH_UNAVAILABLE'}})
  if(method==='PATCH')prefs=body
  if(method==='POST') {
   if(failure)return r.fulfill({status:503,json:{error:'PUSH_UNAVAILABLE'}})
   const hash=await import('node:crypto').then(c=>c.createHash('sha256').update(body.subscription.endpoint).digest('hex'))
   devices=[{id:'00000000-0000-0000-0000-000000000003',label:body.label,fingerprint:hash,createdAt:new Date().toISOString()}]
  }
  if(method==='DELETE')devices=[]
  return r.fulfill({json:{contractVersion:1,pro,preferences:prefs,devices,registrationEnabled,publicKey:publicKeyAvailable?publicKey:null,deliveryEnabled:false}})
 })
 await page.goto('/');await clickHeaderControl(page, page.locator('.auth-nav').getByRole('button',{name:'Моят профил',exact:true}))
 await page.getByRole('tab',{name:'Push известия',exact:true}).click()
 await expect(page.locator('.push-settings')).toBeVisible()
 return {calls,sessionCalls,preferences:()=>prefs}
}
for(const width of [390,1440])for(const lang of ['bg','en'])test(`push section visible without SQL migration ${width} ${lang}`,async({page})=>{
 await page.setViewportSize({width,height:1000});const state=await setup(page,{missingMigration:true})
 if(lang==='en'){await page.getByRole('button',{name:'Затвори',exact:true}).click();await clickHeaderControl(page, page.locator('button.lang-btn'));await clickHeaderControl(page, page.locator('.auth-nav').getByRole('button',{name:'My profile',exact:true}))}
 await page.getByRole('tab',{name:lang==='en'?'Push notifications':'Push известия',exact:true}).click()
 const panel=page.locator('.push-settings')
 await panel.scrollIntoViewIfNeeded();await expect(panel).toBeVisible()
 await expect(panel.getByRole('heading',{level:3})).toHaveText(lang==='bg'?'Push известия при затворен сайт':'Push notifications when the site is closed')
 await expect(panel.getByRole('status')).toHaveText(lang==='bg'?'Push настройките временно не могат да бъдат заредени. Затвори и опитай отново.':'Push preferences temporarily cannot be loaded. Close and try again.')
 await expect(panel).toContainText(lang==='bg'?'автоматичната доставка е изключена':'automatic delivery is disabled')
 await expect(panel.getByRole('button')).toHaveCount(1)
 await expect(panel.getByRole('button')).toHaveText(lang==='bg'?'Провери известията':'Check notifications')
 await expect(page.locator('.notification-settings')).toBeAttached()
 expect(state.calls.every(c=>c.method==='GET')).toBe(true)
 expect(await page.evaluate(()=>(window as any).pushPrompts)).toBe(0)
 await panel.screenshot({path:`work/push-no-migration-${width}-${lang}.png`})
})
async function choose(page:any) {
 const panel=page.locator('.push-settings')
 await panel.getByRole('button',{name:'Добави София',exact:true}).click()
 await panel.getByLabel('Силен вятър',{exact:true}).check()
 await panel.getByLabel('Следи избраните градове и категории').check()
 await panel.getByRole('button',{name:'Запази push настройките'}).click()
 await expect(panel.getByRole('status')).toContainText('запазени')
 await panel.getByLabel('Име на това устройство').fill('Моят телефон')
 return panel
}
for(const lang of ['bg','en'])test(`key rotation asks for explicit resubscription ${lang}`,async({page})=>{
 const state=await setup(page)
 await choose(page)
 if(lang==='en'){
  page.once('dialog',d=>d.accept())
  await page.getByRole('button',{name:'Затвори',exact:true}).click()
  await clickHeaderControl(page, page.locator('button.lang-btn'))
  await clickHeaderControl(page, page.locator('.auth-nav').getByRole('button',{name:'My profile',exact:true}))
  await page.getByRole('tab',{name:'Push notifications',exact:true}).click()
  await page.locator('.push-settings').getByLabel('Name of this device').fill('Test device')
 }
 await page.evaluate(()=>(window as any).stalePushSubscription())
 await page.locator('.push-settings').getByRole('button',{name:lang==='bg'?'Разреши и регистрирай това устройство':'Allow and register this device'}).click()
 await expect(page.locator('.push-settings').getByRole('status')).toContainText(lang==='bg'?'Ключът е обновен':'The key has changed')
 expect(state.calls.filter(c=>c.method==='POST')).toHaveLength(0)
 expect(await page.evaluate(()=>(window as any).pushUnsubscribes)).toBe(0)
})
test('real Chromium PWA manifest, PNG sizes, root worker, no cache or fetch interception',async({page})=>{
 await page.addInitScript(()=>{(window as any).initialPushPermission=Notification.permission;Notification.requestPermission=()=>{throw Error('Unexpected automatic permission prompt')}})
 await page.route('**/*',(r:any)=>new URL(r.request().url()).hostname==='127.0.0.1'?r.fallback():r.abort())
 await page.goto('/')
 const manifest=await page.request.get('/site.webmanifest').then(r=>r.json())
 expect(manifest.id).toBe('/');expect(manifest.scope).toBe('/');expect(manifest.display).toBe('standalone')
 for(const icon of manifest.icons.filter((i:any)=>i.type==='image/png')) {
  const dimensions=await page.evaluate(async(src:string)=>{const image=new Image();image.src=src;await image.decode();return `${image.width}x${image.height}`},icon.src)
  expect(dimensions).toBe(icon.sizes)
 }
 await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href','/pwa/apple-touch-icon.png')
 const result=await page.evaluate(async()=>{const worker=await navigator.serviceWorker.ready;return {scope:worker.scope,script:worker.active?.scriptURL,caches:await caches.keys(),permission:Notification.permission,initial:(window as any).initialPushPermission}})
 expect(result.scope).toBe(new URL('/',page.url()).href);expect(result.script).toContain('/push-sw.js');expect(result.caches).toEqual([]);expect(result.permission).toBe(result.initial)
})
test('default registration off, no prompts, preferences independent of bell and analytics',async({page})=>{
 const state=await setup(page,{registrationEnabled:false})
 expect(await page.evaluate(()=>(window as any).pushPrompts)).toBe(0)
 await expect(page.locator('.push-settings').getByRole('button',{name:'Разреши и регистрирай това устройство'})).toBeDisabled()
 await choose(page)
 await page.locator('.push-settings').getByLabel('Име на това устройство').fill('Note 13 Pro')
 await expect(page.locator('.push-settings').getByRole('button',{name:'Разреши и регистрирай това устройство'})).toBeDisabled()
 expect(state.preferences().categories).toEqual(['wind']);expect(state.preferences().cities).toHaveLength(1)
 expect(state.calls.filter(c=>c.method==='POST')).toHaveLength(0)
 await page.locator('.push-settings').getByRole('button',{name:'Спри всички push известия'}).click()
 await expect(page.locator('.push-settings').getByLabel('Следи избраните градове и категории')).not.toBeChecked()
})
for(const permission of ['denied','default'])test(`permission ${permission}: no subscription or server write`,async({page})=>{
 const state=await setup(page,{permission});const panel=await choose(page)
 expect(await page.evaluate(()=>(window as any).pushPrompts)).toBe(0)
 await panel.getByRole('button',{name:'Разреши и регистрирай това устройство'}).click()
 await expect(panel.getByRole('status')).toContainText(permission==='denied'?'отказано':'не е дадено')
 expect(await page.evaluate(()=>(window as any).pushSubscribes)).toBe(0);expect(state.calls.filter(c=>c.method==='POST')).toHaveLength(0)
})
test('explicit permission → register → server delete → local unsubscribe; delivery stays off',async({page})=>{
 const state=await setup(page);const panel=await choose(page)
 await panel.getByRole('button',{name:'Разреши и регистрирай това устройство'}).click()
 await expect(panel.getByRole('button',{name:'Отпиши устройство'})).toBeVisible()
 expect(await page.evaluate(()=>(window as any).pushPrompts)).toBe(1)
 await panel.getByRole('button',{name:'Отпиши устройство'}).click()
 await expect(panel).toContainText('Няма регистрирани устройства.')
 expect(state.calls.filter(c=>c.method==='DELETE')).toHaveLength(1)
 expect(await page.evaluate(()=>(window as any).pushUnsubscribes)).toBe(1)
})
test('failed server registration keeps subscription and exposes unconfirmed result',async({page})=>{
 await setup(page,{failure:true});const panel=await choose(page)
 await panel.getByRole('button',{name:'Разреши и регистрирай това устройство'}).click()
 await expect(panel.getByRole('status')).toContainText('Резултатът от записването не е потвърден.')
 expect(await page.evaluate(()=>(window as any).pushUnsubscribes)).toBe(0)
 await expect(panel).toContainText('Няма регистрирани устройства.')
})
for(const lang of ['bg','en'])for(const outcome of ['success','rejected','disconnected','lost-response'])test(`safe enrollment ${outcome} ${lang}`,async({page})=>{
 await setup(page);await choose(page)
 if(lang==='en'){
  page.once('dialog',d=>d.accept())
  await page.getByRole('button',{name:'Затвори',exact:true}).click()
  await clickHeaderControl(page,page.locator('button.lang-btn'))
  await clickHeaderControl(page,page.locator('.auth-nav').getByRole('button',{name:'My profile',exact:true}))
  await page.getByRole('tab',{name:'Push notifications',exact:true}).click()
  await page.locator('.push-settings').getByLabel('Name of this device').fill('Note 13 Pro')
 }
 const requests:any[]=[],records=new Map();let attempts=0
 await page.route('**/api/push',async route=>{
  if(route.request().method()!=='POST')return route.fallback()
  const body=route.request().postDataJSON();requests.push(body);attempts++
  if(attempts===1&&outcome==='rejected')return route.fulfill({status:403,json:{error:'PUSH_FORBIDDEN'}})
  if(attempts===1&&outcome==='disconnected')return route.abort('internetdisconnected')
  const fingerprint=await import('node:crypto').then(c=>c.createHash('sha256').update(body.subscription.endpoint).digest('hex'))
  records.set(fingerprint,{id:'00000000-0000-0000-0000-000000000003',label:body.label,fingerprint,createdAt:'2026-10-14T00:00:00Z'})
  if(attempts===1&&outcome==='lost-response')return route.abort('connectionclosed')
  return route.fulfill({json:{contractVersion:1,pro:false,preferences:{enabled:true,cities:[{name:'София',latitude:42.6977,longitude:23.3219,zone:'Europe/Sofia'}],categories:['wind']},devices:[...records.values()],registrationEnabled:true,publicKey,deliveryEnabled:false}})
 })
 const panel=page.locator('.push-settings'),button=panel.getByRole('button',{name:lang==='bg'?'Разреши и регистрирай това устройство':'Allow and register this device',exact:true})
 await button.click()
 const success=lang==='bg'?'Устройството е записано за подготовка.':'Device prepared.'
 const rejected=lang==='bg'?'Заявката за регистрация е отказана.':'The registration request was rejected.'
 const unknown=lang==='bg'?'Резултатът от записването не е потвърден. Абонаментът може да е записан.':'The save result is unconfirmed. The subscription may have been saved.'
 await expect(panel.getByRole('status')).toContainText(outcome==='success'?success:outcome==='rejected'?rejected:unknown)
 if(outcome!=='success')await expect(panel.getByRole('status')).not.toContainText(success)
 expect(requests).toHaveLength(1)
 expect(records.size).toBe(['success','lost-response'].includes(outcome)?1:0)
 expect(await page.evaluate(()=>[(window as any).pushSubscribes,(window as any).pushUnsubscribes])).toEqual([1,0])
 await expect(button).toBeEnabled();await button.click()
 await expect(panel.getByRole('status')).toContainText(success)
 expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);expect(records.size).toBe(1)
 await expect(panel.getByRole('button',{name:lang==='bg'?'Отпиши устройство':'Unsubscribe device',exact:true})).toHaveCount(1)
 expect(await page.evaluate(()=>[(window as any).pushSubscribes,(window as any).pushUnsubscribes])).toEqual([1,0])
})
for(const pro of [false,true])test(`current Pro ${pro}: personal categories gated; free weather available`,async({page})=>{
 await setup(page,{pro});const panel=page.locator('.push-settings')
 await expect(panel.getByLabel('Силен вятър',{exact:true})).toBeEnabled()
 if(pro)await expect(panel.getByLabel('Време за градинарство · Pro',{exact:true})).toBeEnabled()
 else await expect(panel.getByLabel('Време за градинарство · Pro',{exact:true})).toBeDisabled()
})
for(const [name,ua,installed] of [
 ['Android Chrome','Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile',false],
 ['Windows Chrome','Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0',false],
 ['Windows Edge','Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Edg/130.0',false],
 ['iOS tab','Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X)',false],
 ['iOS Home Screen','Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X)',true],
] as const)test(`feature detection ${name} (Chromium simulation)`,async({page})=>{
 await page.addInitScript(({ua,installed}:any)=>{Object.defineProperty(navigator,'userAgent',{value:ua});if(installed)Object.defineProperty(navigator,'standalone',{value:true})},{ua,installed})
 await setup(page)
 await expect(page.locator('.push-settings')).toContainText(name==='iOS tab'?'Добави към началния екран':'Поддържан браузър.')
 expect(await page.evaluate(()=>(window as any).pushPrompts)).toBe(0)
})
for(const width of [390,768,1440])for(const lang of ['bg','en'])test(`push layout ${width} ${lang}`,async({page})=>{
 await page.setViewportSize({width,height:1000});await setup(page)
 if(lang==='en'){await page.getByRole('button',{name:'Затвори',exact:true}).click();await clickHeaderControl(page, page.locator('button.lang-btn'));await clickHeaderControl(page, page.locator('.auth-nav').getByRole('button',{name:'My profile',exact:true}))}
 await page.getByRole('tab',{name:lang==='en'?'Push notifications':'Push известия',exact:true}).click()
 const panel=page.locator('.push-settings');await expect(panel).toBeVisible()
 const overflow=await panel.evaluate((e:any)=>e.scrollWidth>e.clientWidth+1);expect(overflow).toBe(false)
})

for(const registrationEnabled of [false,true])for(const lang of ['bg','en'])test(`read-only registration diagnostics on Note 13 Pro ${lang}, registration ${registrationEnabled}`,async({page})=>{
 const state=await setup(page,{diagnostic:true,registrationEnabled})
 if(lang==='en'){
  await page.getByRole('button',{name:'Затвори',exact:true}).click()
  await clickHeaderControl(page,page.locator('button.lang-btn'))
  await clickHeaderControl(page,page.locator('.auth-nav').getByRole('button',{name:'My profile',exact:true}))
  await page.getByRole('tab',{name:'Push notifications',exact:true}).click()
 }
 const panel=page.locator('.push-settings'),row=panel.locator('li').filter({hasText:'Note 13 Pro'})
 await expect(panel.getByRole('button',{name:lang==='bg'?'Разреши и регистрирай това устройство':'Allow and register this device'})).toBeDisabled()
 for(const [kind,bg,en] of [
  ['worker','Service Worker за Meteo Pulse е недостъпен. Опитай отново.','The Meteo Pulse Service Worker is unavailable. Try again.'],
  ['missing','Липсва браузърен Push абонамент за Meteo Pulse.','No browser Push subscription for Meteo Pulse.'],
  ['match','Регистрацията съвпада с това устройство и VAPID ключа.','Registration matches this device and the VAPID key.'],
  ['vapid','VAPID ключът на браузърния абонамент не съвпада.','The browser subscription VAPID key does not match.'],
  ['device','Браузърният абонамент не съвпада с избраното устройство.','The browser subscription does not match the selected device.'],
 ]){
  await page.evaluate(kind=>(window as any).diagnosticSubscription(kind),kind)
  await row.getByRole('button',{name:lang==='bg'?'Провери регистрацията':'Check registration',exact:true}).click()
  await expect(row.getByRole('status')).toHaveText(lang==='bg'?bg:en)
 }
 expect(state.calls.every(c=>c.method==='GET')).toBe(true)
 expect(await page.evaluate(()=>[(window as any).pushPrompts,(window as any).pushSubscribes,(window as any).pushUnsubscribes])).toEqual([0,0,0])
 await expect(panel).not.toContainText('https://fcm.googleapis.com')
})

for(const lang of ['bg','en'])test(`missing diagnostic public key ${lang}`,async({page})=>{
 const state=await setup(page,{diagnostic:true,registrationEnabled:false,publicKeyAvailable:false})
 if(lang==='en'){
  await page.getByRole('button',{name:'Затвори',exact:true}).click()
  await clickHeaderControl(page,page.locator('button.lang-btn'))
  await clickHeaderControl(page,page.locator('.auth-nav').getByRole('button',{name:'My profile',exact:true}))
  await page.getByRole('tab',{name:'Push notifications',exact:true}).click()
 }
 const row=page.locator('.push-settings li').filter({hasText:'Note 13 Pro'})
 await row.getByRole('button',{name:lang==='bg'?'Провери регистрацията':'Check registration',exact:true}).click()
 await expect(row.getByRole('status')).toHaveText(lang==='bg'?'Публичният VAPID ключ за проверката липсва или е невалиден.':'The public VAPID key for the check is missing or invalid.')
 expect(state.calls.every(c=>c.method==='GET')).toBe(true)
 expect(await page.evaluate(()=>[(window as any).pushPrompts,(window as any).pushSubscribes,(window as any).pushUnsubscribes])).toEqual([0,0,0])
})

for(const lang of ['bg','en'])test(`safe p256dh/auth diagnostics ${lang}`,async({page})=>{
 const state=await setup(page,{diagnostic:true,registrationEnabled:false})
 if(lang==='en'){
  await page.getByRole('button',{name:'Затвори',exact:true}).click()
  await clickHeaderControl(page,page.locator('button.lang-btn'))
  await clickHeaderControl(page,page.locator('.auth-nav').getByRole('button',{name:'My profile',exact:true}))
  await page.getByRole('tab',{name:'Push notifications',exact:true}).click()
 }
 const requests:any[]=[];let statuses={p256dh:'match',auth:'match'}
 await page.route('**/api/push-key-diagnostics',async r=>{
  const body=r.request().postDataJSON();requests.push(body)
  expect(Object.keys(body).sort()).toEqual(['auth','deviceId','fingerprint','nonce','p256dh'])
  for(const field of ['p256dh','auth','nonce'])expect(body[field]).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(body)).not.toContain(publicKey)
  expect(JSON.stringify(body)).not.toContain('AQEBAQEBAQEBAQEBAQEBAQ')
  expect(JSON.stringify(body)).not.toContain('https://fcm.googleapis.com')
  return r.fulfill({json:{keys:statuses}})
 })
 const row=page.locator('.push-settings li').filter({hasText:'Note 13 Pro'})
 const button=row.getByRole('button',{name:lang==='bg'?'Провери p256dh/auth':'Check p256dh/auth',exact:true})
 await page.evaluate(()=>(window as any).diagnosticSubscription('device'))
 await button.click();await expect(row.getByRole('status')).toContainText(lang==='bg'?'не може да бъде проверен':'cannot be checked')
 expect(requests).toHaveLength(0)
 await page.evaluate(()=>(window as any).diagnosticSubscription('match'))
 for(const status of ['match','mismatch','missing','unavailable']){
  statuses={p256dh:status,auth:status}
  await button.click()
  const text=lang==='bg'?{match:'p256dh: съвпада',mismatch:'p256dh: не съвпада',missing:'липсва в браузъра или в записа',unavailable:'не може да бъде проверен'}:{match:'p256dh: matches',mismatch:'p256dh: does not match',missing:'missing in the browser or stored record',unavailable:'cannot be checked'}
  await expect(row.getByRole('status')).toContainText(text[status])
  await expect(row.getByRole('status')).toContainText(lang==='bg'?'не доказва, че FCM ще приеме':'does not prove that FCM will accept')
 }
 expect(requests).toHaveLength(4);expect(new Set(requests.map(r=>r.nonce)).size).toBe(4)
 await page.route('**/api/push-key-diagnostics',r=>r.fulfill({status:503,json:{keys:{p256dh:'unavailable',auth:'unavailable'},diagnostic:'rpc:schema-cache'}}))
 await button.click()
 await expect(row.getByRole('status')).toContainText('rpc:schema-cache')
 await expect(row.getByRole('status')).toContainText(lang==='bg'?'Диагностичен етап':'Diagnostic stage')
 await page.route('**/api/push-key-diagnostics',r=>r.fulfill({status:503,json:{diagnostic:'private-token-example',message:'private-endpoint-example'}}))
 await button.click()
 await expect(row.getByRole('status')).toContainText('request:http')
 await expect(row.getByRole('status')).not.toContainText('private-')
 expect(state.calls.every(c=>c.method==='GET')).toBe(true)
 expect(await page.evaluate(()=>[(window as any).pushPrompts,(window as any).pushSubscribes,(window as any).pushUnsubscribes])).toEqual([0,0,0])
})

for(const scenario of ['success','cancel','mismatch','lost-response','subscribe-failed','disabled'])test(`manual Push renewal ${scenario} uses only simulated operations`,async({page})=>{
 const state=await setup(page,{diagnostic:true,registrationEnabled:scenario!=='disabled'})
 const panel=await choose(page)
 await page.evaluate(({publicKey,scenario})=>{
  const w:any=window
  w.setTestPushPermission('granted')
  const old={endpoint:'https://fcm.googleapis.com/wp/'+(scenario==='mismatch'?'other':'isolated'),options:{applicationServerKey:Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)).buffer},unsubscribe:async()=>{w.pushUnsubscribes++;return true}}
  w.renewalRegistration={scope:location.origin+'/',active:{scriptURL:location.origin+'/push-sw.js'},pushManager:{getSubscription:async()=>old,subscribe:async()=>{
   w.pushSubscribes++;if(scenario==='subscribe-failed')throw Error('synthetic failure')
   return {toJSON:()=>({endpoint:'https://fcm.googleapis.com/wp/renewed',keys:{p256dh:publicKey,auth:'AQEBAQEBAQEBAQEBAQEBAQ'}}),unsubscribe:()=>{throw Error('Unexpected cleanup')}}
  }}}
 },{publicKey,scenario})
 const hash=await import('node:crypto').then(c=>c.createHash('sha256').update('https://fcm.googleapis.com/wp/isolated').digest('hex'))
 const oldDevice={id:'00000000-0000-0000-0000-000000000003',label:'Note 13 Pro',fingerprint:hash,createdAt:'2026-10-14T00:00:00Z'}
 const calls:any[]=[]
 await page.route('**/api/push',async r=>{
  const method=r.request().method();calls.push({method,body:r.request().postDataJSON()})
  if(method==='POST'&&scenario==='lost-response')return r.abort('failed')
  return r.fulfill({json:{contractVersion:1,pro:false,preferences:state.preferences(),devices:method==='POST'?[oldDevice,{...oldDevice,id:'00000000-0000-0000-0000-000000000004',label:'Renewed device'}]:[oldDevice],registrationEnabled:scenario!=='disabled',publicKey,deliveryEnabled:false}})
 })
 // Trigger a React render after setting the synthetic permission.
 await panel.getByLabel('Име на това устройство').fill('Test phone')
 const button=panel.getByRole('button',{name:'Поднови Push регистрацията',exact:true})
 if(scenario==='disabled'){
  await expect(button).toBeDisabled()
 }else{
  let dialogs=0
  page.on('dialog',async dialog=>{dialogs++;expect(dialog.message()).toContain('не може надеждно да се възстанови');if(scenario==='cancel')await dialog.dismiss();else await dialog.accept()})
  await button.click()
  const messages:any={success:'Push регистрацията е подновена',cancel:'Подновяването е отказано',mismatch:'не съвпада с избраното устройство','lost-response':'Резултатът от записването е неясен','subscribe-failed':'новото абониране не успя'}
  await expect(panel.getByRole('status').first()).toContainText(messages[scenario])
  expect(dialogs).toBe(scenario==='mismatch'?0:1)
 }
 const mutated=['success','lost-response','subscribe-failed'].includes(scenario)
 expect(await page.evaluate(()=>(window as any).pushUnsubscribes)).toBe(mutated?1:0)
 expect(await page.evaluate(()=>(window as any).pushSubscribes)).toBe(mutated?1:0)
 expect(calls.filter(c=>c.method==='DELETE')).toHaveLength(0)
 expect(calls.filter(c=>c.method==='POST')).toHaveLength(['success','lost-response'].includes(scenario)?1:0)
 expect(await page.evaluate(()=>(window as any).pushPrompts)).toBe(0)
 if(scenario==='success'){await expect(panel).toContainText('Note 13 Pro');await expect(panel).toContainText('Renewed device')}
})


test('local notification button uses only showNotification and leaves all server state alone',async({page})=>{
 const state=await setup(page)
 await page.evaluate(()=>(window as any).setTestPushPermission('granted'))
 const before=state.calls.length,sessionBefore=state.sessionCalls.length
 await page.getByRole('button',{name:'Провери известията',exact:true}).click()
 await expect(page.locator('.push-settings').getByRole('status')).toContainText('local:requested')
 expect(await page.evaluate(()=>(window as any).localNotifications)).toBe(1)
 expect(state.calls.length).toBe(before);expect(state.sessionCalls.length).toBe(sessionBefore)
 expect(await page.evaluate(()=>(window as any).pushPrompts)).toBe(0)
 await expect(page.getByRole('button',{name:'Изпрати тестово Push известие',exact:true})).toHaveCount(0)
})
for(const confirm of [false,true])test(`session Push requires immediate confirmation, answer ${confirm}`,async({page})=>{
 const state=await setup(page,{diagnostic:true,sessionDiagnostic:true})
 await choose(page)
 await page.evaluate(()=>{(window as any).setTestPushPermission('granted');(window as any).diagnosticSubscription('match')})
 page.on('dialog',dialog=>{expect(dialog.message()).toContain('Desktop Chrome synthetic');expect(dialog.message()).not.toContain('Redmi');return confirm?dialog.accept():dialog.dismiss()})
 await page.getByRole('button',{name:'Изпрати тестово Push известие',exact:true}).click()
 if(confirm){
  await expect(page.locator('.push-settings').getByRole('status')).toContainText('fcm:accepted')
  await expect(page.locator('.push-settings').getByRole('status')).toContainText('Доставката до устройството не е потвърдена')
 }else await expect.poll(()=>state.sessionCalls.some(c=>c.operation==='cancel')).toBe(true)
 expect(state.sessionCalls.filter(c=>c.operation==='prepare')).toHaveLength(1)
 expect(state.sessionCalls.filter(c=>c.operation==='send')).toHaveLength(confirm?1:0)
 expect(state.sessionCalls.every(c=>!Object.hasOwn(c,'userId')&&!Object.hasOwn(c,'deviceId'))).toBe(true)
})

for(const lang of ['bg','en'])for(const scenario of ['registration','cancel','http','malformed','lost','refresh','pending','suppressed','send-lost','provider','unsafe'])test(`session Push diagnostic regression ${scenario} ${lang}`,async({page})=>{
 const state=await setup(page,{diagnostic:true,sessionDiagnostic:true})
 await choose(page)
 if(lang==='en'){
  await page.locator('.push-settings').getByLabel('Име на това устройство').fill('')
  await page.getByRole('button',{name:'Затвори',exact:true}).click()
  await clickHeaderControl(page,page.locator('button.lang-btn'))
  await clickHeaderControl(page,page.locator('.auth-nav').getByRole('button',{name:'My profile',exact:true}))
  await page.getByRole('tab',{name:'Push notifications',exact:true}).click()
 }
 await page.evaluate(()=>{(window as any).setTestPushPermission('granted');(window as any).diagnosticSubscription('match')})
 let dialogs=0,sends=0,cancels=0
 page.on('dialog',async d=>{dialogs++;if(scenario==='send-lost')await d.accept();else await d.dismiss()})
 if(scenario==='suppressed')await page.evaluate(()=>{window.confirm=()=>false})
 await page.route('**/api/push-operator',async r=>{
  const operation=r.request().postDataJSON().operation
  if(operation==='send'){sends++;if(scenario==='send-lost')return r.abort('connectionclosed')}
  if(operation==='cancel')cancels++
  if(operation!=='prepare')return r.fallback()
  if(scenario==='provider')return r.fulfill({status:502,json:{code:'fcm:rejected',diagnostic:{category:'provider_auth_rejected',providerStatus:403}}})
  if(scenario==='unsafe')return r.fulfill({status:503,json:{code:'private-token',diagnostic:{category:'private-endpoint',providerStatus:'private-key'}}})
  if(scenario==='http')return r.fulfill({status:403,json:{code:'rights:denied'}})
  if(scenario==='malformed')return r.fulfill({status:503,body:'private server error'})
  if(scenario==='lost')return r.abort('connectionclosed')
  return r.fallback()
 })
 if(scenario==='registration')await page.evaluate(()=>(window as any).diagnosticSubscription('missing'))
 if(['refresh','pending'].includes(scenario))await page.evaluate(()=>{
  const original=navigator.serviceWorker.getRegistration.bind(navigator.serviceWorker)
  Object.defineProperty(navigator.serviceWorker,'getRegistration',{configurable:true,value:()=>{Object.defineProperty(navigator.serviceWorker,'getRegistration',{configurable:true,value:original});return new Promise(resolve=>{(window as any).finishRegistration=async()=>resolve(await original('/'))})}})
 })
 await page.getByRole('button',{name:lang==='bg'?'Изпрати тестово Push известие':'Send test Push notification',exact:true}).click()
 const status=page.locator('.push-settings').getByRole('status')
 if(['refresh','pending'].includes(scenario)){
  await expect(status).toContainText('device:checking')
  if(scenario==='refresh'){
   await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('meteo-pulse-auth')!);s.access_token='rotated-token';s.refresh_token='rotated-refresh';localStorage.setItem('meteo-pulse-auth',JSON.stringify(s));window.dispatchEvent(new StorageEvent('storage',{key:'meteo-pulse-auth'}))})
   await page.evaluate(()=>(window as any).finishRegistration())
   await expect(status).toContainText('confirmation:cancelled')
  }else{
   await expect(status).toContainText('device:unavailable',{timeout:15000})
   await page.evaluate(()=>(window as any).finishRegistration())
  }
 }else{
  const codes:Record<string,string>={registration:'device:missing-subscription',cancel:'confirmation:cancelled',http:'rights:denied · HTTP 403',malformed:'request:http · HTTP 503',lost:'network:unknown',suppressed:'confirmation:cancelled','send-lost':'network:unknown',provider:'fcm:rejected · HTTP 502 · provider_auth_rejected · provider HTTP 403',unsafe:'request:http · HTTP 503'}
  await expect(status).toContainText(codes[scenario])
 }
 await expect(status).not.toContainText('private')
 expect(dialogs).toBe(['cancel','send-lost','refresh'].includes(scenario)?1:0)
 expect(sends).toBe(scenario==='send-lost'?1:0)
 if(scenario==='cancel')await expect.poll(()=>cancels).toBe(1)
 if(['registration','pending'].includes(scenario))expect(state.sessionCalls.filter(c=>c.operation==='prepare')).toHaveLength(0)
 expect(await page.evaluate(()=>[(window as any).pushSubscribes,(window as any).pushUnsubscribes])).toEqual([0,0])
})

for(const lang of ['bg','en'])for(const stage of ['before-prepare','after-prepare','before-send'])test(`Push same-account refresh continues ${stage} ${lang}`,async({page})=>{
 await setup(page,{diagnostic:true,sessionDiagnostic:true});await choose(page)
 if(lang==='en'){
  await page.locator('.push-settings').getByLabel('Име на това устройство').fill('')
  await page.getByRole('button',{name:'Затвори',exact:true}).click()
  await clickHeaderControl(page,page.locator('button.lang-btn'))
  await clickHeaderControl(page,page.locator('.auth-nav').getByRole('button',{name:'My profile',exact:true}))
  await page.getByRole('tab',{name:'Push notifications',exact:true}).click()
 }
 await page.evaluate(stage=>{
  const w:any=window;w.setTestPushPermission('granted');w.diagnosticSubscription('match')
  w.pushPanel=document.querySelector('.push-settings');w.rotations=0
  w.rotatePushSession=()=>{const s=JSON.parse(localStorage.getItem('meteo-pulse-auth')!);s.access_token='synthetic-rotated';s.refresh_token='synthetic-refresh-rotated';localStorage.setItem('meteo-pulse-auth',JSON.stringify(s));window.dispatchEvent(new StorageEvent('storage',{key:'meteo-pulse-auth'}));w.rotations++}
  if(stage==='before-prepare'){
   const original=navigator.serviceWorker.getRegistration.bind(navigator.serviceWorker)
   Object.defineProperty(navigator.serviceWorker,'getRegistration',{configurable:true,value:async()=>{Object.defineProperty(navigator.serviceWorker,'getRegistration',{configurable:true,value:original});w.rotatePushSession();return original('/')}})
  }
  if(stage==='before-send'){const confirm=window.confirm;window.confirm=message=>{const answer=confirm(message);if(answer)w.rotatePushSession();return answer}}
 },stage)
 const requests:{operation:string;token:string|null}[]=[];let dialogs=0
 page.on('dialog',async d=>{dialogs++;await d.accept()})
 await page.route('**/api/push-operator',async r=>{
  const operation=r.request().postDataJSON().operation;requests.push({operation,token:r.request().headers().authorization})
  if(operation==='prepare'&&stage==='after-prepare')await page.evaluate(()=>(window as any).rotatePushSession())
  return r.fallback()
 })
 await page.getByRole('button',{name:lang==='bg'?'Изпрати тестово Push известие':'Send test Push notification',exact:true}).click()
 await expect(page.locator('.push-settings').getByRole('status')).toContainText('fcm:accepted')
 expect(requests.filter(r=>r.operation==='prepare')).toHaveLength(1)
 expect(requests.filter(r=>r.operation==='send')).toEqual([{operation:'send',token:'Bearer synthetic-rotated'}])
 if(stage==='before-prepare')expect(requests.find(r=>r.operation==='prepare')?.token).toBe('Bearer synthetic-rotated')
 expect(dialogs).toBe(1)
 expect(await page.evaluate(()=>({same:(window as any).pushPanel===document.querySelector('.push-settings'),rotations:(window as any).rotations}))).toEqual({same:true,rotations:1})
 expect(requests.filter(r=>r.operation==='cancel')).toHaveLength(0)
})

for(const change of ['account','logout','roundtrip'])for(const stage of ['before-prepare','after-prepare','before-send'])test(`Push identity invalidation ${change} ${stage}`,async({page})=>{
 await setup(page,{diagnostic:true,sessionDiagnostic:true});await choose(page)
 await page.evaluate(({change,stage})=>{
  const w:any=window;w.setTestPushPermission('granted');w.diagnosticSubscription('match')
  w.changePushIdentity=()=>{
   const original=localStorage.getItem('meteo-pulse-auth')!,s=JSON.parse(original)
   if(change==='logout')localStorage.removeItem('meteo-pulse-auth')
   else {s.user.id='00000000-0000-0000-0000-000000000099';s.access_token='synthetic-other';s.refresh_token='synthetic-other-refresh';localStorage.setItem('meteo-pulse-auth',JSON.stringify(s))}
   window.dispatchEvent(new StorageEvent('storage',{key:'meteo-pulse-auth'}))
   if(change==='roundtrip'){localStorage.setItem('meteo-pulse-auth',original);window.dispatchEvent(new StorageEvent('storage',{key:'meteo-pulse-auth'}))}
  }
  if(stage==='before-prepare'){
   const original=navigator.serviceWorker.getRegistration.bind(navigator.serviceWorker)
   Object.defineProperty(navigator.serviceWorker,'getRegistration',{configurable:true,value:async()=>{Object.defineProperty(navigator.serviceWorker,'getRegistration',{configurable:true,value:original});w.changePushIdentity();return original('/')}})
  }
  if(stage==='before-send'){const confirm=window.confirm;window.confirm=message=>{const answer=confirm(message);if(answer)w.changePushIdentity();return answer}}
 },{change,stage})
 const calls:string[]=[];let dialogs=0
 page.on('dialog',async d=>{dialogs++;await d.accept()})
 await page.route('**/api/push-operator',async r=>{
  const operation=r.request().postDataJSON().operation;calls.push(operation)
  if(operation==='prepare'&&stage==='after-prepare')await page.evaluate(()=>(window as any).changePushIdentity())
  return r.fallback()
 })
 await page.getByRole('button',{name:'Изпрати тестово Push известие',exact:true}).click()
 if(change==='logout')await expect(page.locator('.push-settings')).toHaveCount(0)
 else await expect(page.locator('.push-settings').getByRole('button',{name:'Изпрати тестово Push известие',exact:true})).toBeEnabled()
 // Drain the pending handler via a terminal state or the unused-permit cancellation.
 if(change==='roundtrip')await expect(page.locator('.push-settings').getByRole('status')).toContainText('session:changed')
 if(stage!=='before-prepare'&&change==='roundtrip')await expect.poll(()=>calls.includes('cancel')).toBe(true)
 expect(calls.filter(c=>c==='send')).toHaveLength(0)
 expect(calls.filter(c=>c==='prepare')).toHaveLength(stage==='before-prepare'?0:1)
 expect(dialogs).toBe(stage==='before-send'?1:0)
})

test('Push automatic auth refresh publishes the same account without remount or replay',async({page})=>{
 await setup(page,{diagnostic:true,sessionDiagnostic:true});await choose(page)
 let refreshes=0;const calls:{operation:string;authorization:string|undefined}[]=[]
 await page.route('**/auth/v1/token**',r=>{refreshes++;return r.fulfill({json:{access_token:'synthetic-auto-new',refresh_token:'synthetic-auto-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'00000000-0000-0000-0000-000000000002',email:'push@example.invalid'}}})})
 await page.route('**/api/push-operator',r=>{calls.push({operation:r.request().postDataJSON().operation,authorization:r.request().headers().authorization});return r.fallback()})
 await page.evaluate(()=>{
  const w:any=window;w.setTestPushPermission('granted');w.diagnosticSubscription('match');w.pushPanel=document.querySelector('.push-settings')
  const original=navigator.serviceWorker.getRegistration.bind(navigator.serviceWorker)
  Object.defineProperty(navigator.serviceWorker,'getRegistration',{configurable:true,value:async()=>{
   Object.defineProperty(navigator.serviceWorker,'getRegistration',{configurable:true,value:original})
   const s=JSON.parse(localStorage.getItem('meteo-pulse-auth')!);s.expires_at=Math.floor(Date.now()/1000)-1
   localStorage.setItem('meteo-pulse-auth',JSON.stringify(s));window.dispatchEvent(new StorageEvent('storage',{key:'meteo-pulse-auth'}))
   return original('/')
  }})
 })
 page.on('dialog',d=>d.accept())
 await page.getByRole('button',{name:'Изпрати тестово Push известие',exact:true}).click()
 await expect(page.locator('.push-settings').getByRole('status')).toContainText('fcm:accepted')
 expect(refreshes).toBe(1)
 expect(calls.filter(c=>c.operation==='prepare')).toEqual([{operation:'prepare',authorization:'Bearer synthetic-auto-new'}])
 expect(calls.filter(c=>c.operation==='send')).toEqual([{operation:'send',authorization:'Bearer synthetic-auto-new'}])
 expect(await page.evaluate(()=>(window as any).pushPanel===document.querySelector('.push-settings'))).toBe(true)
})

for(const refusal of ['rights','consent','registration'])test(`Push final revalidation stops revoked ${refusal}`,async({page})=>{
 await setup(page,{diagnostic:true,sessionDiagnostic:true});await choose(page)
 await page.evaluate(()=>{const w:any=window;w.setTestPushPermission('granted');w.diagnosticSubscription('match');w.pushConfirmed=false;const confirm=window.confirm;window.confirm=message=>{const answer=confirm(message);w.pushConfirmed=answer;return answer}})
 const operations:string[]=[]
 await page.route('**/api/push-operator',async r=>{
  const operation=r.request().postDataJSON().operation;operations.push(operation)
  if(refusal==='rights'&&operation==='access'&&await page.evaluate(()=>(window as any).pushConfirmed))return r.fulfill({status:403,json:{code:'rights:denied',deliveryEnabled:false,phoneDelivery:'unconfirmed'}})
  return r.fallback()
 })
 if(refusal==='consent')await page.route('**/api/push',async r=>{
  if(r.request().method()!=='GET'||!await page.evaluate(()=>(window as any).pushConfirmed))return r.fallback()
  // Synthetic denied snapshot; never forward to a hosted account API.
  return r.fulfill({json:{contractVersion:1,pro:false,preferences:{enabled:false,cities:[],categories:[]},devices:[],registrationEnabled:true,publicKey,deliveryEnabled:false}})
 })
 if(refusal==='registration')await page.evaluate(()=>{const confirm=window.confirm;window.confirm=message=>{const answer=confirm(message);if(answer)(window as any).diagnosticSubscription('device');return answer}})
 let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.accept()})
 await page.getByRole('button',{name:'Изпрати тестово Push известие',exact:true}).click()
 await expect(page.locator('.push-settings').getByRole('status')).toContainText(refusal==='rights'?'rights:denied':'device:registration-or-consent')
 await expect.poll(()=>operations.includes('cancel')).toBe(true)
 expect(dialogs).toBe(1);expect(operations.filter(x=>x==='prepare')).toHaveLength(1);expect(operations.filter(x=>x==='send')).toHaveLength(0)
})

for(const lang of ['bg','en'])for(const reason of ['known','unknown','empty','unsafe'])test(`FCM 400 safe provider diagnostic ${reason} ${lang}`,async({page})=>{
 await setup(page,{diagnostic:true,sessionDiagnostic:true});await choose(page)
 if(lang==='en'){
  await page.locator('.push-settings').getByLabel('Име на това устройство').fill('')
  await page.getByRole('button',{name:'Затвори',exact:true}).click()
  await clickHeaderControl(page,page.locator('button.lang-btn'))
  await clickHeaderControl(page,page.locator('.auth-nav').getByRole('button',{name:'My profile',exact:true}))
  await page.getByRole('tab',{name:'Push notifications',exact:true}).click()
 }
 await page.evaluate(()=>{(window as any).setTestPushPermission('granted');(window as any).diagnosticSubscription('match')})
 let sends=0,cancels=0,dialogs=0
 page.on('dialog',async d=>{dialogs++;await d.accept()})
 await page.route('**/api/push-operator',r=>{
  const operation=r.request().postDataJSON().operation
  if(operation==='cancel')cancels++
  if(operation!=='send')return r.fallback()
  sends++
  return r.fulfill({status:502,json:{code:'fcm:rejected',deliveryEnabled:false,phoneDelivery:'unconfirmed',diagnostic:{category:'request_rejected',providerStatus:400,providerBodyStatus:reason==='known'?'recognized':reason==='empty'?'empty':reason==='unsafe'?'PRIVATE_ENDPOINT':'unknown_format',...(reason==='known'?{providerReason:'fcm_unauthorized_registration'}:reason==='unsafe'?{providerReason:'PRIVATE_TOKEN'}:{}),raw:'PRIVATE_FCM_BODY',authorization:'PRIVATE_AUTH',endpoint:'PRIVATE_ENDPOINT'}}})
 })
 await page.getByRole('button',{name:lang==='bg'?'Изпрати тестово Push известие':'Send test Push notification',exact:true}).click()
 const status=page.locator('.push-settings').getByRole('status')
 await expect(status).toContainText('fcm:rejected · HTTP 502 · request_rejected · provider HTTP 400')
 if(reason==='known')await expect(status).toContainText('providerReason:fcm_unauthorized_registration')
 else await expect(status).toContainText(lang==='bg'?'Точната причина за отказа не е установена.':'The exact rejection reason is unknown.')
 if(['known','empty'].includes(reason))await expect(status).toContainText('providerBodyStatus:'+(reason==='known'?'recognized':'empty'))
 await expect(status).not.toContainText('PRIVATE_')
 expect(sends).toBe(1);expect(cancels).toBe(0);expect(dialogs).toBe(1)
})

for(const target of ['none','wrong'])test(`session target ${target} disables send without preparing`,async({page})=>{
 await setup(page,{diagnostic:true,sessionDiagnostic:true})
 await page.route('**/api/push-operator',r=>r.fulfill({json:{code:'rights:allowed',allowed:true,target:target==='none'?null:{deviceId:'b1000000-0000-0000-0000-000000000099',label:'Other synthetic'},deliveryEnabled:false,phoneDelivery:'unconfirmed'}}))
 // Remount to read the changed server authority.
 await page.getByRole('button',{name:'Затвори',exact:true}).click()
 await clickHeaderControl(page,page.locator('.auth-nav').getByRole('button',{name:'Моят профил',exact:true}))
 await page.getByRole('tab',{name:'Push известия',exact:true}).click()
 await expect(page.getByRole('button',{name:'Изпрати тестово Push известие',exact:true})).toBeDisabled()
 await expect(page.locator('.push-settings')).toContainText('Разрешено устройство: '+(target==='none'?'няма':'Other synthetic'))
 await expect(page.locator('.push-settings')).toContainText('FCM: fcm-wp')
})

test('session Push refuses changed browser keys before confirmation',async({page})=>{
 const state=await setup(page,{diagnostic:true,sessionDiagnostic:true});await choose(page)
 await page.route('**/api/push-key-diagnostics',r=>r.fulfill({json:{keys:{p256dh:'match',auth:'mismatch'}}}))
 let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss()})
 await page.getByRole('button',{name:'Изпрати тестово Push известие',exact:true}).click()
 await expect(page.locator('.push-settings').getByRole('status')).toContainText('device:registration-or-consent')
 await expect.poll(()=>state.sessionCalls.some(c=>c.operation==='cancel')).toBe(true)
 expect(dialogs).toBe(0);expect(state.sessionCalls.some(c=>c.operation==='send')).toBe(false)
})
