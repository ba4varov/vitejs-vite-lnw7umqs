// B2b unified severe-weather + recorded-quake worker.
// SECURITY: the public HTTP entry is hard-disabled by SAFETY_WORKER_CODE_ENABLED.
// No schedule, Cron or provider request is activated by adding this module.
import {timingSafeEqual} from 'node:crypto'
import webpush from 'web-push'
import {validVapid,validateDevice} from '../supabase/functions/_shared/push-test.mjs'
import {isFcmEndpoint,prepareNodeAttempt} from './push-node-transport.js'
import {fetchPushForecast} from './push-forecast.js'
import {loadUsgsFeed,earthquakeDedupKey,distanceKm} from './earthquakes-core.js'
import {prepareWeatherSafetyPushPreview} from './safety-push-preview.js'
import {prepareEarthquakeDeliveryPreview} from './earthquake-push-eligibility.js'
import {validPushPreferences} from './push-validation.js'

export const SAFETY_WORKER_CODE_ENABLED=false
export const MAX_TARGETS_PER_RUN=20
export const MAX_ATTEMPTS_PER_RUN=3
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_RPC=new Set(['safety_worker_targets','reserve_safety_push','burn_safety_push','finish_safety_push'])
const KINDS={rain:'силни валежи',storm:'гръмотевична буря',wind:'силен вятър',cold:'опасен студ',heat:'опасна жега'}

const goodToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(value)
const validDb=base=>typeof base==='string'&&/^https:\/\/[a-z]{20}\.supabase\.co$/.test(base)
const validKey=key=>typeof key==='string'&&/^[A-Za-z0-9_.-]{20,8192}$/.test(key)
const reply=(status,error)=>new Response(JSON.stringify({error,deliveryEnabled:false}),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
})

export function workerConfigured(env) {
  if(!SAFETY_WORKER_CODE_ENABLED||env.VERCEL!=='1'||env.VERCEL_ENV!=='production'||
     env.PUSH_SAFETY_WORKER_ENABLED!=='true'||process.versions.node.split('.')[0]!=='24')
    return false
  return validDb(env.SUPABASE_URL)&&validKey(env.SUPABASE_SERVICE_ROLE_KEY)&&
    goodToken(env.PUSH_SAFETY_CRON_TOKEN)&&validVapid(
      env.PUSH_VAPID_PUBLIC_KEY,env.PUSH_NODE_VAPID_PRIVATE_KEY,env.PUSH_VAPID_SUBJECT)
}

export function createSafetyDbRpc(config,fetcher=fetch){
  return async(name,args)=>{
    if(!ALLOWED_RPC.has(name))throw Error('UNSUPPORTED_RPC')
    const response=await fetcher(config.base+'/rest/v1/rpc/'+name,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{apikey:config.key,Authorization:'Bearer '+config.key,'Content-Type':'application/json'},
      body:JSON.stringify(args||{})
    })
    if(!response.ok){void response.body?.cancel().catch(()=>{});throw Error('DB_RPC_UNAVAILABLE')}
    // Never echo subscriptions, city data, key material, or raw database errors.
    const size=Number(response.headers?.get('content-length')||0)
    if(Number.isFinite(size)&&size>100000)throw Error('DB_RESPONSE_TOO_LARGE')
    const reader=response.body?.getReader()
    if(!reader)throw Error('DB_RESPONSE_UNAVAILABLE')
    let chunks=[],total=0
    try{
      while(true){
        const {done,value}=await reader.read()
        if(done)break
        total+=value.length
        if(total>100000)throw Error('DB_RESPONSE_TOO_LARGE')
        chunks.push(Buffer.from(value))
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    }finally{chunks=[];void reader.cancel().catch(()=>{})}
  }
}

