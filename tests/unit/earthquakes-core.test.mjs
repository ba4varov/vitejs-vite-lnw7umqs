import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EARTHQUAKE_DEFAULTS, EARTHQUAKE_FEED_URL,
  EARTHQUAKE_PUSH_DELIVERY_ENABLED,
  distanceKm,normalizeUsgsEarthquakes,nearbyEarthquakes,
  earthquakeDedupKey,earthquakePushCandidates,handleEarthquakes
} from '../../server/earthquakes-core.js'

const NOW=Date.UTC(2026,10,18,8,30,0)
const quake=(id,lat,lon,magnitude=3.5,time=NOW-5*60_000,extras={})=>({
  type:'Feature',id,
  properties:{type:'earthquake',mag:magnitude,time,updated:time+1000,
    place:'Near Varna, Bulgaria',url:`https://earthquake.usgs.gov/earthquakes/eventpage/${id}`,...extras},
  geometry:{type:'Point',coordinates:[lon,lat,12.5]}
})
const sample=()=>({
  type:'FeatureCollection',metadata:{generated:NOW},
  features:[
    quake('eq001',43.2141,27.9147,3.0),
    quake('eq002',43.2141,28.6,4.1),
    quake('eq003',43.2141,29.5,5),
    quake('eq004',43.2141,27.9147,2.8),
    quake('eq005',43.2141,27.9147,3.2,NOW-26*60*60_000),
    quake('eq006',43.2141,27.9147,3.3,NOW+20*60_000),
    quake('eq007',43.2141,27.9147,4,NOW-1000,{type:'quarry blast'}),
    quake('eq001',43.2141,27.9147,4),
  ],
})
const response=(content,ok=true)=>({
  ok,headers:{get:()=>null},text:async()=>JSON.stringify(content),
})
const fakeRes=()=>({
  code:0,headers:{},body:null,
  setHeader(name,value){this.headers[name]=value;return this},
  status(status){this.code=status;return this},
  json(body){this.body=body;return this},
})

test('initial defaults are 100 km, M3.0 and desired Push on, actual delivery fail-closed',()=>{
  assert.deepEqual(EARTHQUAKE_DEFAULTS,{radiusKm:100,minMagnitude:3,pushRequested:true})
  assert.equal(EARTHQUAKE_PUSH_DELIVERY_ENABLED,false)
})
test('validates USGS event times, types, magnitudes, locations and URLs',()=>{
  const events=normalizeUsgsEarthquakes(sample(),NOW)
  assert.deepEqual(events.map(e=>e.id),['usgs:eq007'].filter(()=>false).concat(['usgs:eq001','usgs:eq002','usgs:eq003']))
  assert.ok(events.every(e=>e.source==='USGS' && e.preliminary===true))
  assert.equal(events[0].depthKm,12.5)
  const data=sample()
  data.features[0].properties.url='https://evil.invalid/malware'
  data.features[0].properties.place='<img> Dangerous text'
  const cleaned=normalizeUsgsEarthquakes(data,NOW)[0]
  assert.ok(cleaned.url.startsWith('https://earthquake.usgs.gov/'))
  assert.equal(cleaned.place.includes('<'),false)
  assert.throws(()=>normalizeUsgsEarthquakes({features:[]},NOW),/INVALID_USGS_FEED/)
})
test('haversine handles 100 km threshold, antimeridian and invalid coordinates',()=>{
  const varna={lat:43.2141,lon:27.9147}
  assert.equal(distanceKm(varna,varna),0)
  assert.ok(distanceKm(varna,{lat:43.2141,lon:28.6})<100)
  assert.ok(distanceKm(varna,{lat:43.2141,lon:29.5})>100)
  assert.ok(distanceKm({lat:0,lon:179.8},{lat:0,lon:-179.8})<50)
  assert.equal(distanceKm({lat:Infinity,lon:1},varna),null)
})
test('only nearby, recent >=M3 events are shown in most-recent order',()=>{
  const matches=nearbyEarthquakes(normalizeUsgsEarthquakes(sample(),NOW),
    {lat:43.2141,lon:27.9147},EARTHQUAKE_DEFAULTS,NOW)
  assert.deepEqual(matches.map(e=>e.id),['usgs:eq001','usgs:eq002'])
  assert.ok(matches.every(e=>e.distanceKm<=100&&e.magnitude>=3))
  assert.deepEqual(nearbyEarthquakes(matches,{lat:NaN,lon:27.9}),[])
  assert.deepEqual(nearbyEarthquakes(matches,{lat:43.2,lon:27.9},{radiusKm:900,minMagnitude:3}),[])
})
test('push is never dispatched merely because configuration requests it',()=>{
  const events=normalizeUsgsEarthquakes(sample(),NOW)
  const subscriber={
    enabled:true,pushRequested:true,browserPermission:'granted',consentedAt:NOW-60*60_000,
    lat:43.2141,lon:27.9147,radiusKm:100,minMagnitude:3
  }
  assert.deepEqual(earthquakePushCandidates(events,subscriber,new Set(),NOW),[])
  assert.equal(earthquakeDedupKey(events[0]),'earthquake:usgs:eq001')
  assert.equal(earthquakeDedupKey({id:'evil'}),null)
})

test('API denies unsupported methods and query or authorization, without fetching',async()=>{
  let calls=0
  const fetcher=()=>{calls++;throw Error('should not fetch')}
  const badMethod=fakeRes(),badQuery=fakeRes(),badAuth=fakeRes()
  await handleEarthquakes({method:'POST',query:{},headers:{}},badMethod,{fetcher,now:NOW})
  await handleEarthquakes({method:'GET',query:{latitude:'43'},headers:{}},badQuery,{fetcher,now:NOW})
  await handleEarthquakes({method:'GET',query:{},headers:{authorization:'Bearer secret'}},badAuth,{fetcher,now:NOW})
  assert.equal(badMethod.code,405);assert.equal(badQuery.code,400);assert.equal(badAuth.code,400)
  assert.equal(calls,0)
})

test('one fixed USGS feed, shared in memory and CDN, never accepts client GPS',async()=>{
  let calls=0,seen
  const fetcher=async(url,options)=>{
    calls++;seen={url,options}
    return response(sample())
  }
  const first=fakeRes(),second=fakeRes()
  await handleEarthquakes({method:'GET',query:{},headers:{}},first,{fetcher,now:NOW})
  await handleEarthquakes({method:'GET',query:{},headers:{}},second,{fetcher,now:NOW+5000})
  assert.equal(calls,1)
  assert.equal(seen.url,EARTHQUAKE_FEED_URL)
  assert.equal(seen.options.redirect,'error')
  assert.equal(first.code,200);assert.equal(second.code,200)
  assert.equal(first.body.status,'ready')
  assert.equal(first.body.events.length,3)
  assert.equal(first.body.pushDeliveryEnabled,false)
  assert.match(first.headers['Cache-Control'],/s-maxage=60/)
})

test('provider outages distinguish stale data from confirmed absence',async()=>{
  let calls=0
  const fail=async()=>{calls++;throw Error('offline')}
  const stale=fakeRes(),expired=fakeRes()
  await handleEarthquakes({method:'GET',query:{},headers:{}},stale,{fetcher:fail,now:NOW+120_000})
  assert.equal(stale.code,200);assert.equal(stale.body.status,'stale')
  await handleEarthquakes({method:'GET',query:{},headers:{}},expired,{fetcher:fail,now:NOW+600_000})
  assert.equal(expired.code,503);assert.equal(expired.body.status,'unavailable')
  assert.equal(expired.headers['Retry-After'],'60')
  assert.equal(calls,2)
})
