import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WEATHER_PUSH_DELIVERY_ENABLED,WEATHER_PUSH_LEAD_MS,
  weatherPushKey,prepareWeatherSafetyPushPreview,
  prepareUnifiedSafetyPushPreview,safetyPushDeliveryEnabled
} from '../../server/safety-push-preview.js'
import {EARTHQUAKE_PUSH_DELIVERY_ENABLED} from '../../server/earthquakes-core.js'

const NOW=Date.parse('2026-11-18T10:00:00Z')
const city={name:'Varna',latitude:43.2141,longitude:27.9147,zone:'UTC'}
const other={name:'Sofia',latitude:42.6977,longitude:23.3219,zone:'UTC'}
const prefs={enabled:true,cities:[city],categories:['rain','wind','storm','cold','heat']}
const d1={id:'d1',userId:'owner'}
const d2={id:'d2',userId:'owner'}
const outsider={id:'d3',userId:'other'}
const deviceSet=[d1,d2,outsider]
function snapshot(shift=0,cityValue=city,source='server-open-meteo',fetchedAt=NOW) {
  const hours=Array.from({length:48},(_,i)=>{
    const hoursFromNow=i-1+shift
    return {
      time:new Date(NOW+hoursFromNow*3_600_000).toISOString().slice(0,16),
      feelsLike:20,rainProbability:5,rain:0,wind:6,code:0
    }
  })
  // Independent threshold-based hazards. Category level comes from existing
  // forecastRisks: rainfall >=10mm/hour, wind >=60km/h, WMO 95/96/99 storms.
  for(const h of hours){
    const epoch=Date.parse(h.time+'Z')
    const offset=(epoch-NOW)/3_600_000
    if(offset===2||offset===3)h.wind=70
    if(offset===4)h.rain=11
    if(offset===5)h.code=95
    if(offset===30)h.feelsLike=-18 // Beyond the 24h preview horizon.
  }
  return {city:cityValue,source,fetchedAt,
    forecast:{timeZone:'UTC',hours}}
}
const eq={id:'usgs:synthetic123',source:'USGS',lat:43.2141,lon:27.9147,
  magnitude:3.8,time:NOW-4*60_000}
const consent={enabled:true,city:{name:'Varna',latitude:city.latitude,
  longitude:city.longitude},userId:'owner',optedInAt:NOW-60*60_000}

test('both weather and earthquake sending remain fail-closed',()=>{
  assert.equal(WEATHER_PUSH_DELIVERY_ENABLED,false)
  assert.equal(EARTHQUAKE_PUSH_DELIVERY_ENABLED,false)
  assert.equal(safetyPushDeliveryEnabled(),false)
  assert.equal(WEATHER_PUSH_LEAD_MS,24*60*60*1000)
})

test('forecast danger yields user-selected rain/wind/storm, but never Pro activity recommendations',()=>{
  const found=prepareWeatherSafetyPushPreview(snapshot(),prefs,
    {plan:'pro',permissions:['planner:advanced']},'owner',deviceSet,new Set(),NOW)
  assert.equal(found.length,6)
  assert.deepEqual([...new Set(found.map(x=>x.riskKind))].sort(),['rain','storm','wind'])
  assert.ok(found.every(x=>x.predicted&&x.sourceType==='forecast-not-official-warning'))
  assert.ok(found.every(x=>x.deviceId!=='d3'&&x.source==='Open-Meteo forecast'))
  assert.ok(found.every(x=>x.eventKey.length<=300))
  assert.ok(!found.some(x=>x.riskKind==='cold'))
})

test('forecast refresh or shifted onset within same local day cannot produce duplicate',()=>{
  const a=weatherPushKey(city,'wind',NOW+2*3_600_000)
  const b=weatherPushKey(city,'wind',NOW+3*3_600_000)
  assert.equal(a,b)
  assert.notEqual(a,weatherPushKey(other,'wind',NOW+2*3_600_000))
  assert.notEqual(a,weatherPushKey(city,'rain',NOW+2*3_600_000))
  assert.notEqual(a,weatherPushKey(city,'wind',NOW+25*3_600_000))
  assert.equal(weatherPushKey(city,'unknown',NOW),null)
  const prior=new Set([`d1:${a}`])
  const results=prepareWeatherSafetyPushPreview(snapshot(),prefs,
    {plan:'free'},'owner',deviceSet,prior,NOW)
  assert.equal(results.filter(x=>x.riskKind==='wind').length,1)
  assert.equal(results.find(x=>x.riskKind==='wind').deviceId,'d2')
})

