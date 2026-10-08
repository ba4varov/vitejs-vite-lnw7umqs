import { navigate } from './admin-navigation'
import { test, expect } from '@playwright/test'
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'admin@example.invalid' }
async function setup(page: any, status = 200, signedIn = true) {
  if (signedIn) await page.addInitScript(({ user }) => {
    if (!localStorage.getItem('test-initialized')) {
      localStorage.setItem('test-initialized', 'yes')
      localStorage.setItem('meteo-pulse-auth', JSON.stringify({ access_token: 'test-token', refresh_token: 'test-refresh', expires_at: Math.floor(Date.now()/1000)+3600, user }))
    }
  }, { user })
  await page.route('https://auth.example.invalid/**', route => route.fulfill({ json: {} }))
  await page.route('**/api/admin?**', async route => {
    const url = new URL(route.request().url())
    const action = url.searchParams.get('action')
    if(action?.startsWith('management-')) return route.fulfill({status:503,json:{error:'ADMIN_CONFIGURATION_MISSING'}})
    const data = action === 'stats' ? { total: 21, last7: 2, last30: 5, favorites: 8, free: 20, pro: 1, registrations: Array.from({length:30},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,count:i%3})) }
      : action === 'users' ? { total: url.searchParams.get('search') ? 1 : 21, pageSize:20, users:[{...user, email:url.searchParams.get('page') === '2' ? 'second@example.invalid' : 'first@example.invalid', created_at:'2026-09-01T10:00:00Z', providers:['email'], plan:'free'}] }
      : action === 'system' ? {supabase:'connected',checkedAt:'2026-10-08T10:00:00Z'} : {...user,authorized:true}
    await route.fulfill({status,json:status===200?data:{error:'DENIED'}})
  })
}
test('admin direct open, refresh, users search pagination, profile, logout',async({page})=>{
  await setup(page); await page.goto('/admin'); await expect(page.locator('.admin-stats strong').filter({hasText:/^21$/})).toBeVisible()
  await page.reload(); await expect(page.locator('.admin-stats strong').filter({hasText:/^21$/})).toBeVisible()
  await navigate(page,'Потребители')
  await expect(page.getByRole('button',{name:'first@example.invalid'})).toBeVisible()
  await page.getByRole('button',{name:'Следваща'}).click(); await expect(page.getByRole('button',{name:'second@example.invalid'})).toBeVisible()
  await page.getByRole('searchbox').fill('first'); await expect(page.getByText('Страница 1',{exact:false})).toBeVisible()
  await page.getByRole('button',{name:'first@example.invalid'}).click(); await expect(page.getByRole('heading',{name:'Основна информация'})).toBeVisible()
  await navigate(page,'Администраторски профил'); await expect(page.getByText('Имейл: admin@example.invalid')).toBeVisible()
  await page.getByRole('button',{name:'Изход',exact:true}).click(); await expect(page.getByText('Влез с имейл и парола')).toBeVisible()
  await page.reload(); await expect(page.getByText('Влез с имейл и парола')).toBeVisible()
})
for(const [status,message] of [[403,'Нямаш администраторски права.'],[401,'Сесията е невалидна или е изтекла. Влез отново.'],[503,'Данните не могат да бъдат заредени.']] as const) test(`API ${status} hides administrative data`,async({page})=>{
  await setup(page,status); await page.goto('/admin'); await expect(page.getByText(message)).toBeVisible(); await expect(page.getByText('Регистрирани потребители',{exact:true})).toHaveCount(0)
})
test('anonymous can use existing email password login',async({page})=>{
  await setup(page,200,false); await page.goto('/admin'); await page.getByRole('button',{name:'Вход',exact:true}).click(); await expect(page.getByLabel('Имейл',{exact:true})).toBeVisible(); await expect(page.locator('input[type=password]')).toBeVisible()
})
for(const mobile of [false,true]) test(`BG EN and theme ${mobile?'mobile':'desktop'}`,async({page})=>{
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000}); await setup(page); await page.goto('/admin'); await expect(page.locator('.admin-stats strong').filter({hasText:/^21$/})).toBeVisible()
  await page.screenshot({path:`work/admin-${mobile?'mobile':'desktop'}-bg-light.png`,fullPage:true})
  await page.getByRole('button',{name:'EN',exact:true}).click(); await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Toggle theme'}).click(); await expect(page.locator('.admin-app')).toHaveClass(/admin-dark/)
  await page.screenshot({path:`work/admin-${mobile?'mobile':'desktop'}-en-dark.png`,fullPage:true})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.reload(); await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible(); await expect(page.locator('.admin-app')).toHaveClass(/admin-dark/)
})
for (const allowed of [true,false]) test(`public admin link ${allowed?'visible':'hidden'}`,async({page})=>{
  await setup(page,allowed?200:403); await page.route('https://**/*', route=>route.abort()); await page.goto('/')
  if(allowed) await expect(page.getByRole('link',{name:'Администрация',exact:true})).toBeVisible()
  else { await expect(page.getByRole('button',{name:'Моят профил',exact:true})).toBeVisible(); await expect(page.getByRole('link',{name:'Администрация',exact:true})).toHaveCount(0) }
})
