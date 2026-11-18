import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
  validEarthquakeConsentChange,validEarthquakeConsentSnapshot,
  handleEarthquakeConsent
} from '../../server/earthquake-push-consent.js'
import {
  prepareEarthquakeDeliveryPreview,inspectEarthquakeDeliveryCandidate,
  earthquakeDeliveryEnabled
} from '../../server/earthquake-push-eligibility.js'
import {EARTHQUAKE_DEFAULTS,EARTHQUAKE_PUSH_DELIVERY_ENABLED} from '../../server/earthquakes-core.js'

const NOW=Date.UTC(2026,10,18,10,0,0)
const savedCity={name:'Варна',latitude:43.2141,longitude:27.9147,zone:'Europe/Sofia'}
const device={id:'00000000-0000-4000-8000-000000000001',userId:'person-a',revoked:false}
const consent={enabled:true,city:savedCity,userId:'person-a',optedInAt:NOW-60*60_000}
const quake=(id,mag,lat,lon,time=NOW-2*60_000)=>({
  id:'usgs:'+id,magnitude:mag,lat,lon,time
})
const snapshot={contractVersion:1,enabled:true,city:savedCity,
  optedInAt:'2026-11-18T09:00:00Z',radiusKm:300,minMagnitude:3,
  deviceCount:1,deliveryEnabled:false}
const fakeRes=()=>({
  code:null,headers:{},body:null,
  setHeader(name,value){this.headers[name]=value;return this},
  status(status){this.code=status;return this},
  json(body){this.body=body;return this}
})
function service({user='person-a',result=snapshot,rpcStatus=200}={}){
  const calls=[]
  const fetcher=async(url,opts)=>{
    calls.push({url,opts})
    if(url.endsWith('/auth/v1/user'))return new Response(
      JSON.stringify(user?{id:user}:{}),{status:user?200:401})
    if(url.endsWith('/rest/v1/rpc/my_earthquake_push'))
      return new Response(JSON.stringify(result),{status:rpcStatus})
    throw Error('Unexpected external request')
  }
  return {fetcher,calls,env:{SUPABASE_URL:'https://db.example.invalid',
    SUPABASE_ANON_KEY:'public-anon-key'}}
}
async function call(method,body,options={},query={}) {
  const fixture=service(options),res=fakeRes()
  await handleEarthquakeConsent({
    method,body,query,
    headers:{authorization:'Bearer synthetic-session'}
  },res,fixture.env,fixture.fetcher)
  return {res,calls:fixture.calls}
}

test('opt-in changes use only a saved-city INDEX, not client coordinates or account IDs',()=>{
  assert.equal(EARTHQUAKE_DEFAULTS.radiusKm,300)
  assert.equal(EARTHQUAKE_DEFAULTS.minMagnitude,3)
  assert.equal(EARTHQUAKE_PUSH_DELIVERY_ENABLED,false)
  assert.equal(earthquakeDeliveryEnabled(),false)
  assert.equal(validEarthquakeConsentChange({enabled:true,cityIndex:0}),true)
  assert.equal(validEarthquakeConsentChange({enabled:true,cityIndex:4}),true)
  assert.equal(validEarthquakeConsentChange({enabled:false}),true)
  for(const bad of [
    {enabled:true},{enabled:true,cityIndex:5},{enabled:true,cityIndex:-1},
    {enabled:true,cityIndex:'0'},{enabled:true,cityIndex:0,lat:43.2},
    {enabled:false,cityIndex:0},{enabled:false,user_id:'person-b'},
    {enabled:'true',cityIndex:0},null,[],
  ])assert.equal(validEarthquakeConsentChange(bad),false)
})

test('server checks account token before any preference RPC or mutation',async()=>{
  const good=await call('PUT',{enabled:true,cityIndex:2})
  assert.equal(good.res.code,200)
  assert.equal(good.res.body.deliveryEnabled,false)
  assert.equal(good.calls.length,2)
  const payload=JSON.parse(good.calls[1].opts.body).payload
  assert.deepEqual(payload,{operation:'set',enabled:true,cityIndex:2})
  assert.equal(good.calls[1].opts.headers.Authorization,'Bearer synthetic-session')
  assert.equal(good.calls[1].opts.redirect,'error')
  assert.equal(good.res.headers['Cache-Control'],'private, no-store')
  const rejected=await call('PUT',{enabled:true,cityIndex:2},{user:null})
  assert.equal(rejected.res.code,401)
  assert.equal(rejected.calls.length,1)
  const bad=fakeRes()
  await handleEarthquakeConsent({method:'GET',query:{},headers:{}},bad)
  assert.equal(bad.code,401)
})

