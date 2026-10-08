import { test, expect } from '@playwright/test'
const id='00000000-0000-0000-0000-000000000001'
async function setup(page:any, status=200, empty=false, missing=true) {
 await page.addInitScript(({id}:any)=>localStorage.setItem('meteo-pulse-auth',JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id,email:'admin@example.invalid'}})),{id})
 await page.route('https://auth.example.invalid/**',(r:any)=>r.fulfill({json:{}}))
 const calls:string[]=[]
 await page.route('**/api/admin?**',(r:any)=>{
  const q=new URL(r.request().url()).searchParams; const action=q.get('action')!;calls.push(action)
  const period=q.get('period')||'30'
  const n=period==='12m'?12:Number(period)
  const body=action==='analytics'?{period,total:3,last7:1,last30:2,login7:1,login30:2,noLogin30:1,free:2,pro:1,unknownPlan:0,favorites:3,uniqueCities:2,
   buckets:Array.from({length:n},(_,i)=>({date:period==='12m'?`2026-${String(i+1).padStart(2,'0')}-01`:`2026-10-${String(i+1).padStart(2,'0')}`,registrations:empty?0:i%3,last_logins:empty?0:i%2})),cities:empty?[]:[{name:'София / Sofia',region:'Sofia',country:'BG',latitude_key:42.6977,longitude_key:23.3219,count:2},{name:'Paris',country:'FR',latitude_key:48.8566,longitude_key:2.3522,count:1}]}
  :action==='audit'?{total:empty?0:1,pageSize:20,entries:empty?[]:[{id:1,occurred_at:'2026-10-08T10:00:00Z',admin_id:id,action:q.get('filter')||'user_details_view',object_id:id,outcome:'success'}]}
  :action==='stats'?{total:3,last7:1,last30:2,favorites:3,free:2,pro:1,registrations:[]}
  :{authorized:true,id,email:'admin@example.invalid'}
  return r.fulfill({status:['analytics','audit'].includes(action)?status:200,json:status===503&&missing&&['analytics','audit'].includes(action)?{error:'ADMIN_CONFIGURATION_MISSING'}:body})
 });return calls
}
for(const width of [320,390,768,1440]) for(const lang of ['bg','en']) for(const theme of ['light','dark']) test(`stage3 ${width} ${lang} ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:1000});const calls=await setup(page);await page.goto('/admin')
 await expect(page.getByText('Supabase: Свързан',{exact:true})).toBeVisible()
 if(lang==='en')await page.getByRole('button',{name:'EN',exact:true}).click()
 if(theme==='dark')await page.getByRole('button',{name:lang==='bg'?'Смени темата':'Toggle theme'}).click()
 await page.getByRole('button',{name:lang==='bg'?'Статистики':'Statistics',exact:true}).click()
 await expect(page.locator('.admin-metric-chart')).toHaveCount(4)
 const bar=page.locator('.admin-metric-chart').first().getByRole('button').first();await bar.focus();await page.keyboard.press('Enter');await expect(bar).toHaveAttribute('aria-pressed','true')
 await page.getByLabel(lang==='bg'?'Период':'Period',{exact:true}).selectOption('12m')
 await expect(page.locator('.admin-metric-chart').first().getByRole('button')).toHaveCount(12)
 await page.screenshot({path:`docs/admin-stage3-screenshots/statistics-${width}-${lang}-${theme}.png`,fullPage:true})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.getByRole('button',{name:lang==='bg'?'Журнал на действията':'Action log',exact:true}).click()
 await expect(page.locator('tbody tr')).toHaveCount(1)
 await page.getByLabel(lang==='bg'?'Действие':'Action',{exact:true}).selectOption('user_favorites_view')
 await expect(page.locator('tbody')).toContainText(lang==='bg'?'Преглед на любими градове':'View favorite cities')
 await page.screenshot({path:`docs/admin-stage3-screenshots/audit-${width}-${lang}-${theme}.png`,fullPage:true})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 const count=calls.length;await page.clock.install();await page.clock.fastForward(120000);expect(calls.length).toBe(count)
})
for(const status of [401,403,503])test(`stage3 failure ${status}`,async({page})=>{
 await setup(page,status);await page.goto('/admin');await page.getByRole('button',{name:'Статистики',exact:true}).click()
 await expect(page.getByText(status===401?'Сесията е невалидна или е изтекла. Влез отново.':status===403?'Нямаш администраторски права.':'Липсва конфигурация за етап 3.',{exact:false})).toBeVisible()
 await expect(page.locator('.admin-metric-chart')).toHaveCount(0)
 if(status===503){await page.getByRole('button',{name:'Начално табло',exact:true}).click();await expect(page.getByText('Supabase: Свързан',{exact:true})).toBeVisible()}
})
test('empty locations and audit',async({page})=>{await setup(page,200,true);await page.goto('/admin');await page.getByRole('button',{name:'Статистики',exact:true}).click();await expect(page.getByText('Няма данни.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Журнал на действията',exact:true}).click();await expect(page.getByText('Няма журнални записи за този филтър.')).toBeVisible()})

test('generic server error has retry and no invented statistics',async({page})=>{await setup(page,503,false,false);await page.goto('/admin');await page.getByRole('button',{name:'Статистики',exact:true}).click();await expect(page.getByText('Данните не могат да бъдат заредени.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Опитай отново'})).toBeVisible();await expect(page.locator('.admin-metric-chart')).toHaveCount(0)})
