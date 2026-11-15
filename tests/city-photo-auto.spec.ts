import { expect, test, type Page } from '@playwright/test'
import { weather } from './forecast-order-fixture'

const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
  'base64'
)
const sampleCities = [
  { nameBg:'Пловдив', nameEn:'Plovdiv', slug:'plovdiv',lat:42.1522,lon:24.7454 },
  { nameBg:'Бургас', nameEn:'Burgas', slug:'burgas',lat:42.5048,lon:27.4732 },
  { nameBg:'Лондон', nameEn:'London', slug:'london',lat:51.5074,lon:-.1278 },
  { nameBg:'Париж', nameEn:'Paris', slug:'paris',lat:48.8566,lon:2.3522 },
  { nameBg:'Ню Йорк', nameEn:'New York', slug:'new-york',lat:40.7128,lon:-74.006 },
  { nameBg:'Токио', nameEn:'Tokyo', slug:'tokyo',lat:35.6762,lon:139.6503 },
  { nameBg:'Дубай', nameEn:'Dubai', slug:'dubai',lat:25.2048,lon:55.2708 },
]

async function boot(page:Page, language:'bg'|'en', withGeoFiles=true) {
  await page.addInitScript(lang=>{
    localStorage.setItem('meteoPulseLanguage',lang)
    localStorage.setItem('meteoPulseConfirmedLocationV1',JSON.stringify({
      name:lang==='bg'?'Варна':'Varna', lat:43.2141,lon:27.9147,source:'manual',
      countryCode:'BG',geonameId:726050
    }))
  },language)
  const commonsCalls:string[]=[]
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url())
    if(u.hostname==='commons.wikimedia.org' && u.pathname==='/w/api.php'){
      commonsCalls.push(u.href)
      if(u.searchParams.get('list')==='geosearch'){
        const [lat,lon]=(u.searchParams.get('gscoord')||'').split('|').map(Number)
        const nearest=sampleCities.find(p=>Math.abs(p.lat-lat)<.01 && Math.abs(p.lon-lon)<.01)
        const collection=nearest && withGeoFiles ? Array.from({length:8},(_,i)=>({
          title:`File:${nearest.slug} skyline ${i}.jpg`,ns:6,
          lat:lat+(i/10000),lon
        })):[]
        return route.fulfill({json:{query:{geosearch:collection}}})
      }
      const files=(u.searchParams.get('titles')||'').split('|')
      const pages=Object.fromEntries(files.map((title,i)=>{
        const slug=sampleCities.find(p=>title.includes(p.slug))?.slug ||
          (title.includes('Varna')?'varna':'sofia')
        return [String(i+1),{title,imageinfo:[{
          mime:'image/jpeg',width:2500,height:1600,
          thumburl:`https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${slug}-${i}.jpg/1440px-${slug}-${i}.jpg`,
          user:'Photo author',extmetadata:{
            Artist:{value:'<span>Photo author</span>'},
            LicenseShortName:{value:'CC BY 4.0'},
            LicenseUrl:{value:'https://creativecommons.org/licenses/by/4.0/'}
          }
        }]}]
      }))
      return route.fulfill({json:{query:{pages}}})
    }
    if(u.hostname==='upload.wikimedia.org')return route.fulfill({contentType:'image/png',body:pixel})
    if(u.hostname==='api.open-meteo.com')return route.fulfill({json:weather})
    if(u.pathname==='/api/alerts')return route.fulfill({json:{status:'resolved',days:[],alerts:[]}})
    if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/'))return route.continue()
    return route.fulfill({json:{}})
  })
  await page.goto('/')
  await expect(page.locator('.weather-forecast-view .big-temp')).toBeVisible()
  return commonsCalls
}

for(const [width,lang] of [[360,'bg'],[390,'en'],[1440,'bg']] as const) {
  test(`global city photos update with selected city ${width}px ${lang}`,async({page})=>{
    await page.setViewportSize({width,height:844})
    const calls=await boot(page,lang)
    for(const city of sampleCities) {
      await page.getByRole('button',{name:lang==='bg'?city.nameBg:city.nameEn,exact:true}).click()
      await expect(page.locator('.weather-forecast-view .big-temp')).toBeVisible()
      await expect(page.locator('.weather-forecast-view .weather-city-photo'))
        .toHaveAttribute('src',new RegExp(`${city.slug}-`))
      await expect(page.locator('.weather-forecast-view .weather-city-photo-credit a')).toHaveCount(2)
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    }
    // Only geotagged photos about the selected city can be shown.
    const queries=calls.filter(x=>new URL(x).searchParams.get('list')==='geosearch')
    expect(queries).toHaveLength(sampleCities.length)
    expect(queries.every(x=>!x.includes('geonameId'))).toBe(true)
  })
}

test('if photos have no geotags, keep beautiful WMO sky and do not guess',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  const calls=await boot(page,'en',false)
  await page.getByRole('button',{name:'London',exact:true}).click()
  await expect(page.locator('.weather-forecast-view .big-temp')).toBeVisible()
  await expect.poll(()=>calls.some(url=>new URL(url).searchParams.get('list')==='geosearch')).toBe(true)
  await expect(page.locator('.weather-forecast-view .weather-city-photo')).toHaveCount(0)
  await expect(page.locator('.weather-forecast-view .weather-city-photo-credit')).toHaveCount(0)
  const background=await page.locator('.weather-forecast-view').evaluate(node=>getComputedStyle(node).backgroundImage)
  expect(background).toContain('gradient')
})

test('worldwide city photos do not rotate on refresh, but do rotate tomorrow',async({page})=>{
  await page.clock.install({time:new Date('2026-11-15T11:00:00Z')})
  await page.setViewportSize({width:390,height:844})
  const calls=await boot(page,'en')
  await page.getByRole('button',{name:'Paris',exact:true}).click()
  const img=page.locator('.weather-forecast-view .weather-city-photo')
  await expect(img).toHaveAttribute('src',/paris-/)
  const first=await img.getAttribute('src')
  const before=calls.length
  await page.clock.fastForward(15*60*1000)
  await expect(img).toHaveAttribute('src',first!)
  await page.reload()
  await expect(img).toHaveAttribute('src',first!)
  expect(calls.length).toBe(before) // no API refresh, even with StrictMode
  await page.clock.fastForward(24*60*60*1000)
  await expect.poll(()=>img.getAttribute('src')).not.toBe(first)
})
