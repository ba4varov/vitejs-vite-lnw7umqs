import test from 'node:test'
import assert from 'node:assert/strict'
import {createECDH} from 'node:crypto'
import webpush from 'web-push'
import {
  SAFETY_WORKER_CODE_ENABLED,MAX_TARGETS_PER_RUN,MAX_ATTEMPTS_PER_RUN,
  createSafetyWorkerHandler,workerConfigured,validWorkerTarget,
  safetyNotification,prepareSafetyPush,selectSafetyCandidates,runSafetyDispatch
} from '../../server/safety-push-worker.js'
import {EARTHQUAKE_PUSH_DELIVERY_ENABLED} from '../../server/earthquakes-core.js'
import {WEATHER_PUSH_DELIVERY_ENABLED} from '../../server/safety-push-preview.js'

const NOW=Date.parse('2026-11-18T11:00:00Z')
const vapid=webpush.generateVAPIDKeys()
const config={publicKey:vapid.publicKey,privateKey:vapid.privateKey,
  subject:'mailto:weather-test@example.invalid'}
const ecdh=createECDH('prime256v1');ecdh.generateKeys()
const device={
  userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  deviceId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  endpoint:'https://fcm.googleapis.com/wp/valid-test-token',
  publicKey:config.publicKey,p256dh:ecdh.getPublicKey().toString('base64url'),
  auth:Buffer.alloc(16,7).toString('base64url'),expiresAt:null
}
const city={name:'Varna',latitude:43.2141,longitude:27.9147,zone:'UTC'}
const preferences={enabled:true,cities:[city],
  categories:['rain','wind','storm']}
const quake={id:'usgs:ci20261118',source:'USGS',lat:43.2141,lon:28.5,
  magnitude:3.8,time:NOW-120000}
const target={...device,weather:preferences,
  earthquake:{enabled:true,city,optedInAt:NOW-3600000}}
const fakeQuakes=async()=>({events:[quake],stale:false,checkedAt:NOW})
const snapshot=async c=>{
  const hours=Array.from({length:48},(_,i)=>({
    time:new Date(NOW+(i-1)*3600000).toISOString().slice(0,16),
    feelsLike:22,rainProbability:10,rain:0,wind:5,code:0
  }))
  hours[3].wind=75;hours[5].rain=11;hours[6].code=95
  return {city:c,source:'server-open-meteo',fetchedAt:NOW,
    forecast:{timeZone:'UTC',hours}}
}
const emptyQuakes=async()=>({events:[],stale:false,checkedAt:NOW})
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const deps={
  now:NOW,readForecast:snapshot,readEarthquakes:fakeQuakes,
  config,prepareDetails:(_d,_c,_event,_payload)=>({
    endpoint:device.endpoint,body:Buffer.from('fixture'),headers:{}
  }),
  prepareTransport:async()=>async()=>({status:201})
}

test('HTTP worker is statically OFF, even if every environment switch is spoofed',async()=>{
  assert.equal(SAFETY_WORKER_CODE_ENABLED,false)
  assert.equal(WEATHER_PUSH_DELIVERY_ENABLED,false)
  assert.equal(EARTHQUAKE_PUSH_DELIVERY_ENABLED,false)
  assert.equal(MAX_ATTEMPTS_PER_RUN,3)
  assert.equal(MAX_TARGETS_PER_RUN,20)
  const env={VERCEL:'1',VERCEL_ENV:'production',PUSH_SAFETY_WORKER_ENABLED:'true'}
  for(const key of ['SUPABASE_SERVICE_ROLE_KEY','PUSH_SAFETY_CRON_TOKEN',
    'PUSH_NODE_VAPID_PRIVATE_KEY']){
    Object.defineProperty(env,key,{get(){throw Error('SECRET_READ_WHILE_OFF')}})
  }
  assert.equal(workerConfigured(env),false)
  const handler=createSafetyWorkerHandler({
    env,fetcher:async()=>{throw Error('NETWORK_WHILE_OFF')},
    execute:async()=>{throw Error('DISPATCH_WHILE_OFF')}
  })
  const response=await handler(new Request('https://meteo-puls.invalid/api/push',{
    method:'POST',body:'{}',headers:{Authorization:'Bearer fixture'}
  }))
  assert.equal(response.status,503)
  assert.equal((await response.json()).error,'SAFETY_WORKER_DISABLED')
})

