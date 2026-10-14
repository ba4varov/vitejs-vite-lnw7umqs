import { test, expect, type Page } from '@playwright/test'
import { fixture } from './profile-fixture'
import { clickHeaderControl } from './header-navigation'

test.describe.configure({ mode: 'parallel' })

const account = '00000000-0000-0000-0000-000000000002'
const sofia = { id: '00000000-0000-0000-0000-000000000010', name: 'Sofia', latitude:42.6977, longitude:23.3219, geoname_id:null,country_code:null,admin1_id:null }
const varna = {...sofia,id:'00000000-0000-0000-0000-000000000011',name:'Varna',latitude:43.2167,longitude:27.9167}
async function setup(page:Page,lang:'bg'|'en',width:number) {
  await page.setViewportSize({width,height:1000})
  await fixture(page,lang,'free',true)
  const state={rows:[sofia,varna],defaultId:varna.id as string|null,failure:null as null|{source:string,status?:number,code?:string,body?:any,network?:boolean},calls:[] as string[],}
  await page.route('**/rest/v1/**',async route=>{
    const url=new URL(route.request().url()),source=url.pathname.split('/').at(-1)!,method=route.request().method()
    state.calls.push(`${method}:${source}`)
    const rows=structuredClone(state.rows),defaultId=state.defaultId
    if(state.failure?.source===source){const f=state.failure;if(f.network)return route.abort('failed');return route.fulfill({status:f.status||200,json:f.body!==undefined?f.body:{code:f.code,message:'sensitive backend message email token'}})}
    if(method==='DELETE'){state.rows=state.rows.filter(p=>p.id!==url.searchParams.get('id')?.slice(3));if(state.defaultId===url.searchParams.get('id')?.slice(3))state.defaultId=null;return route.fulfill({json:[]})}
    if(method==='POST' && source==='favorite_places'){const body=route.request().postDataJSON();const saved={...body,id:body.latitude===varna.latitude?varna.id:sofia.id};state.rows.push(saved);return route.fulfill({json:[saved]})}
    if(source==='set_my_default_place'){state.defaultId=route.request().postDataJSON().place_id;return route.fulfill({status:204})}
    if(method==='PATCH')return route.fulfill({json:[]})
    return route.fulfill({json:source==='favorite_places'?rows:[{default_place_id:defaultId}]})
  })
  await page.reload()
  await expect(page.locator('.place-chip')).toHaveCount(2)
  return state
}
for(const width of [390,1440])for(const lang of ['bg','en'] as const){
  test(`successful defaults, remove/add, language, logout/login ${width} ${lang}`,async({page})=>{
    const state=await setup(page,lang,width)
    const chips=page.locator('.place-chip')
    await expect(chips.nth(1).locator('.default-place')).toHaveAttribute('aria-pressed','true')
    await expect(chips.nth(1).locator('.place-select')).toHaveAttribute('aria-pressed','true')
    await chips.first().locator('.place-select').click()
    await page.locator('.star-btn').click();await expect(chips).toHaveCount(1)
    await page.locator('.star-btn').click();await expect(chips).toHaveCount(2)
    await chips.last().locator('.default-place').click()
    await expect(chips.last().locator('.default-place')).toHaveAttribute('aria-pressed','true')
    expect(state.defaultId).toBe(sofia.id)
    await clickHeaderControl(page,page.locator('.lang-btn'));await expect(chips).toHaveCount(2)
    await page.evaluate(()=>{localStorage.removeItem('meteo-pulse-auth');window.dispatchEvent(new StorageEvent('storage',{key:'meteo-pulse-auth'}))})
    await expect(chips).toHaveCount(0)
    await page.evaluate(account=>{localStorage.setItem('meteo-pulse-auth',JSON.stringify({access_token:'new',refresh_token:'refresh-new',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:account}}));window.dispatchEvent(new StorageEvent('storage',{key:'meteo-pulse-auth'}))},account)
    await expect(chips).toHaveCount(2);await expect(page.locator('.places-error')).toHaveCount(0)
  })
  for(const failure of [{source:'favorite_places',status:403,code:'42501'},{source:'place_settings',status:404,code:'PGRST205'},{source:'favorite_places',status:400,code:'42703'},{source:'place_settings',status:503},{source:'favorite_places',network:true},{source:'favorite_places',body:null},{source:'place_settings',body:[{}]}]){
    test(`failure and retry ${width} ${lang} ${JSON.stringify(failure)}`,async({page})=>{
      const state=await setup(page,lang,width);state.failure=failure;await page.reload()
      const error=page.locator('.places-error');await expect(error).toBeVisible()
      await expect(error).toContainText(lang==='bg'?'Местата не можаха':'Places could not')
      await expect(error).not.toContainText('sensitive')
      state.failure=null;await error.getByRole('button').click()
      await expect(page.locator('.place-chip')).toHaveCount(2);await expect(error).toHaveCount(0)
    })
  }
  test(`expired token refresh and single 401 recovery ${width} ${lang}`,async({page})=>{
    const state=await setup(page,lang,width)
    let refreshes=0
    await page.route('**/auth/v1/token**',r=>{refreshes++;return r.fulfill({json:{access_token:`fresh-${refreshes}`,refresh_token:`refresh-${refreshes}`,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:account}}})})
    await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('meteo-pulse-auth')!);s.expires_at=1;localStorage.setItem('meteo-pulse-auth',JSON.stringify(s))})
    await page.reload();await expect(page.locator('.place-chip')).toHaveCount(2);expect(refreshes).toBe(1)
    state.failure={source:'favorite_places',status:401,code:'PGRST301'}
    await page.reload();await expect(page.locator('.places-error')).toBeVisible();expect(refreshes).toBe(2)
    state.failure=null;await page.locator('.places-error button').click();await expect(page.locator('.place-chip')).toHaveCount(2)
  })
  test(`empty list is successful ${width} ${lang}`,async({page})=>{
    const state=await setup(page,lang,width);state.rows=[];state.defaultId=null;await page.reload()
    await expect(page.locator('.place-chip')).toHaveCount(0);await expect(page.locator('.places-error')).toHaveCount(0)
    await expect(page.locator('.places-empty')).toBeVisible()
  })
}
test('late account response cannot replace new account; manual selection wins pending default',async({page})=>{
  await setup(page,'en',1440)
  let release!:()=>void
  const waiting=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/rest/v1/favorite_places?**',async r=>{await waiting;await r.fulfill({json:[sofia,varna]})})
  await page.reload();await page.locator('.city-row .city-btn').first().click()
  release();await expect(page.locator('.place-chip')).toHaveCount(2)
  await expect(page.locator('.place-chip').nth(1).locator('.place-select')).toHaveAttribute('aria-pressed','false')
  await page.unroute('**/rest/v1/favorite_places?**')
  let finish!:()=>void
  const pending=new Promise<void>(resolve=>{finish=resolve})
  await page.route('**/rest/v1/favorite_places?**',async r=>{const old=r.request().headers().authorization==='Bearer profile-test-token';if(old)await pending;await r.fulfill({json:old?[sofia,varna]:[sofia]})})
  await page.reload()
  await page.evaluate(()=>{localStorage.setItem('meteo-pulse-auth',JSON.stringify({access_token:'other-account',refresh_token:'other-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'other'}}));window.dispatchEvent(new StorageEvent('storage',{key:'meteo-pulse-auth'}))})
  await expect(page.locator('.place-chip')).toHaveCount(1);finish()
  await expect(page.locator('.place-chip')).toHaveCount(1)
})

test('failed reload keeps last valid favorites and default; retry is disabled while pending',async({page})=>{
  const state=await setup(page,'en',1440)
  state.failure={source:'set_my_default_place',status:503}
  await page.locator('.place-chip').first().locator('.default-place').click()
  await expect(page.locator('.places-error')).toBeVisible()
  state.failure={source:'place_settings',status:403,code:'42501'}
  await page.locator('.places-error button').click()
  await expect(page.locator('.places-error')).toContainText('denied')
  await expect(page.locator('.place-chip')).toHaveCount(2)
  await expect(page.locator('.place-chip').nth(1).locator('.default-place')).toHaveAttribute('aria-pressed','true')
  let release!:()=>void
  const pending=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/rest/v1/place_settings?**',async r=>{await pending;await r.fulfill({json:[{default_place_id:varna.id}]})})
  state.failure=null
  await page.locator('.places-error button').click()
  await expect(page.locator('.places-error button')).toBeDisabled()
  await expect(page.locator('.places-error')).toBeVisible()
  await clickHeaderControl(page,page.locator('.lang-btn'))
  await expect(page.locator('.places-error')).toContainText('Местата не можаха')
  release();await expect(page.locator('.places-error')).toHaveCount(0)
  await expect(page.locator('.place-chip')).toHaveCount(2)
})

test('expired refresh failure retains session and exposes retry; revoked session returns to guest',async({page})=>{
  await setup(page,'en',1440)
  await page.route('**/auth/v1/token**',r=>r.fulfill({status:503,json:{message:'private'}}))
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('meteo-pulse-auth')!);s.expires_at=1;localStorage.setItem('meteo-pulse-auth',JSON.stringify(s))})
  await page.reload();await expect(page.locator('.places-error')).toContainText('session')
  expect(await page.evaluate(()=>localStorage.getItem('meteo-pulse-auth'))).not.toBeNull()
  await page.route('**/auth/v1/token**',r=>r.fulfill({json:{access_token:'recovered',refresh_token:'new-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:account}}}))
  await page.locator('.places-error button').click();await expect(page.locator('.place-chip')).toHaveCount(2)
  await page.route('**/auth/v1/token**',r=>r.fulfill({status:400,json:{error_code:'refresh_token_not_found'}}))
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('meteo-pulse-auth')!);s.expires_at=1;localStorage.setItem('meteo-pulse-auth',JSON.stringify(s))})
  await page.reload();await expect(page.locator('.place-chip')).toHaveCount(0)
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('meteo-pulse-auth'))).toBeNull()
  await expect(page.locator('.places-error')).toHaveCount(0)
})

test('401 refresh recovers automatically without losing default',async({page})=>{
  await setup(page,'en',1440)
  let refreshes=0
  await page.route('**/auth/v1/token**',r=>{refreshes++;return r.fulfill({json:{access_token:'fresh',refresh_token:'rotated',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:account}}})})
  await page.route('**/rest/v1/favorite_places?**',r=>r.request().headers().authorization==='Bearer fresh'
    ?r.fulfill({json:[sofia,varna]}):r.fulfill({status:401,json:{code:'PGRST301'}}))
  await page.reload();await expect.poll(() => refreshes).toBe(1)
  await expect(page.locator('.place-chip')).toHaveCount(2)
  await expect(page.locator('.place-chip').nth(1).locator('.default-place')).toHaveAttribute('aria-pressed','true')
  await expect(page.locator('.places-error')).toHaveCount(0);expect(refreshes).toBe(1)
})