test('strict opted-in risk categories, saved cities, real owner, registered devices',()=>{
  const onlyWind={...prefs,categories:['wind']}
  const found=prepareWeatherSafetyPushPreview(snapshot(),onlyWind,
    {plan:'free'},'owner',deviceSet,new Set(),NOW)
  assert.deepEqual(found.map(x=>x.riskKind),['wind','wind'])
  assert.deepEqual(prepareWeatherSafetyPushPreview(snapshot(),
    {...onlyWind,enabled:false},{plan:'free'},'owner',deviceSet,new Set(),NOW),[])
  assert.deepEqual(prepareWeatherSafetyPushPreview(snapshot(other),
    onlyWind,{plan:'free'},'owner',deviceSet,new Set(),NOW),[])
  assert.deepEqual(prepareWeatherSafetyPushPreview(snapshot(),
    onlyWind,{plan:'free'},'foreign',deviceSet,new Set(),NOW),[])
  const invalid=[{...d1,revoked:true},{...d2,expiresAt:NOW-1},outsider]
  assert.deepEqual(prepareWeatherSafetyPushPreview(snapshot(),
    onlyWind,{plan:'free'},'owner',invalid,new Set(),NOW),[])
})

test('stale, forged or incomplete forecasts never create fake weather warnings',()=>{
  for(const entry of [
    snapshot(0,city,'untrusted-client'),
    snapshot(0,city,'server-open-meteo',NOW-16*60_000),
    {...snapshot(),forecast:{timeZone:'UTC',hours:[]}},
    {...snapshot(),forecast:{...snapshot().forecast,hours:[]}}
  ]){
    assert.deepEqual(prepareWeatherSafetyPushPreview(entry,prefs,
      {plan:'free'},'owner',deviceSet,new Set(),NOW),[])
  }
})

test('unified delivery preview contains both channels with distinct dedup keys',()=>{
  const batches=[{snapshot:snapshot(),preferences:prefs,
    entitlement:{plan:'free'},userId:'owner'}]
  const result=prepareUnifiedSafetyPushPreview({
    weatherBatches:batches,earthquakeEvents:[eq,eq],
    earthquakeConsents:[consent,consent],
    devices:deviceSet,now:NOW
  })
  const earthquakes=result.filter(x=>x.channel==='earthquake')
  const weather=result.filter(x=>x.channel==='weather')
  assert.equal(earthquakes.length,2)
  assert.equal(weather.length,6)
  assert.ok(earthquakes.every(x=>x.eventKey.startsWith('earthquake:')))
  assert.ok(weather.every(x=>x.eventKey.startsWith('weather:open-meteo:')))
  assert.equal(new Set(result.map(x=>x.deviceId+':'+x.eventKey)).size,result.length)
})

test('weather opt-out cannot disable earthquake consent and vice versa',()=>{
  const offWeather=prepareUnifiedSafetyPushPreview({
    weatherBatches:[{snapshot:snapshot(),preferences:{...prefs,enabled:false},
      entitlement:{plan:'free'},userId:'owner'}],
    earthquakeEvents:[eq],earthquakeConsents:[consent],devices:deviceSet,now:NOW
  })
  assert.deepEqual([...new Set(offWeather.map(x=>x.channel))],['earthquake'])
  const offQuake=prepareUnifiedSafetyPushPreview({
    weatherBatches:[{snapshot:snapshot(),preferences:prefs,
      entitlement:{plan:'free'},userId:'owner'}],
    earthquakeEvents:[eq],earthquakeConsents:[{...consent,enabled:false}],
    devices:deviceSet,now:NOW
  })
  assert.deepEqual([...new Set(offQuake.map(x=>x.channel))],['weather'])
})
