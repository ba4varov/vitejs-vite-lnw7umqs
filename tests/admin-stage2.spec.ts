import { navigate } from './admin-navigation'
import { test, expect } from '@playwright/test'
const id = '00000000-0000-0000-0000-000000000001'
async function setup(page: any) {
  await page.addInitScript(({id}: any) => localStorage.setItem('meteo-pulse-auth',JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id,email:'admin@example.invalid'}})), {id})
  await page.route('https://auth.example.invalid/**', route => route.fulfill({json:{}}))
  let probes = 0, favoritesStatus = 200
  await page.route('**/api/admin?**', route => {
    const action = new URL(route.request().url()).searchParams.get('action')
    if(action?.startsWith('management-')) return route.fulfill({status:503,json:{error:'ADMIN_CONFIGURATION_MISSING'}})
    if(action==='system') probes++
    const data = action==='users' ? {total:1,pageSize:20,users:[{id,email:'user@example.invalid',display_name:'Тестов потребител',providers:['email','google'],plan:'free',created_at:'2026-10-01T12:00:00Z'}]}
      : action==='favorites' ? [{id:'city-1',name:'София',country:'България'}]
      : action==='system' ? {checks:['supabase','admin','openMeteo'].map(service=>({service,available:probes===1 || service!=='openMeteo',responseMs:123,checkedAt:probes===1?'2026-10-08T10:00:00Z':'2026-10-08T10:10:00Z',problem:probes>1 && service==='openMeteo'?'CHECK_FAILED':null}))}
      : action==='stats' ? {total:1,last7:1,last30:1,favorites:1,free:1,pro:0,registrations:[]}
      : {authorized:true,id,email:'admin@example.invalid'}
    return route.fulfill({status:action==='favorites'?favoritesStatus:200,json:data})
  })
  return {probes:()=>probes, failFavorites:(status:number)=>{favoritesStatus=status}}
}
for(const width of [320,390,768,1440]) test(`profiles and health at ${width}px`,async({page,context})=>{
  await page.setViewportSize({width,height:1000}); const state = await setup(page)
  await context.grantPermissions(['clipboard-read','clipboard-write'])
  await page.goto('/admin'); await navigate(page,'Потребители')
  await page.getByRole('button',{name:'user@example.invalid'}).click()
  await expect(page.locator('.admin-detail')).toContainText('София')
  await expect(page.locator('.admin-detail')).toContainText('Безплатен план')
  await expect(page.locator('.admin-detail')).toContainText('Google акаунт')
  const geometry=await page.getByRole('searchbox').boundingBox(); const title=await page.getByRole('heading',{name:'Потребители',exact:true}).boundingBox()
  expect(geometry!.y).toBeGreaterThan(title!.y)
  await expect(page.locator('.admin-detail code')).not.toBeVisible()
  await page.locator('.admin-detail summary').click(); await expect(page.locator('.admin-detail code')).toHaveText(id)
  await page.getByRole('button',{name:'Копирай UUID'}).click(); await expect(page.getByText('Копирано',{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(id)
  await page.screenshot({path:`work/stage5-regressions/admin-stage2-screenshots/users-${width}-bg-light.png`,fullPage:true})
  await page.getByRole('button',{name:'EN',exact:true}).click(); await page.getByRole('button',{name:'Toggle theme'}).click()
  await expect(page.locator('.admin-detail')).toContainText('Free plan'); await expect(page.locator('.admin-detail')).toContainText('Google account')
  await page.screenshot({path:`work/stage5-regressions/admin-stage2-screenshots/users-${width}-en-dark.png`,fullPage:true})
  await navigate(page,'System status')
  await expect(page.locator('.admin-health')).toHaveCount(3)
  await expect(page.getByText('Service is available',{exact:true})).toHaveCount(3)
  expect(state.probes()).toBe(1)
  await page.getByRole('button',{name:'БГ',exact:true}).click(); await page.getByRole('button',{name:'Смени темата'}).click()
  expect(state.probes()).toBe(1)
  await page.screenshot({path:`work/stage5-regressions/admin-stage2-screenshots/system-${width}-bg-light.png`,fullPage:true})
  await page.getByRole('button',{name:'Провери отново'}).click(); await expect(page.getByText('Установен проблем',{exact:true})).toBeVisible()
  const openMeteo=page.locator('.admin-health').filter({has:page.getByRole('heading',{name:'Open-Meteo',exact:true})})
  await expect(openMeteo).toContainText('123 ms'); await expect(openMeteo.locator('dd').last()).toContainText('10:00')
  expect(state.probes()).toBe(2)
  await page.getByRole('button',{name:'EN',exact:true}).click(); await page.getByRole('button',{name:'Toggle theme'}).click()
  await page.screenshot({path:`work/stage5-regressions/admin-stage2-screenshots/system-${width}-en-dark.png`,fullPage:true})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.evaluate(() => {
    const oldValue = localStorage.getItem('meteo-pulse-auth')!
    const session = JSON.parse(oldValue)
    session.access_token = 'rotated-test-token'
    const newValue = JSON.stringify(session)
    localStorage.setItem('meteo-pulse-auth',newValue)
    window.dispatchEvent(new StorageEvent('storage',{key:'meteo-pulse-auth',oldValue,newValue,storageArea:localStorage}))
  })
  await expect(page.locator('.admin-health')).toHaveCount(3)
  expect(state.probes()).toBe(2)
  // Virtual time catches timers without waiting in real time.
  await page.clock.install(); await page.clock.fastForward(120000); expect(state.probes()).toBe(2)
})
for(const status of [503,403,401]) test(`favorites failure ${status}`,async({page})=>{
  const state=await setup(page);state.failFavorites(status);await page.goto('/admin')
  await navigate(page,'Потребители');await page.getByRole('button',{name:'user@example.invalid'}).click()
  if(status===503) await expect(page.getByText('Любимите градове не могат да бъдат заредени.',{exact:false})).toBeVisible()
  else { await expect(page.locator('.admin-detail')).toHaveCount(0);await expect(page.getByText(status===403?'Нямаш администраторски права.':'Сесията е невалидна или е изтекла. Влез отново.')).toBeVisible() }
})