test('expired initial load waits for slow refresh and recovers for same account',async({page})=>{
  await setup(page,'en',1440)
  await page.route('**/auth/v1/token**',async r=>{await new Promise(resolve=>setTimeout(resolve,300));await r.fulfill({json:{access_token:'fresh',refresh_token:'rotated',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:account}}})})
  await page.route('**/rest/v1/favorite_places?**',r=>r.request().headers().authorization==='Bearer fresh'
    ?r.fulfill({json:[sofia,varna]}):r.fulfill({status:401,json:{code:'PGRST301'}}))
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('meteo-pulse-auth')!);s.expires_at=1;localStorage.setItem('meteo-pulse-auth',JSON.stringify(s))})
  await page.reload();await expect(page.locator('.place-chip')).toHaveCount(2)
  await expect(page.locator('.places-error')).toHaveCount(0)
})

test('incomplete add response cannot insert an invalid favorite into client state',async({page})=>{
  const state=await setup(page,'en',1440)
  await page.locator('.star-btn').click();await expect(page.locator('.place-chip')).toHaveCount(1)
  state.failure={source:'favorite_places',body:[{}]}
  await page.locator('.star-btn').click()
  await expect(page.locator('.places-error')).toContainText('incomplete')
  await expect(page.locator('.place-chip')).toHaveCount(1)
  state.failure=null;await page.locator('.places-error button').click()
  await expect(page.locator('.places-error')).toHaveCount(0)
  await page.locator('.star-btn').click();await expect(page.locator('.place-chip')).toHaveCount(2)
})