export function validWorkerTarget(t,config,now=Date.now()) {
  if(!t||!UUID.test(t.deviceId||'')||!UUID.test(t.userId||'')||
     typeof t.endpoint!=='string'||!isFcmEndpoint(t.endpoint)||
     t.publicKey!==config.publicKey||typeof t.p256dh!=='string'||
     typeof t.auth!=='string'||(![null,undefined].includes(t.expiresAt)&&
       (!Number.isFinite(t.expiresAt)||t.expiresAt<=now)))return false
  try {
    validateDevice({
      endpoint:t.endpoint,p256dh:t.p256dh,auth:t.auth,publicKey:t.publicKey
    },config,t.deviceId)
    return true
  }catch{return false}
}

function quakeCandidate(event,city) {
  return {channel:'earthquake',eventKey:earthquakeDedupKey(event),city,
    latitude:event.lat,longitude:event.lon,magnitude:event.magnitude,occurredAt:event.time}
}
function weatherCandidate(item,city) {
  return {channel:'weather',eventKey:item.eventKey,kind:item.riskKind,
    city,startsAt:item.startsAt}
}
const simpleCity=city=>({name:city.name,latitude:city.latitude,
  longitude:city.longitude,zone:city.zone})
const cityId=city=>JSON.stringify([city.latitude,city.longitude,city.zone])

// Candidates are server-computed from official source responses, never from
// a public request body. The SQL gate rechecks both current consent and device.
export async function selectSafetyCandidates(targets,{
  fetcher=fetch,now=Date.now(),readEarthquakes=loadUsgsFeed,
  readForecast=fetchPushForecast
}={}) {
  if(!Array.isArray(targets)||targets.length>MAX_TARGETS_PER_RUN)return []
  const found=[],seen=new Set(),forecasts=new Map()
  // Batch only ten distinct city forecasts per invocation to bound usage.
  // Start the USGS request and all weather calls together, not serially.
  const quakePromise=targets.some(t=>t?.earthquake?.enabled)?
    Promise.resolve().then(()=>readEarthquakes({fetcher,now})).catch(()=>null):
    Promise.resolve(null)
  for(const t of targets){
    if(!t?.weather?.enabled||!validPushPreferences(t.weather))continue
    for(const city of t.weather.cities){
      const id=cityId(city)
      if(forecasts.has(id)||forecasts.size>=10)continue
      forecasts.set(id,Promise.resolve().then(()=>readForecast(city,fetcher,now))
        .catch(()=>null))
    }
  }
  const response=await quakePromise
  const quakes=response&&!response.stale&&response.checkedAt<=now&&
    now-response.checkedAt<120000&&Array.isArray(response.events)?
    response.events:[]
  for(const t of targets){
    const userId=t?.userId
    if(typeof userId!=='string'||!UUID.test(t.deviceId||'')||!UUID.test(userId))continue
    const device={id:t.deviceId,userId,expiresAt:t.expiresAt,revoked:false}
    const prefs=t.weather
    if(prefs?.enabled&&validPushPreferences(prefs)){
      for(const city of prefs.cities){
        const fingerprint=cityId(city)
        if(!forecasts.has(fingerprint))continue // hard API budget cap
        const snapshot=await forecasts.get(fingerprint)
        if(!snapshot)continue
        for(const item of prepareWeatherSafetyPushPreview(
          snapshot,prefs,{plan:'free'},userId,[device],new Set(),now
        )){
          const compound=item.deviceId+':'+item.eventKey
          if(seen.has(compound))continue
          seen.add(compound)
          found.push({device:t,record:weatherCandidate(item,simpleCity(city)),
            view:{kind:item.riskKind,city:city.name,startsAt:item.startsAt}})
        }
      }
    }
    const opt=t.earthquake
    if(opt?.enabled&&opt?.city&&Number.isFinite(opt.optedInAt)&&quakes.length){
      const consent={enabled:true,userId,city:opt.city,optedInAt:opt.optedInAt}
      const candidateEvents=prepareEarthquakeDeliveryPreview(quakes,[consent],[device],
        new Set(),now)
      const byKey=new Map(quakes.map(e=>[earthquakeDedupKey(e),e]))
      for(const item of candidateEvents){
        const earthquake=byKey.get(item.eventKey)
        if(!earthquake)continue
        const compound=item.deviceId+':'+item.eventKey
        if(seen.has(compound))continue
        seen.add(compound)
        found.push({device:t,record:quakeCandidate(earthquake,opt.city),
          view:{kind:'earthquake',city:opt.city.name,magnitude:earthquake.magnitude,
            distanceKm:distanceKm({lat:opt.city.latitude,lon:opt.city.longitude},earthquake)}})
      }
    }
  }
  return found.slice(0,100)
}

