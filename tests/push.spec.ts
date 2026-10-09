import {test,expect} from '@playwright/test'
const publicKey=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url')
const preferences={enabled:false,cities:[],categories:[]}
async function setup(page:any,{permission='granted',registrationEnabled=true,pro=false,failure=false,missingMigration=false}:{permission?:string;registrationEnabled?:boolean;pro?:boolean;failure?:boolean;missingMigration?:boolean}={}) {
 await page.addInitScript(({permission,publicKey}:any)=>{
  localStorage.setItem('meteo-pulse-auth',JSON.stringify({access_token:'isolated-token',refresh_token:'isolated-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'00000000-0000-0000-0000-000000000002',email:'push@example.invalid'}}))
  const scope:any=window;scope.pushPrompts=0;scope.pushUnsubscribes=0;scope.pushSubscribes=0
  let permissionValue='default',subscription:any=null
  Object.defineProperty(Notification,'permission',{get:()=>permissionValue})
  Notification.requestPermission=()=>{scope.pushPrompts++;permissionValue=permission;return Promise.resolve(permission as NotificationPermission)}
  Object.defineProperty(navigator.serviceWorker,'register',{value:async()=>({pushManager:{
   getSubscription:async()=>subscription,
   subscribe:async()=>{scope.pushSubscribes++;subscription={endpoint:'https://fcm.googleapis.com/wp/isolated',toJSON:()=>({endpoint:'https://fcm.googleapis.com/wp/isolated',expirationTime:null,keys:{p256dh:publicKey,auth:'AQEBAQEBAQEBAQEBAQEBAQ'}}),unsubscribe:async()=>{scope.pushUnsubscribes++;subscription=null;return true}};return subscription},
  }})})
 },{permission,publicKey})
 const origin=new URL(process.env.PUSH_PREVIEW_URL||'http://127.0.0.1:4173').origin
 // Even hosted Preview checks only fetch static assets. All account APIs are fixtures.
 await page.route('**/*',(r:any)=>new URL(r.request().url()).origin===origin?(new URL(r.request().url()).pathname.startsWith('/api/')?r.fulfill({status:503,json:{error:'ISOLATED_TEST'}}):r.fallback()):r.fulfill({json:{}}))
 await page.route('**/api/profile',(r:any)=>r.fulfill({json:{name:'Push Test',plan:pro?'pro':'free',permissions:pro?['planner:advanced']:[]}}))
 await page.route('**/api/activity',(r:any)=>r.fulfill({json:{enabled:false}}))
 await page.route('**/api/alerts',(r:any)=>r.fulfill({json:{contractVersion:2,pro,enabled:[],alerts:[]}}))
 const calls:any[]=[];let prefs:any={...preferences},devices:any[]=[]
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
  return r.fulfill({json:{contractVersion:1,pro,preferences:prefs,devices,registrationEnabled,publicKey:registrationEnabled?publicKey:null,deliveryEnabled:false}})
 })
 await page.goto('/');await page.locator('.auth-nav').getByRole('button',{name:'Моят профил',exact:true}).click()
 await expect(page.locator('.push-settings')).toBeVisible()
 return {calls,preferences:()=>prefs}
}
for(const width of [390,1440])for(const lang of ['bg','en'])test(`push section visible without SQL migration ${width} ${lang}`,async({page})=>{
 await page.setViewportSize({width,height:1000});const state=await setup(page,{missingMigration:true})
 if(lang==='en'){await page.getByRole('button',{name:'Затвори',exact:true}).click();await page.locator('button.lang-btn').click();await page.locator('.auth-nav').getByRole('button',{name:'My profile',exact:true}).click()}
 const panel=page.locator('.push-settings')
 await panel.scrollIntoViewIfNeeded();await expect(panel).toBeVisible()
 await expect(panel.getByRole('heading',{level:3})).toHaveText(lang==='bg'?'Push известия при затворен сайт':'Push notifications when the site is closed')
 await expect(panel.getByRole('status')).toHaveText(lang==='bg'?'Push подготовката още не е конфигурирана.':'Push preparation is not configured yet.')
 await expect(panel).toContainText(lang==='bg'?'автоматичната доставка е изключена':'automatic delivery is disabled')
 await expect(panel.getByRole('button')).toHaveCount(0)
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
 expect(result.scope).toBe('http://127.0.0.1:4173/');expect(result.script).toContain('/push-sw.js');expect(result.caches).toEqual([]);expect(result.permission).toBe(result.initial)
})
test('default registration off, no prompts, preferences independent of bell and analytics',async({page})=>{
 const state=await setup(page,{registrationEnabled:false})
 expect(await page.evaluate(()=>(window as any).pushPrompts)).toBe(0)
 await expect(page.locator('.push-settings').getByRole('button',{name:'Разреши и регистрирай това устройство'})).toBeDisabled()
 await choose(page)
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
test('failed server registration rolls back subscription and exposes no success',async({page})=>{
 await setup(page,{failure:true});const panel=await choose(page)
 await panel.getByRole('button',{name:'Разреши и регистрирай това устройство'}).click()
 await expect(panel.getByRole('status')).toContainText('не е потвърдена')
 expect(await page.evaluate(()=>(window as any).pushUnsubscribes)).toBe(1)
 await expect(panel).toContainText('Няма регистрирани устройства.')
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
 if(lang==='en'){await page.getByRole('button',{name:'Затвори',exact:true}).click();await page.locator('button.lang-btn').click();await page.locator('.auth-nav').getByRole('button',{name:'My profile',exact:true}).click()}
 const panel=page.locator('.push-settings');await expect(panel).toBeVisible()
 const overflow=await panel.evaluate((e:any)=>e.scrollWidth>e.clientWidth+1);expect(overflow).toBe(false)
})
