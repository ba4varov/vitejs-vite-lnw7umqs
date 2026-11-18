import test from 'node:test'
import assert from 'node:assert/strict'
import {
  usgsHistoryUrl,filterHistoryByRegion,loadUsgsHistory,handleEarthquakeHistory,
  HISTORY_MIN_MAGNITUDE,BALKAN_HISTORY_BOUNDING_BOX,BULGARIA_NEARBY_BOUNDING_BOX
} from '../../server/earthquake-history-core.js'
import {normalizeUsgsEarthquakes,EARTHQUAKE_DEFAULTS,EARTHQUAKE_PUSH_DELIVERY_ENABLED} from '../../server/earthquakes-core.js'

const DAY=86_400_000
const NOW=Date.UTC(2026,10,18,10,0,0)
const feature=(id,lat,lon,time=NOW-DAY,mag=3.5,options={})=>({
  type:'Feature',id,
  properties:{type:'earthquake',mag,time,updated:time+3000,
    place:'USGS epicentre '+id,url:'https://earthquake.usgs.gov/earthquakes/eventpage/'+id,...options},
  geometry:{type:'Point',coordinates:[lon,lat,10.5]}
})
const example=()=>({
  type:'FeatureCollection',metadata:{generated:NOW},features:[
    feature('sof2',42.7,23.3,NOW-2*DAY,3.2),
    feature('ath3',37.9,23.7,NOW-3*DAY,4.2),
    feature('sof12',42.7,23.3,NOW-12*DAY,3.1),
    feature('beyond',50,18,NOW-2*DAY,5.5),
    feature('weak',42.7,23.3,NOW-DAY,2.9),
    feature('blast',42.7,23.3,NOW-DAY,3.8,{type:'quarry blast'}),
    feature('invalid',NaN,23.3,NOW-DAY,5),
    feature('tooOld',42.7,23.3,NOW-32*DAY,5),
  ]
})
const body=data=>({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(data)})
const fakeRes=()=>({
  code:0,headers:{},body:null,
  setHeader(name,value){this.headers[name]=value;return this},
  status(code){this.code=code;return this},
  json(value){this.body=value;return this}
})

test('two fixed windows, bounded Balkan geography and fixed M3 threshold',()=>{
  assert.equal(HISTORY_MIN_MAGNITUDE,3)
  assert.equal(EARTHQUAKE_DEFAULTS.radiusKm,300)
  assert.equal(EARTHQUAKE_PUSH_DELIVERY_ENABLED,false)
  const u=new URL(usgsHistoryUrl(7,NOW))
  assert.equal(u.hostname,'earthquake.usgs.gov')
  assert.equal(u.pathname,'/fdsnws/event/1/query')
  assert.equal(u.searchParams.get('minmagnitude'),'3')
  assert.equal(u.searchParams.get('eventtype'),'earthquake')
  assert.equal(u.searchParams.get('limit'),'500')
  assert.equal(u.searchParams.get('orderby'),'time')
  assert.equal(u.searchParams.get('starttime'),new Date(NOW-7*DAY).toISOString())
  assert.equal(u.searchParams.get('minlatitude'),String(BALKAN_HISTORY_BOUNDING_BOX.minlatitude))
  assert.equal(u.searchParams.get('maxlongitude'),String(BALKAN_HISTORY_BOUNDING_BOX.maxlongitude))
  assert.equal(usgsHistoryUrl(14,NOW),null)
  assert.equal(usgsHistoryUrl(30,NaN),null)
  assert.ok(BULGARIA_NEARBY_BOUNDING_BOX.minlatitude> BALKAN_HISTORY_BOUNDING_BOX.minlatitude)
})

test('archival normalization preserves older but valid events without changing 24-hour alerts',()=>{
  const recent=normalizeUsgsEarthquakes(example(),NOW)
  assert.deepEqual(recent.map(e=>e.id),[])
  const weekly=normalizeUsgsEarthquakes(example(),NOW,{maxAgeMs:7*DAY,minMagnitude:3,maxItems:500})
  assert.deepEqual(weekly.map(e=>e.id),['usgs:sof2','usgs:beyond','usgs:ath3'])
  const monthly=normalizeUsgsEarthquakes(example(),NOW,{maxAgeMs:30*DAY,minMagnitude:3,maxItems:500})
  assert.deepEqual(monthly.map(e=>e.id),['usgs:sof2','usgs:beyond','usgs:ath3','usgs:sof12'])
  assert.throws(()=>normalizeUsgsEarthquakes(example(),NOW,{maxAgeMs:32*DAY}),/INVALID_USGS_OPTIONS/)
})