// Only short bounded, verified event data can be included in the notification.
export function safetyNotification(candidate) {
  const city=typeof candidate?.view?.city==='string'?
    candidate.view.city.replace(/[\r\n<>]/g,'').slice(0,80):''
  const kind=candidate?.view?.kind
  if(!city)return null
  const eventId=candidate?.record?.eventKey
  if(typeof eventId!=='string'||eventId.length>180)return null
  let body
  if(kind==='earthquake'){
    const mag=candidate.view.magnitude,km=candidate.view.distanceKm
    if(!Number.isFinite(mag)||mag<3||!Number.isFinite(km)||km<0||km>300)return null
    body='Регистрирано земетресение M '+mag.toFixed(1)+
      ', на около '+Math.round(km)+' км от '+city+'. Източник: USGS.'
  }else{
    if(!Object.hasOwn(KINDS,kind)||!Number.isFinite(candidate.view.startsAt))return null
    const when=new Intl.DateTimeFormat('bg-BG',{
      timeZone:'Europe/Sofia',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'
    }).format(candidate.view.startsAt)
    body='Очаква се '+KINDS[kind]+' за '+city+' около '+when+
      '. Прогноза: Open-Meteo. Възможна е промяна.'
  }
  return {title:kind==='earthquake'?'Метео Пулс — земетресение':
    'Метео Пулс — опасно време',body:body.slice(0,240),eventId}
}

export function prepareSafetyPush(device,vapid,eventId,payload) {
  const v={endpoint:device.endpoint,p256dh:device.p256dh,auth:device.auth,
    publicKey:device.publicKey}
  validateDevice(v,vapid,eventId)
  if(!payload||!/^.{2,80}$/.test(payload.title)||typeof payload.body!=='string'||
    payload.body.length>240||payload.eventId!==undefined&&
    (!/^.{1,180}$/.test(payload.eventId)))throw Error('INVALID_NOTIFICATION')
  return webpush.generateRequestDetails({
    endpoint:v.endpoint,keys:{p256dh:v.p256dh,auth:v.auth}
  },JSON.stringify(payload),{
    TTL:60,urgency:'very-low',contentEncoding:'aes128gcm',
    vapidDetails:{subject:vapid.subject,publicKey:vapid.publicKey,
      privateKey:vapid.privateKey}
  })
}

