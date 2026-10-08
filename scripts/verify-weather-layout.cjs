// UI regression check: synthetic API responses only; never contacts real account services.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs');
const output=process.env.VISUAL_OUTPUT || 'work/visual-output';
const baseUrl=process.env.VISUAL_BASE_URL || 'http://127.0.0.1:5173';
fs.mkdirSync(output,{recursive:true});
const times=Array.from({length:360},(_,i)=>new Date(Date.UTC(2026,9,8,i)).toISOString().slice(0,16));
const fields={temperature_2m:18,weather_code:2,precipitation:0.2,wind_speed_10m:12,surface_pressure:1015,relative_humidity_2m:72,visibility:16000,dew_point_2m:12,cloud_cover:40,apparent_temperature:17,precipitation_probability:35};
const hourly={time:times};for(const [k,v] of Object.entries(fields))hourly[k]=times.map(()=>v);
const daily={time:times.filter((_,i)=>i%24===0).map(t=>t.slice(0,10))};
for(const [k,v] of Object.entries({weather_code:2,temperature_2m_max:22,temperature_2m_min:14,precipitation_sum:1.2,precipitation_probability_max:35,wind_speed_10m_max:18,uv_index_max:3,apparent_temperature_max:21}))daily[k]=daily.time.map(()=>v);
daily.sunrise=daily.time.map(t=>t+'T07:15');daily.sunset=daily.time.map(t=>t+'T18:45');
const data={current:{...fields,time:'2026-10-08T23:15',uv_index:3},hourly,daily};
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});const results=[];
for(const width of [1440,768,390,320])for(const lang of ['bg','en'])for(const dark of [false,true])for(const count of [0,1,2,5,10])for(const sea of [false,true]){
const ctx=await browser.newContext({viewport:{width,height:900},isMobile:width<400,hasTouch:width<400});
const page=await ctx.newPage();
await page.route('**/*',async route=>{const url=route.request().url();if(url.startsWith(baseUrl))return route.continue();if(url.includes('api.open-meteo.com/v1/forecast'))return route.fulfill({json:data});if(url.includes('marine-api'))return route.fulfill({json:{current:{sea_surface_temperature:sea?20:null},hourly:{time:times,sea_surface_temperature:times.map(()=>sea?20:null)}}});if(url.includes('air-quality-api'))return route.fulfill({json:{current:{european_aqi:25,pm10:10,pm2_5:5},hourly:{time:times,european_aqi:times.map(()=>25)}}});return route.fulfill({json:{results:[]}});});
await page.addInitScript(({count,lang})=>{localStorage.setItem('meteoPulseLanguage',lang);if(!localStorage.getItem('meteoPulsePlacesV1'))localStorage.setItem('meteoPulsePlacesV1',JSON.stringify(Array.from({length:count},(_,i)=>({name:i===0?'Варна':i===1?'Sofia':'A very long city name for layout '+i,lat:i===0?43.2141:42+i/10,lon:i===0?27.9147:23+i/10,region:'A long region name',country:'Bulgaria'}))));},{count,lang});
await page.goto(baseUrl);await page.locator('.hour-box').first().waitFor();await page.waitForFunction(n=>document.querySelectorAll('.place-chip').length===n,count);if(!sea){await page.locator('.city-btn').nth(1).click();await page.locator('.hour-box').first().waitFor();}if(dark)await page.locator('.header-btns > .icon-btn').click();
const check=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,hours:document.querySelectorAll('.hour-box').length,days:document.querySelectorAll('.day-box').length,places:document.querySelectorAll('.place-chip').length,heights:[...document.querySelectorAll('.hour-box')].map(e=>e.getBoundingClientRect().height),time:document.querySelector('.hour-time').textContent,sea:document.querySelectorAll('.hour-sea').length}));
if(check.overflow||check.hours!==24||check.days!==14||check.places!==count||new Set(check.heights).size!==1||check.time!=='23:00'||check.sea!==0)throw new Error(JSON.stringify({width,lang,dark,count,sea,check}));
if(count===5 && sea){
  const boxes=await page.locator('.hourly-section, .forecast-section').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}));
  const left=Math.min(...boxes.map(b=>b.x)), top=Math.min(...boxes.map(b=>b.y));
  await page.screenshot({fullPage:true,path:`${output}/forecast-${width}-${lang}-${dark?'dark':'light'}.png`,clip:{x:left,y:top,width:Math.max(...boxes.map(b=>b.x+b.width))-left,height:Math.max(...boxes.map(b=>b.y+b.height))-top}});
}
await page.locator('.hour-box').first().click();await page.locator('.popup-card').waitFor();
await page.locator('.popup-card .chart-tab').last().click();
const details=await page.locator('.popup-card').innerText();
if(!details.includes('35%') || !details.includes('0.2') || (sea&&!details.includes('20°C')))throw new Error('Hourly details lost data');
await page.locator('.popup-card .icon-btn').click();
await page.reload();await page.locator('.hour-box').first().waitFor();await page.waitForFunction(n=>document.querySelectorAll('.place-chip').length===n,count);if(await page.locator('.place-chip').count()!==count)throw new Error('Reload lost favorites');
await page.locator('.forecast-scroll-controls button').last().click();await page.waitForFunction(()=>document.querySelector('.hourly-row').scrollLeft>0);await page.locator('.hourly-row').evaluate(e=>e.scrollLeft=e.scrollWidth);if(await page.locator('.hourly-row').evaluate(e=>e.scrollLeft)<=0)throw new Error('Scrolling failed');
results.push({width,lang,dark,count,sea,status:'passed'});fs.writeFileSync(output+'/progress.json',JSON.stringify({checked:results.length,last:results.at(-1)}));if(results.length%20===0)console.log('Checked '+results.length);await ctx.close();}
fs.writeFileSync(output+'/visual-results.json',JSON.stringify({note:'Real Chromium, synthetic API fixtures, guest sessions only. No live Open-Meteo or Supabase verification.',results},null,2));await browser.close();console.log('Passed '+results.length+' visual combinations');})();
