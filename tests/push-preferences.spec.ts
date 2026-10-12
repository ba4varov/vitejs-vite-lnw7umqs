import {test,expect} from '@playwright/test'
import {fixture} from './profile-fixture'

const empty={enabled:false,cities:[],categories:[]}
const selected={enabled:true,cities:[{name:'Варна',latitude:43.2141,longitude:27.9147,zone:'Europe/Sofia'}],categories:['rain']}
const snapshot=(preferences:any)=>({contractVersion:1,pro:false,preferences,devices:[],registrationEnabled:false,publicKey:null,deliveryEnabled:false})
async function open(page:any,lang:'bg'|'en'='bg') {
 await page.locator('.auth-nav').getByRole('button',{name:lang==='bg'?'Моят профил':'My profile',exact:true}).click()
 await page.getByRole('tab',{name:lang==='bg'?'Push известия':'Push notifications',exact:true}).click()
 const panel=page.locator('.push-settings')
 await expect(panel.getByLabel(lang==='bg'?'Следи избраните градове и категории':'Monitor selected cities and categories')).toBeVisible()
 return panel
}
async function choose(panel:any,lang:'bg'|'en'='bg') {
 await panel.getByLabel(lang==='bg'?'Следи избраните градове и категории':'Monitor selected cities and categories').check()
 await panel.getByLabel(lang==='bg'?'Силни валежи':'Heavy precipitation',{exact:true}).check()
 await panel.getByRole('button',{name:lang==='bg'?'Добави Варна':'Add Варна',exact:true}).click()
}
for(const lang of ['bg','en'] as const)test(`push preferences save and full reload ${lang}`,async({page})=>{
 await fixture(page,lang)
 let stored:any=empty,release=()=>{}
 const requests:string[]=[]
 await page.route('**/api/push',async route=>{
  requests.push(route.request().method())
  if(route.request().method()==='PATCH'){
   expect(route.request().postDataJSON()).toEqual(selected)
   await new Promise<void>(resolve=>{release=resolve})
   stored=route.request().postDataJSON()
  }
  await route.fulfill({json:snapshot(stored)})
 })
 const panel=await open(page,lang);await choose(panel,lang)
 await panel.getByRole('button',{name:lang==='bg'?'Запази push настройките':'Save push preferences'}).click()
 await expect.poll(()=>requests.includes('PATCH')).toBe(true)
 await expect(page.locator('.profile-draft-note')).toBeVisible()
 release()
 await expect(panel.getByRole('status')).toContainText(lang==='bg'?'запазени':'saved')
 await expect(page.locator('.profile-draft-note')).toHaveCount(0)
 await page.getByRole('tab',{name:lang==='bg'?'Моят профил':'My profile',exact:true}).click()
 await page.getByRole('tab',{name:lang==='bg'?'Push известия':'Push notifications',exact:true}).click()
 await expect(panel.getByLabel(lang==='bg'?'Силни валежи':'Heavy precipitation',{exact:true})).toBeChecked()
 await page.reload();await open(page,lang)
 await expect(panel.getByLabel(lang==='bg'?'Следи избраните градове и категории':'Monitor selected cities and categories')).toBeChecked()
 await expect(panel.getByLabel(lang==='bg'?'Силни валежи':'Heavy precipitation',{exact:true})).toBeChecked()
 await expect(panel.locator('li')).toContainText('Варна')
 await expect(page.locator('.profile-draft-note')).toHaveCount(0)
 expect(requests.filter(method=>method==='PATCH')).toHaveLength(1)
})

for(const failure of ['503','401','403','429','invalid-response','not-written','read-failed','read-mismatch'])test(`push failed save preserves draft: ${failure}`,async({page})=>{
 await fixture(page,'bg')
 let wrote=false
 await page.route('**/api/push',route=>{
  if(route.request().method()==='PATCH'){
   if(/^\d+$/.test(failure))return route.fulfill({status:Number(failure),json:{error:({'503':'PUSH_UNAVAILABLE','401':'INVALID_SESSION','403':'PUSH_FORBIDDEN','429':'PUSH_RATE_LIMITED'} as any)[failure]}})
   if(failure==='invalid-response')return route.fulfill({json:snapshot({...empty,enabled:'true'})})
   wrote=true
   return route.fulfill({json:snapshot(failure==='not-written'?empty:selected)})
  }
  if(wrote&&failure==='read-failed')return route.fulfill({status:503,json:{error:'PUSH_UNAVAILABLE'}})
  return route.fulfill({json:snapshot(empty)})
 })
 const panel=await open(page);await choose(panel)
 await panel.getByRole('button',{name:'Запази push настройките'}).click()
 await expect(panel.getByRole('alert')).toContainText('Записването на Push настройките не е потвърдено')
 await expect(panel.getByRole('status')).toHaveCount(0)
 await expect(page.locator('.profile-draft-note')).toBeVisible()
 await expect(panel.getByLabel('Силни валежи',{exact:true})).toBeChecked()
 await expect(panel.locator('li')).toContainText('Варна')
 await page.getByRole('tab',{name:'Моят профил',exact:true}).click()
 await page.getByRole('tab',{name:'Push известия',exact:true}).click()
 await expect(panel.getByLabel('Силни валежи',{exact:true})).toBeChecked()
})