// Controlled non-HTTP engine used by unit tests; the production HTTP entry
// remains permanently hard-disabled in this PR.
export async function runSafetyDispatch({
  config,dbRpc,fetcher=fetch,readEarthquakes=loadUsgsFeed,
  readForecast=fetchPushForecast,prepareTransport=prepareNodeAttempt,
  prepareDetails=prepareSafetyPush,now=Date.now(),signal
}) {
  if(!config||!validVapid(config.publicKey,config.privateKey,config.subject)||
     typeof dbRpc!=='function')throw Error('SAFETY_WORKER_UNCONFIGURED')
  const all=[]
  let cursor=null
  for(let page=0;page<2;page++){
    const rows=await dbRpc('safety_worker_targets',{max_rows:10,after_device:cursor})
    if(!Array.isArray(rows)||rows.length>10)throw Error('INVALID_TARGETS')
    for(const row of rows)if(validWorkerTarget(row,config,now))all.push(row)
    if(rows.length<10)break
    cursor=rows[rows.length-1]?.deviceId
    if(!UUID.test(cursor||''))throw Error('INVALID_TARGET_CURSOR')
  }
  const candidates=await selectSafetyCandidates(all,{
    fetcher,now,readEarthquakes,readForecast
  })
  let reserved=0,attempted=0,accepted=0,uncertain=0
  for(const item of candidates){
    if(reserved>=MAX_ATTEMPTS_PER_RUN||signal?.aborted)break
    const payload=safetyNotification(item)
    if(!payload)continue
    const attempt=await dbRpc('reserve_safety_push',{
      target_device:item.device.deviceId,candidate:item.record
    })
    if(attempt==null)continue
    if(!UUID.test(attempt))throw Error('INVALID_RESERVATION')
    reserved++
    try{
      // Encrypt and validate the allowlisted FCM endpoint + pin DNS BEFORE burn.
      const details=prepareDetails(item.device,config,attempt,payload)
      const sendOnce=await prepareTransport(details,undefined,signal)
      if(typeof sendOnce!=='function')throw Error('INVALID_TRANSPORT')
      // This RPC must commit the irreversible uncertain record before sendOnce.
      if(await dbRpc('burn_safety_push',{attempt})!==true)continue
      attempted++
      try{
        const response=await sendOnce()
        let result
        if(response.status>=200&&response.status<300){result='provider_accepted';accepted++}
        else if([404,410].includes(response.status))result='subscription_expired'
        else if(response.status>=300&&response.status<=599)result='provider_rejected'
        else {uncertain++;continue}
        // A failed finish never authorizes a second provider attempt.
        try{await dbRpc('finish_safety_push',{attempt,result})}catch{uncertain++}
      }catch{uncertain++} // No provider/network retry under ANY circumstances.
    }catch{ /* A failed preflight/reservation is consumed. No retry. */ }
  }
  return {devicesScanned:all.length,candidates:candidates.length,reserved,
    attempted,providerAccepted:accepted,uncertain,
    deliveryEnabled:true}
}

export function createSafetyWorkerHandler({
  env=process.env,fetcher=fetch,execute=runSafetyDispatch
}={}) {
  return async function handle(request) {
    // No secret reads, DB connections, provider DNS or notifications when off.
    if(!SAFETY_WORKER_CODE_ENABLED)return reply(503,'SAFETY_WORKER_DISABLED')
    if(env.VERCEL!=='1'||env.VERCEL_ENV!=='production'||
      env.PUSH_SAFETY_WORKER_ENABLED!=='true')return reply(503,'SAFETY_WORKER_DISABLED')
    if(!workerConfigured(env))return reply(503,'SAFETY_WORKER_UNCONFIGURED')
    if(request.method!=='POST')return reply(405,'METHOD_NOT_ALLOWED')
    const url=new URL(request.url)
    if(url.search||request.headers.has('origin')||request.headers.has('referer')||
      Number(request.headers.get('content-length')||0)>2 ||
      (request.headers.get('content-type')&&!/application\/json/i.test(
        request.headers.get('content-type'))))return reply(400,'INVALID_REQUEST')
    const secret='Bearer '+env.PUSH_SAFETY_CRON_TOKEN
    const supplied=request.headers.get('authorization')||''
    const x=Buffer.from(secret),y=Buffer.from(supplied)
    if(x.length!==y.length||!timingSafeEqual(x,y))return reply(401,'UNAUTHORIZED')
    try{
      const text=await request.text()
      if(text!==''&&text!=='{}')return reply(400,'INVALID_REQUEST')
      const config={
        base:env.SUPABASE_URL.replace(/\/$/,''),key:env.SUPABASE_SERVICE_ROLE_KEY,
        publicKey:env.PUSH_VAPID_PUBLIC_KEY,
        privateKey:env.PUSH_NODE_VAPID_PRIVATE_KEY,
        subject:env.PUSH_VAPID_SUBJECT
      }
      const results=await execute({
        config,dbRpc:createSafetyDbRpc(config,fetcher),fetcher,
        signal:AbortSignal.any([request.signal,AbortSignal.timeout(35000)])
      })
      return new Response(JSON.stringify(results),{
        status:200,headers:{'Content-Type':'application/json',
          'Cache-Control':'private, no-store'}
      })
    }catch{return reply(503,'SAFETY_WORKER_UNAVAILABLE')}
  }
}
export const handleSafetyWorker=createSafetyWorkerHandler()
