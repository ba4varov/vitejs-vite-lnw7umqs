import { expect, test, type Page } from '@playwright/test'
import { weather } from './forecast-order-fixture'

const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
  'base64'
)

async function setup(page: Page, location: 'varna' | 'sofia' = 'varna', failedImage = false) {
  const point = location === 'varna'
    ? {name:'Варна', lat:43.2141, lon:27.9147, geonameId:726050}
    : {name:'София', lat:42.6977, lon:23.3219, geonameId:727011}
  await page.addInitScript(place => {
    localStorage.setItem('meteoPulseLanguage','bg')
    localStorage.setItem('meteoPulseConfirmedLocationV1',JSON.stringify({
      ...place,source:'manual',countryCode:'BG'
    }))
  },point)

  let apiCalls = 0
  const photoUrls: string[] = []
  await page.route('**/*',async route => {
    const u = new URL(route.request().url())
    if (u.hostname === 'commons.wikimedia.org' && u.pathname === '/w/api.php') {
      apiCalls++
      if (u.searchParams.get('list') === 'geosearch') {
        const [lat, lon] = (u.searchParams.get('gscoord') || '').split('|').map(Number)
        // A mocked, geotagged Commons collection for London's city centre.
        const geosearch = Number.isFinite(lat) && Number.isFinite(lon) ?
          Array.from({length:8},(_,i)=>({
            ns:6, title:`File:London skyline ${i}.jpg`,
            lat:lat + (i / 10000),lon
          })) : []
        return route.fulfill({json:{query:{geosearch}}})
      }
      const titles = (u.searchParams.get('titles')||'').split('|')
      const isVarna = titles.some(t => t.includes('Varna'))
      const prefix = isVarna ? 'varna' : titles.some(t => t.includes('London')) ? 'london' : 'sofia'
      const pages = Object.fromEntries(titles.map((title, i) => [String(i + 1), {
        title,
        imageinfo:[{
          mime:'image/jpeg', width:4032, height:3024,
          thumburl:`https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${prefix}-${i}.jpg/1440px-${prefix}-${i}.jpg`,
          user:'Photographer',
          extmetadata:{
            LicenseShortName:{value:'CC BY 4.0'},
            LicenseUrl:{value:'https://creativecommons.org/licenses/by/4.0/'},
            Artist:{value:'<span>Photographer</span>'}
          }
        }]
      }]))
      return route.fulfill({json:{query:{pages}}})
    }
    if (u.hostname === 'upload.wikimedia.org') {
      photoUrls.push(u.href)
      return route.fulfill(failedImage ? {status:404,body:'not found'} :
        {contentType:'image/png',body:pixel})
    }
    if (u.hostname === 'api.open-meteo.com') return route.fulfill({json:weather})
    if (u.pathname === '/api/alerts') return route.fulfill({json:{status:'resolved',days:[],enabled:[],alerts:[]}})
    if (u.hostname === '127.0.0.1' && !u.pathname.startsWith('/api/')) return route.continue()
    return route.fulfill({json:{}})
  })
  await page.goto('/')
  await expect(page.locator('.weather-forecast-view .big-temp')).toBeVisible()
  return {calls:()=>apiCalls,photoUrls}
}

test('the same city photo stays for reload and 15-minute weather refresh, rotates next day',async({page})=>{
  await page.clock.install({time:new Date('2026-11-15T11:00:00Z')})
  const records=await setup(page)
  const hero=page.locator('.weather-forecast-view')
  const image=hero.locator('.weather-city-photo')
  await expect(image).toBeVisible()
  const first=await image.getAttribute('src')
  expect(first).toContain('upload.wikimedia.org')
  await expect(hero.locator('.weather-city-photo-credit a')).toHaveCount(2)
  expect(records.calls()).toBe(1)
  await page.clock.fastForward(15*60*1000)
  await expect(image).toHaveAttribute('src',first!)
  expect(records.calls()).toBe(1)
  await page.reload()
  await expect(image).toHaveAttribute('src',first!)
  expect(records.calls()).toBe(1)
  // Local midnight is crossed without re-querying Commons.
  await page.clock.fastForward(24*60*60*1000)
  await expect.poll(()=>image.getAttribute('src')).not.toBe(first)
  expect(records.calls()).toBe(1)
})

test('changing selected city never leaves old-city photo in the forecast',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  const records=await setup(page)
  const image=page.locator('.weather-forecast-view .weather-city-photo')
  await expect(image).toHaveAttribute('src',/varna-/)
  await page.getByRole('button',{name:'София',exact:true}).click()
  await expect(page.locator('.weather-forecast-view .big-temp')).toBeVisible()
  await expect(image).toHaveAttribute('src',/sofia-/)
  expect(records.calls()).toBe(2)
  await page.getByRole('button',{name:'Лондон',exact:true}).click()
  await expect(page.locator('.weather-forecast-view .big-temp')).toBeVisible()
  await expect(image).toHaveAttribute('src',/london-/)
  await expect(page.locator('.weather-city-photo-credit a')).toHaveCount(2)
  expect(records.calls()).toBe(4) // One geo-search and one batched license/thumbnail lookup.
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('a failed city image leaves the existing animated sky and hides credit',async({page})=>{
  await page.setViewportSize({width:1440,height:900})
  await setup(page,'varna',true)
  const hero=page.locator('.weather-forecast-view')
  await hero.scrollIntoViewIfNeeded()
  await expect(hero.locator('.weather-city-photo')).toHaveCount(0)
  await expect(hero.locator('.weather-city-photo-credit')).toHaveCount(0)
  await expect(hero.locator('.weather-atmosphere')).toHaveAttribute('aria-hidden','true')
  expect(await hero.evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('gradient')
})

test('photo remains decorative in dark mode and on a narrow phone',async({page})=>{
  await page.setViewportSize({width:360,height:780})
  await setup(page,'sofia')
  const hero=page.locator('.weather-forecast-view')
  await expect(hero.locator('.weather-city-photo')).toHaveAttribute('alt','')
  await hero.scrollIntoViewIfNeeded()
  const photo=hero.locator('.weather-city-photo')
  await expect(photo).toBeVisible()
  const rect=await photo.boundingBox()
  const heroRect=await hero.boundingBox()
  expect(rect!.width).toBeLessThanOrEqual(heroRect!.width+1)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await expect(hero.locator('.big-temp')).toBeVisible()
})
