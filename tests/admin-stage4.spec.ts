import { navigate } from './admin-navigation'
import { test, expect } from '@playwright/test'
const admin='00000000-0000-0000-0000-000000000001', target='00000000-0000-0000-0000-000000000002'
async function setup(page:any, options:{missing?:boolean,protected?:boolean,failure?:number,uncertain?:boolean}={}) {
 await page.addInitScript(({admin}:any)=>localStorage.setItem('meteo-pulse-auth',JSON.stringify({access_token:'isolated-test-token',refresh_token:'isolated-test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:admin,email:'admin@example.invalid'}})),{admin})
 await page.route('https://auth.example.invalid/**',(r:any)=>r.fulfill({json:{}}))
 let plan='free', calls:any[]=[], reads:string[]=[], filters:any[]=[]
 const profileReads:string[]=[]
 const history:any[]=[{id:0,admin_id:admin,action:'user_details_view',occurred_at:'2026-10-08T11:00:00Z',outcome:'success'}]
 const user=()=>({id:target,email:'isolated-user@example.invalid',display_name:'Изолиран тест / Isolated test',created_at:'2026-10-01T12:00:00Z',last_sign_in_at:'2026-10-08T09:00:00Z',providers:['email','google'],plan,blocked:false})
 await page.route('**/api/admin?**',async(r:any)=>{
  const q=new URL(r.request().url()).searchParams, action=q.get('action');reads.push(action!)
  if(action?.startsWith('management-') && options.missing) return r.fulfill({status:503,json:{error:'ADMIN_CONFIGURATION_MISSING'}})
  if(action==='users' && q.get('id')) profileReads.push('user_details_view')
  if(action==='management-account') profileReads.push('user_management_view')
  if(action==='favorites') profileReads.push('user_favorites_view')
  if(action==='management-users') filters.push(Object.fromEntries(q))
  const json=action==='access'?{id:admin,email:'admin@example.invalid',authorized:true}
   : action==='stats'?{total:3,last7:1,last30:2,free:plan==='free'?3:2,pro:plan==='pro'?1:0,favorites:1,registrations:[]}
   : ['users','management-users'].includes(action!)?{users:q.get('plan') && q.get('plan')!==plan?[]:[user()],total:q.get('plan') && q.get('plan')!==plan?0:1,pageSize:20}
   : action==='favorites'?[{id:'isolated-city',name:'София',country:'България'}]
   : action==='management-account'?{id:target,plan,blocked:false,isAdmin:false,manualPro:plan==='pro',canManagePlan:!options.protected,history:[...history]}
   : action==='management-summary'?{blocked:0,asOf:'2026-10-08T12:00:00Z',entries:history.map(e=>({...e,object_id:target}))}
   : action==='audit'?{entries:history.map(e=>({...e,object_id:target})),total:history.length,pageSize:20}
   : {}
  return r.fulfill({json})
 })
 await page.route('**/api/admin-management',async(r:any)=>{
  const b=r.request().postDataJSON();calls.push(b)
  if(options.failure) return r.fulfill({status:options.failure,json:{error:options.failure===403?'FORBIDDEN':'ADMIN_UNAVAILABLE'}})
  if(options.uncertain && calls.length===1) return r.fulfill({status:503,json:{error:'RESULT_UNCONFIRMED'}})
  plan=b.plan;history.unshift({id:calls.length,admin_id:admin,action:plan==='pro'?'manual_pro_grant':'free_restore',occurred_at:'2026-10-08T12:00:00Z',outcome:'success',previous_value:b.expectedPlan,new_value:b.plan})
  await new Promise(resolve=>setTimeout(resolve,150))
  return r.fulfill({json:{confirmed:true,plan,changedAt:'2026-10-08T12:00:00Z'}})
 })
 return {calls,reads,filters,profileReads}
}
async function openUser(page:any) {await page.goto('/admin');await navigate(page,'Потребители');await page.getByRole('button',{name:'isolated-user@example.invalid'}).click();await expect(page.getByRole('button',{name:'Предостави ръчно Pro'})).toBeVisible()}
test('one profile open performs exactly one identity, management and favorites read; reopening is audited again',async({page})=>{
 const state=await setup(page);await openUser(page);await expect(page.locator('.admin-detail')).toContainText('София')
 expect([...state.profileReads].sort()).toEqual(['user_details_view','user_favorites_view','user_management_view'])
 await page.getByRole('button',{name:'EN',exact:true}).click();await page.getByRole('button',{name:'Toggle theme'}).click()
 expect(state.profileReads).toHaveLength(3)
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'isolated-user@example.invalid'}).click();await expect(page.getByRole('button',{name:'Grant manual Pro'})).toBeVisible();await expect(page.locator('.admin-detail')).toContainText('София')
 expect([...state.profileReads].sort()).toEqual(['user_details_view','user_details_view','user_favorites_view','user_favorites_view','user_management_view','user_management_view'])
 await navigate(page,'Action log');await page.getByRole('combobox',{name:'Action',exact:true}).selectOption('user_management_view')
})
test('confirmed changes refresh list, details, history and audit; cancellation and double-click are safe',async({page})=>{
 const state=await setup(page);await openUser(page)
 await expect(page.getByRole('button',{name:'Временно блокирай акаунта'})).toBeDisabled()
 await page.getByRole('button',{name:'Предостави ръчно Pro'}).click();await expect(page.getByRole('dialog')).toContainText('Безплатен план → Pro план')
 await page.getByRole('button',{name:'Отказ',exact:true}).click();expect(state.calls).toHaveLength(0)
 await page.getByRole('button',{name:'Предостави ръчно Pro'}).click();await page.getByRole('button',{name:'Потвърди',exact:true}).dblclick()
 await expect(page.getByText('Промяната на плана е потвърдена. Данните са обновени.')).toBeVisible();expect(state.calls).toHaveLength(1)
 await expect(page.locator('tbody')).toContainText('Pro план')
 await page.getByRole('button',{name:'isolated-user@example.invalid'}).click();await expect(page.locator('.admin-management')).toContainText('Ръчно предоставен Pro')
 await expect(page.locator('.admin-history')).toContainText('Ръчно предоставяне на Pro')
 await page.getByRole('button',{name:'Върни към Free'}).click();await page.getByRole('button',{name:'Потвърди',exact:true}).click()
 await expect(page.locator('tbody')).toContainText('Безплатен план');expect(state.calls).toHaveLength(2)
 await navigate(page,'Журнал на действията');await page.getByRole('combobox',{name:'Действие'}).selectOption('manual_pro_grant')
 await expect(page.locator('.admin-audit-table')).toContainText('Ръчно предоставяне на Pro')
})
test('unconfirmed retry reuses request identifier and does not invent success',async({page})=>{
 const state=await setup(page,{uncertain:true});await openUser(page);await page.getByRole('button',{name:'Предостави ръчно Pro'}).click();await page.getByRole('button',{name:'Потвърди',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Резултатът не е потвърден');await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Потвърди',exact:true}).click()
 await expect(page.locator('tbody')).toContainText('Pro план');expect(state.calls[0].requestId).toBe(state.calls[1].requestId)
})
test('missing migration preserves old functions and hides new mutations',async({page})=>{await setup(page,{missing:true});await page.goto('/admin');await expect(page.locator('.admin-stats strong').first()).toHaveText('3');await expect(page.getByText('Етап 4 още не е активиран.',{exact:false})).toBeVisible();await navigate(page,'Потребители');await page.getByRole('button',{name:'isolated-user@example.invalid'}).click();await expect(page.locator('.admin-detail')).toContainText('София');await expect(page.getByRole('button',{name:'Предостави ръчно Pro'})).toHaveCount(0)})
test('provider-protected subscription cannot be changed',async({page})=>{await setup(page,{protected:true});await openUser(page);await expect(page.getByRole('button',{name:'Предостави ръчно Pro'})).toBeDisabled()})
for(const status of [401,403,503])test(`mutation failure ${status} never shows success`,async({page})=>{await setup(page,{failure:status});await openUser(page);await page.getByRole('button',{name:'Предостави ръчно Pro'}).click();await page.getByRole('button',{name:'Потвърди',exact:true}).click();if(status===401||status===403){await expect(page.locator('.admin-management')).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0)}else await expect(page.getByRole('alert')).toContainText('Резултатът не е потвърден');await expect(page.getByText('Промяната на плана е потвърдена. Данните са обновени.')).toHaveCount(0)})
test('empty registration data has a compact explanation without a blank chart',async({page})=>{await setup(page);await page.goto('/admin');await expect(page.getByText('Няма данни.',{exact:true})).toBeVisible();await expect(page.locator('.admin-chart')).toHaveCount(0)})
test('filters reach API and no periodic probes run',async({page})=>{const state=await setup(page);await openUser(page);await page.getByRole('combobox',{name:'Статус на достъпа',exact:true}).selectOption('active');await page.getByRole('combobox',{name:'План',exact:true}).selectOption('free');await page.getByLabel('Регистрация от (UTC)').fill('2026-10-01');await page.getByLabel('Регистрация до (UTC)').fill('2026-10-08');await expect.poll(()=>state.filters.at(-1)?.to).toBe('2026-10-08');expect(state.filters.at(-1)).toMatchObject({status:'active',plan:'free',from:'2026-10-01',to:'2026-10-08'});await page.clock.install();const count=state.reads.length;await page.clock.fastForward(120000);expect(state.reads.length).toBe(count)})
for(const width of [320,390,768,1440])for(const lang of ['bg','en'])for(const dark of [false,true])test(`isolated Chromium screenshot ${width} ${lang} ${dark?'dark':'light'}`,async({page})=>{
 await page.setViewportSize({width,height:1000});await setup(page);await openUser(page)
 if(lang==='en') await page.getByRole('button',{name:'EN',exact:true}).click()
 if(dark) await page.getByRole('button',{name:lang==='bg'?'Смени темата':'Toggle theme'}).click()
 await expect(page.locator('.admin-management')).toContainText(lang==='bg'?'История за този акаунт':'Account history')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:`work/stage5-regressions/admin-stage4-screenshots/users-${width}-${lang}-${dark?'dark':'light'}.png`,fullPage:true})
 await page.getByRole('button',{name:lang==='bg'?'Предостави ръчно Pro':'Grant manual Pro'}).click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('button',{name:lang==='bg'?'Отказ':'Cancel',exact:true})).toBeFocused()
 await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:lang==='bg'?'Потвърди':'Confirm',exact:true})).toBeFocused()
 if(width===390||width===1440) await page.screenshot({path:`work/stage5-regressions/admin-stage4-screenshots/confirm-${width}-${lang}-${dark?'dark':'light'}.png`,fullPage:true})
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible()
 await navigate(page,lang==='bg'?'Начално табло':'Dashboard');await expect(page.getByRole('heading',{name:lang==='bg'?'Състояние и последни действия':'Status and recent actions'})).toBeVisible();await expect(page.getByText(lang==='bg'?'Акаунти с активно Auth блокиране:':'Accounts with an active Auth ban:',{exact:false})).toBeVisible()
 await page.screenshot({path:`work/stage5-regressions/admin-stage4-screenshots/dashboard-${width}-${lang}-${dark?'dark':'light'}.png`,fullPage:true})
})