test('Push draft survives access-token rotation',async({page})=>{
 await fixture(page,'bg')
 let stored:any=empty
 const tokens:string[]=[]
 await page.route('**/api/push',route=>{
  tokens.push(route.request().headers().authorization)
  if(route.request().method()==='PATCH')stored=route.request().postDataJSON()
  return route.fulfill({json:snapshot(stored)})
 })
 const panel=await open(page);await choose(panel)
 await page.evaluate(()=>{
  const key='meteo-pulse-auth',oldValue=localStorage.getItem(key)!,session=JSON.parse(oldValue)
  session.access_token='refreshed-profile-token'
  const newValue=JSON.stringify(session);localStorage.setItem(key,newValue)
  window.dispatchEvent(new StorageEvent('storage',{key,oldValue,newValue}))
 })
 await page.getByRole('tab',{name:'Моят профил',exact:true}).click()
 await page.getByRole('tab',{name:'Push известия',exact:true}).click()
 await expect(panel.getByLabel('Силни валежи',{exact:true})).toBeChecked()
 await expect(panel.locator('li')).toContainText('Варна')
 await expect(page.locator('.profile-draft-note')).toBeVisible()
 await panel.getByRole('button',{name:'Запази push настройките'}).click()
 await expect(panel.getByRole('status')).toContainText('запазени')
 expect(tokens.slice(-2)).toEqual(['Bearer refreshed-profile-token','Bearer refreshed-profile-token'])
})

test('a discarded mount response cannot overwrite confirmed Push preferences',async({page})=>{
 await fixture(page,'bg')
 let stored:any=empty,reads=0,release=()=>{}
 await page.route('**/api/push',async route=>{
  if(route.request().method()==='GET'&&++reads===1){
   await new Promise<void>(resolve=>{release=resolve})
   return route.fulfill({json:snapshot(empty)})
  }
  if(route.request().method()==='PATCH')stored=route.request().postDataJSON()
  return route.fulfill({json:snapshot(stored)})
 })
 const panel=await open(page);await choose(panel)
 await panel.getByRole('button',{name:'Запази push настройките'}).click()
 await expect(panel.getByRole('status')).toContainText('запазени')
 const staleResponse=page.waitForResponse(r=>r.url().endsWith('/api/push')&&r.request().method()==='GET')
 release()
 await staleResponse
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 await expect.poll(()=>reads).toBeGreaterThanOrEqual(3)
 await expect(panel.getByLabel('Силни валежи',{exact:true})).toBeChecked()
 await expect(panel.locator('li')).toContainText('Варна')
 await expect(page.locator('.profile-draft-note')).toHaveCount(0)
})

test('retry after a failed save confirms persisted preferences and clears the warning',async({page})=>{
 await fixture(page,'bg')
 let stored:any=empty,failed=true
 await page.route('**/api/push',route=>{
  if(route.request().method()==='PATCH'){
   if(failed)return route.fulfill({status:503,json:{error:'PUSH_UNAVAILABLE'}})
   const body=route.request().postDataJSON()
   stored={categories:body.categories,cities:body.cities.map((c:any)=>({zone:c.zone,longitude:c.longitude,latitude:c.latitude,name:c.name})),enabled:body.enabled}
  }
  return route.fulfill({json:snapshot(stored)})
 })
 const panel=await open(page);await choose(panel)
 const save=panel.getByRole('button',{name:'Запази push настройките'})
 await save.click();await expect(panel.getByRole('alert')).toBeVisible()
 await expect(page.locator('.profile-draft-note')).toBeVisible()
 failed=false;await save.click()
 await expect(panel.getByRole('status')).toContainText('запазени')
 await expect(panel.getByRole('alert')).toHaveCount(0)
 await expect(page.locator('.profile-draft-note')).toHaveCount(0)
 await page.reload();await open(page)
 await expect(panel.getByLabel('Силни валежи',{exact:true})).toBeChecked()
})