test('FCM-only target validation is strict and excludes other push vendors for now',()=>{
  assert.equal(validWorkerTarget(device,config,NOW),true)
  for(const other of [
    {...device,endpoint:'https://example.invalid/push/123'},
    {...device,endpoint:'https://web.push.apple.com/ABC'},
    {...device,publicKey:'another-key'},
    {...device,expiresAt:NOW-1},
    {...device,userId:'stranger'},
    {...device,p256dh:'invalid'},
    {...device,auth:'invalid'},
  ])assert.equal(validWorkerTarget(other,config,NOW),false)
})

test('source-scoped dual-channel planner caches forecasts across devices',async()=>{
  let forecasts=0,quakeRequests=0
  const second={...target,deviceId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}
  const candidates=await selectSafetyCandidates([target,second],{
    now:NOW,
    readForecast:async c=>{forecasts++;return snapshot(c)},
    readEarthquakes:async()=>{quakeRequests++;return fakeQuakes()}
  })
  assert.equal(forecasts,1)
  assert.equal(quakeRequests,1)
  assert.equal(candidates.filter(x=>x.record.channel==='earthquake').length,2)
  assert.equal(candidates.filter(x=>x.record.channel==='weather').length,6)
  assert.equal(new Set(candidates.map(x=>x.device.deviceId+':'+x.record.eventKey)).size,
    candidates.length)
  assert.ok(candidates.every(c=>c.record.city.name==='Varna'))
  assert.ok(candidates.filter(c=>c.record.channel==='weather').every(c=>
    c.record.eventKey.startsWith('weather:open-meteo:')))
  assert.ok(candidates.filter(c=>c.record.channel==='earthquake').every(c=>
    c.record.eventKey==='earthquake:usgs:ci20261118'))
})

test('separate consents and missing providers never invent any danger',async()=>{
  const onlyWeather=await selectSafetyCandidates([
    {...target,earthquake:null}],{
      now:NOW,readForecast:snapshot,readEarthquakes:fakeQuakes
    })
  assert.ok(onlyWeather.length>0)
  assert.ok(onlyWeather.every(c=>c.record.channel==='weather'))
  const onlyQuake=await selectSafetyCandidates([
    {...target,weather:null}],{
      now:NOW,readForecast:snapshot,readEarthquakes:fakeQuakes
    })
  assert.equal(onlyQuake.length,1)
  assert.equal(onlyQuake[0].record.channel,'earthquake')
  const stale=await selectSafetyCandidates([
    {...target,weather:null}],{now:NOW,readEarthquakes:async()=>({
      events:[quake],checkedAt:NOW-5*60_000,stale:true
    })})
  assert.deepEqual(stale,[])
  const noConsent=await selectSafetyCandidates([
    {...target,weather:{...preferences,enabled:false},
      earthquake:{...target.earthquake,enabled:false}}],{
      now:NOW,readForecast:snapshot,readEarthquakes:fakeQuakes
    })
  assert.deepEqual(noConsent,[])
  const missingForecast=await selectSafetyCandidates([target],{
    now:NOW,readForecast:async()=>{throw Error('SOURCE_DOWN')},
    readEarthquakes:emptyQuakes
  })
  assert.deepEqual(missingForecast,[])
})

test('messages distinguish forecast estimates from registered earthquakes, never NIMH codes',async()=>{
  const planned=await selectSafetyCandidates([target],{
    now:NOW,readForecast:snapshot,readEarthquakes:fakeQuakes
  })
  const quakeMessage=safetyNotification(planned.find(c=>c.record.channel==='earthquake'))
  assert.match(quakeMessage.body,/Регистрирано земетресение M 3\.8/)
  assert.match(quakeMessage.body,/USGS/)
  const wind=safetyNotification(planned.find(c=>c.record.kind==='wind'))
  assert.match(wind.body,/Очаква се силен вятър/)
  assert.match(wind.body,/Open-Meteo/)
  assert.doesNotMatch(wind.body,/НИМХ|червен код|оранжев код/)
  assert.equal(safetyNotification({view:{kind:'wind',city:'A'},record:{eventKey:'x'}}),null)
})

test('encrypted aes128gcm Web Push payload uses existing VAPID and supports service-worker eventId',()=>{
  const payload={title:'Метео Пулс — опасно време',
    body:'Очаква се силен вятър във Варна. Прогноза: Open-Meteo.',
    eventId:'weather:open-meteo:00000000000000000000000000000000:wind:2026-11-18'}
  const details=prepareSafetyPush(device,config,device.deviceId,payload)
  assert.equal(details.endpoint,device.endpoint)
  assert.equal(details.method,'POST')
  assert.ok(Buffer.isBuffer(details.body)&&details.body.length<2048)
  const headers=Object.fromEntries(Object.entries(details.headers).map(([k,v])=>
    [k.toLowerCase(),String(v)]))
  assert.equal(headers['content-encoding'],'aes128gcm')
  assert.equal(headers['content-type'],'application/octet-stream')
  assert.equal(headers['urgency'],'very-low')
  assert.equal(headers['ttl'],'60')
  assert.equal(headers['content-length'],String(details.body.length))
})

