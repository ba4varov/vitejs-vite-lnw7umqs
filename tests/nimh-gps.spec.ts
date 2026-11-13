import {test,expect} from '@playwright/test'
import {weather} from './forecast-order-fixture'

async function setup(page:any,{accuracy=500,saved='',permission='granted',stalled=false,admin=true,municipality=true,unavailable=false}={}) {
 await page.clock.install({time:new Date('2026-11-13T12:00:00Z')})
 await page.addInitScript(({saved,permission}:any)=>{
  localStorage.setItem('meteoPulseLanguage','bg')
  if(saved)localStorage.setItem('meteoPulseConfirmedLocationV1',JSON.stringify({name:'Старо място',lat:43.2,lon:27.9,source:saved,accuracy:25,...(saved==='manual'?{geonameId:726050}:{})}))
  Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:permission})}})
  Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:(success:any,error:any)=>{(window as any).fix=()=>permission==='denied'?error({code:1}):success({coords:{latitude:43.18,longitude:27.45,accuracy:(window as any).accuracy}})}}})
 },{saved,permission})
 await page.addInitScript(value=>{(window as any).accuracy=value},accuracy)
 const queries:string[]=[]
 await page.route('**/*',async(route:any)=>{
  const u=new URL(route.request().url())
  if(u.hostname==='nominatim.openstreetmap.org'&&stalled)return
  if(u.hostname==='nominatim.openstreetmap.org')return route.fulfill({status:unavailable?503:200,json:{address:{city:'Варна',...(admin?{country_code:'bg','ISO3166-2-lvl4':'BG-03'}:{}),...(municipality?{municipality:'Община Провадия'}:{})}}})
  if(u.pathname==='/api/alerts'&&u.searchParams.get('source')==='nimh'){
   queries.push(u.search)
   const municipal=u.searchParams.has('municipality')
   return route.fulfill({json:{coverage:municipal?'municipality':'district',days:[{date:'2026-11-13',status:'verified',checkedAt:Date.parse('2026-11-13T12:00:00Z'),warnings:[{scope:'district',level:'orange',area:'Варна',date:'2026-11-13'},...(municipal?[{scope:'municipality',level:'yellow',area:'Провадия',date:'2026-11-13'}]:[])]}]}})
  }
  if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/'))return route.continue()
  return route.fulfill({json:u.hostname==='api.open-meteo.com'?weather:{}})
 })
 await page.goto('/')
 const fix=async()=>{await expect.poll(()=>page.evaluate(()=>typeof (window as any).fix)).toBe('function');await page.evaluate(()=>(window as any).fix())}
 return {fix,queries,section:page.locator('.official-warnings')}
}
for(const accuracy of [25,100,101,500,1000,1001,3000])test(`initial GPS accuracy ${accuracy}`,async({page})=>{
 const s=await setup(page,{accuracy});await s.fix()
 if(accuracy<=1000){await expect(s.section.locator('article')).toHaveCount(accuracy<=100?2:1);expect(s.queries.some(q=>q.includes('region=VAR'))).toBe(true)}
 else {await expect(s.section).toContainText('точност');expect(s.queries).toHaveLength(0)}
})
for(const variant of ['missing','unavailable','no municipality'])test(`GPS ${variant}`,async({page})=>{
 const s=await setup(page,{accuracy:25,admin:variant!=='missing',unavailable:variant==='unavailable',municipality:variant!=='no municipality'});await s.fix()
 if(variant==='no municipality'){await expect(s.section.locator('article')).toHaveCount(1);await expect(s.section).toContainText('само областта')}
 else await expect(s.section).toContainText(variant==='missing'?'административни':'недостъпна')
})
test('manual restoration stays manual; GPS → manual → GPS uses requested fix',async({page})=>{
 const s=await setup(page,{saved:'manual',accuracy:25});await expect(s.section).toBeVisible();expect(await page.evaluate(()=>typeof (window as any).fix)).toBe('undefined')
 await page.locator('.location-btn').click();await s.fix();await expect(s.section).toContainText('Община: Провадия')
 await page.getByRole('button',{name:'София',exact:true}).click();await expect(s.section).not.toContainText('Община: Провадия')
 await page.locator('.location-btn').click();await s.fix();await expect(s.section).toContainText('Община: Провадия')
})
test('restored GPS gets fresh administrative evidence',async({page})=>{
 const s=await setup(page,{saved:'geolocation',accuracy:25});await s.fix();await expect(s.section).toContainText('Община: Провадия')
})
test('denied GPS preserves saved selection and explains failure',async({page})=>{
 const s=await setup(page,{saved:'manual',permission:'denied'});await expect(s.section).toBeVisible();await page.locator('.location-btn').click();await s.fix();await expect(page.getByText('Браузърът е блокирал местоположението.',{exact:false})).toBeVisible()
})
test('denied startup restores old GPS explicitly as saved location',async({page})=>{
 const s=await setup(page,{saved:'geolocation',permission:'denied',accuracy:25})
 await expect(s.section).toContainText('последното запазено GPS място')
 await expect(s.section).toContainText('Община: Провадия')
})
test('stalled reverse service is bounded and explained',async({page})=>{
 const s=await setup(page,{stalled:true});await s.fix()
 await expect(s.section).toContainText('Проверяваме')
 await page.clock.fastForward(13000)
 await expect(s.section).toContainText('недостъпна')
 expect(s.queries).toHaveLength(0)
})