test('Bulgaria and nearby areas is a declared rectangle, Balkans a larger rectangle',()=>{
  const events=[
    {lat:42.7,lon:23.3,time:NOW-1000,magnitude:3.3,id:'bg'},
    {lat:37.9,lon:23.7,time:NOW-2000,magnitude:4.2,id:'gr'},
    {lat:50,lon:23.3,time:NOW-3000,magnitude:5,id:'out'},
    {lat:42.7,lon:23.3,time:NOW-4000,magnitude:2.6,id:'weak'}
  ]
  assert.deepEqual(filterHistoryByRegion(events,'bulgaria').map(e=>e.id),['bg'])
  assert.deepEqual(filterHistoryByRegion(events,'balkans').map(e=>e.id),['bg','gr'])
  assert.deepEqual(filterHistoryByRegion(events,'balkans',0),[])
  assert.deepEqual(filterHistoryByRegion(events,'invalid'),[])
  assert.deepEqual(filterHistoryByRegion(null,'bulgaria'),[])
})

test('USGS catalog query and cache share one request without visitor GPS',async()=>{
  let calls=0,record=null
  const fetcher=async(url,options)=>{calls++;record={url,options};return body(example())}
  const first=await loadUsgsHistory(7,{now:NOW,fetcher})
  const second=await loadUsgsHistory(7,{now:NOW+1000,fetcher})
  assert.equal(calls,1)
  assert.equal(record.options.redirect,'error')
  assert.match(record.url,/minlatitude=/)
  assert.equal(record.url.includes('user=43'),false)
  assert.equal(first.events.length,2)
  assert.deepEqual(first.events,second.events)
  assert.equal(first.stale,false)
  assert.equal(first.source,'USGS')
})

test('30-day history includes valid older records, retains a bounded catalog',async()=>{
  let requests=0
  const thirty=await loadUsgsHistory(30,{now:NOW,fetcher:async()=>{requests++;return body(example())}})
  assert.equal(requests,1)
  assert.deepEqual(thirty.events.map(e=>e.id),['usgs:sof2','usgs:ath3','usgs:sof12'])
  assert.equal(thirty.periodDays,30)
  assert.equal(thirty.limitReached,false)
})

test('history endpoint returns fixed public data, never activates Push or changes weather alerts',async()=>{
  const res=fakeRes()
  const next=await handleEarthquakeHistory({method:'GET',query:{period:'7'},headers:{}},res,{
    now:NOW+2000,fetcher:async()=>{throw Error('Should use cache')}
  })
  assert.strictEqual(next,res)
  assert.equal(res.code,200)
  assert.equal(res.body.periodDays,7)
  assert.equal(res.body.magnitudeThreshold,3)
  assert.equal(res.body.pushDeliveryEnabled,false)
  assert.equal(res.body.events.length,2)
  assert.match(res.headers['Cache-Control'],/s-maxage=600/)
})

test('history endpoint forbids other periods, client coordinates and auth headers',async()=>{
  const fetcher=()=>{throw Error('Should not fetch')}
  for(const req of [
    {method:'POST',query:{period:'7'},headers:{}},
    {method:'GET',query:{period:'90'},headers:{}},
    {method:'GET',query:{period:['7','30']},headers:{}},
    {method:'GET',query:{period:'7',lat:'42.7'},headers:{}},
    {method:'GET',query:{},headers:{authorization:'Bearer token'}}
  ]){
    const res=fakeRes()
    await handleEarthquakeHistory(req,res,{fetcher,now:NOW})
    assert.equal(res.code,req.method==='POST'?405:400)
    assert.equal(res.headers['Cache-Control'],'no-store')
  }
})

test('failed upstream returns explicitly stale for up to 30 min, then 503',async()=>{
  let calls=0
  const fail=async()=>{calls++;throw Error('USGS timeout')}
  const stale=fakeRes(),expired=fakeRes()
  await handleEarthquakeHistory({method:'GET',query:{period:'7'},headers:{}},stale,{
    now:NOW+12*60_000,fetcher:fail
  })
  assert.equal(stale.code,200)
  assert.equal(stale.body.status,'stale')
  await handleEarthquakeHistory({method:'GET',query:{period:'7'},headers:{}},expired,{
    now:NOW+40*60_000,fetcher:fail
  })
  assert.equal(expired.code,503)
  assert.equal(expired.body.status,'unavailable')
  assert.equal(expired.headers['Retry-After'],'60')
  assert.equal(calls,2)
})

test('empty USGS 204 is valid lack of reported catalog matches, not an outage',async()=>{
  const result=await loadUsgsHistory(30,{
    now:NOW+45*60_000,
    fetcher:async()=>({status:204,ok:true})
  })
  assert.deepEqual(result.events,[])
  assert.equal(result.stale,false)
})