function fixture({targets=[target],deny=false,transport,finishError=false}={}){
  const calls=[],delivery=new Set(),finishes=[],states=new Map()
  let seq=0,network=0
  const rpc=async(name,args)=>{
    calls.push(name)
    if(name==='safety_worker_targets')return targets
    if(name==='reserve_safety_push'){
      const key=args.target_device+':'+args.candidate.eventKey
      if(deny||delivery.has(key))return null
      delivery.add(key);const id=uuid(++seq);states.set(id,'reserved')
      return id
    }
    if(name==='burn_safety_push'){
      if(states.get(args.attempt)!=='reserved')return false
      states.set(args.attempt,'uncertain');return true
    }
    if(name==='finish_safety_push'){
      if(finishError)throw Error('FINISH_UNKNOWN')
      finishes.push(args);states.set(args.attempt,args.result);return true
    }
    throw Error('UNEXPECTED_RPC')
  }
  const run=async(custom={})=>runSafetyDispatch({...deps,dbRpc:rpc,
    readEarthquakes:emptyQuakes,prepareTransport:async()=>{
      return async()=>{network++;return transport?transport():{status:201}}
    },...custom})
  return {calls,states,finishes,run,get network(){return network}}
}

test('one attempt per device/event; DB reserve then burn before any provider call',async()=>{
  const f=fixture({targets:[{...target,earthquake:null,
    weather:{...preferences,categories:['wind']}}]})
  const first=await f.run()
  assert.equal(first.providerAccepted,1)
  assert.equal(first.attempted,1)
  assert.equal(f.network,1)
  assert.ok(f.calls.indexOf('reserve_safety_push')<
    f.calls.indexOf('burn_safety_push'))
  assert.ok(f.calls.indexOf('burn_safety_push')<
    f.calls.indexOf('finish_safety_push'))
  const second=await f.run()
  assert.equal(second.attempted,0)
  assert.equal(f.network,1)
  assert.equal(f.finishes.length,1)
})

test('concurrent worker invocations share durable DB key and never double-send',async()=>{
  const f=fixture({targets:[{...target,earthquake:null,
    weather:{...preferences,categories:['wind']}}]})
  const [a,b]=await Promise.all([f.run(),f.run()])
  assert.equal(a.attempted+b.attempted,1)
  assert.equal(f.network,1)
})

test('unknown provider outcomes are burned but never replayed',async()=>{
  const f=fixture({targets:[{...target,earthquake:null,
    weather:{...preferences,categories:['wind']}}],
    transport:async()=>{throw Error('SECRET_NEVER_LEAK')}})
  const a=await f.run()
  const b=await f.run()
  assert.equal(a.uncertain,1)
  assert.equal(b.attempted,0)
  assert.equal(f.network,1)
  assert.equal(f.finishes.length,0)
  assert.equal([...f.states.values()][0],'uncertain')
  assert.equal(JSON.stringify(a).includes('SECRET_NEVER_LEAK'),false)
})

test('revocation between reserve and final burn prevents network attempt',async()=>{
  const f=fixture({targets:[{...target,earthquake:null,
    weather:{...preferences,categories:['wind']}}]})
  const overrides={
    dbRpc:async(name,_args)=>{
      if(name==='safety_worker_targets')return [target]
      if(name==='reserve_safety_push')return uuid(12)
      if(name==='burn_safety_push')return false
      if(name==='finish_safety_push')throw Error('MUST_NOT_FINISH')
    }
  }
  const out=await f.run(overrides)
  assert.equal(out.attempted,0)
  assert.equal(f.network,0)
})

test('provider error accepted/rejected are terminal, never retried after HTTP 410',async()=>{
  const f=fixture({targets:[{...target,earthquake:null,
    weather:{...preferences,categories:['wind']}}],
    transport:async()=>({status:410})})
  const out=await f.run()
  assert.equal(out.providerAccepted,0)
  assert.deepEqual(f.finishes.map(x=>x.result),['subscription_expired'])
  assert.equal((await f.run()).attempted,0)
})