test('invalid routes, arbitrary parameters and untrusted payloads cannot reach DB',async()=>{
  for(const [method,body,query,expected] of [
    ['DELETE',{}, {},405],['POST',{}, {},405],
    ['PUT',{enabled:true,cityIndex:7},{},400],
    ['PUT',{enabled:true,cityIndex:0,userId:'other'},{},400],
    ['PUT',{enabled:false}, {user_id:'other'},401],
  ]) {
    const state=await call(method,body,{},query)
    assert.equal(state.res.code,expected)
    assert.equal(state.calls.length,0)
  }
})

test('user can revoke earthquake consent without revoking weather Push devices',async()=>{
  const state=await call('PUT',{enabled:false},{
    result:{...snapshot,enabled:false,city:null,optedInAt:null}
  })
  assert.equal(state.res.code,200)
  assert.deepEqual(JSON.parse(state.calls[1].opts.body).payload,
    {operation:'set',enabled:false})
  assert.equal(state.res.body.deviceCount,1)
})

test('API fails closed on unknown migration/contract and never exposes secrets',async()=>{
  for(const result of [{...snapshot,deliveryEnabled:true},
    {...snapshot,radiusKm:100},{...snapshot,deviceCount:-1},
    {...snapshot,city:null}]) {
    const {res}=await call('GET',undefined,{result})
    assert.equal(res.code,503)
    assert.equal(res.body.deliveryEnabled,false)
  }
  const down=await call('GET',undefined,{rpcStatus:404})
  assert.equal(down.res.code,503)
  assert.equal(JSON.stringify(down.res.body).includes('synthetic-session'),false)
  assert.equal(validEarthquakeConsentSnapshot(snapshot),true)
  assert.equal(validEarthquakeConsentSnapshot({...snapshot,enabled:false,city:null,optedInAt:null}),true)
})

test('candidate planner uses saved city, 300 km, M3, post-consent and max 45min',()=>{
  const near=quake('near',3.2,43.2141,27.9147)
  const regional=quake('regional',4.2,43.2141,30.4)
  const far=quake('far',6,43.2141,34.0)
  const weak=quake('weak',2.8,43.2141,27.9147)
  const beforeConsent=quake('old',4,43.2141,27.9147,NOW-2*60*60_000)
  const future=quake('future',4,43.2141,27.9147,NOW+1000)
  const events=[near,regional,far,weak,beforeConsent,future]
  const prepared=prepareEarthquakeDeliveryPreview(events,[consent],[device],new Set(),NOW)
  assert.deepEqual(prepared.map(x=>x.eventKey),['earthquake:usgs:near','earthquake:usgs:regional'])
  assert.ok(prepared.every(x=>x.source==='USGS'&&x.distanceKm<=300))
  assert.equal(inspectEarthquakeDeliveryCandidate(near,consent,
    {...device,userId:'person-b'},new Set(),NOW),null)
  assert.equal(inspectEarthquakeDeliveryCandidate(near,
    {...consent,enabled:false},device,new Set(),NOW),null)
  assert.equal(inspectEarthquakeDeliveryCandidate(near,consent,
    {...device,revoked:true},new Set(),NOW),null)
})

test('duplicate events and already-reserved device keys cannot create a second candidate',()=>{
  const near=quake('near',3.5,43.2141,27.9147)
  const key='earthquake:usgs:near'
  const once=prepareEarthquakeDeliveryPreview([near,near],[consent,consent],[device,device],new Set(),NOW)
  assert.equal(once.length,1)
  const other={...device,id:'00000000-0000-4000-8000-000000000002'}
  assert.equal(prepareEarthquakeDeliveryPreview([near],[consent],[device,other],
    new Set([`${device.id}:${key}`]),NOW).length,1)
  assert.equal(prepareEarthquakeDeliveryPreview([near],[consent],[device],
    new Set([`${device.id}:${key}`]),NOW).length,0)
})

test('migration reserves consent storage, revocation and untouched delivery gate',()=>{
  const sql=readFileSync('supabase/migrations/20261118093000_earthquake_push_opt_in.sql','utf8')
  assert.match(sql,/force row level security/i)
  assert.match(sql,/revoke all on table public\.earthquake_push_optins/i)
  assert.match(sql,/grant execute on function public\.my_earthquake_push\(jsonb\) to authenticated/i)
  assert.match(sql,/security definer set search_path=''/i)
  assert.match(sql,/uid uuid := auth\.uid\(\)/i)
  assert.match(sql,/delete from public\.earthquake_push_optins where user_id=uid/i)
  assert.match(sql,/public\.push_preferences\s+where user_id=uid for update/i)
  assert.doesNotMatch(sql,/create\s+(?:extension|function)\s+.*(?:cron|send_push|dispatch_push)/i)
})
