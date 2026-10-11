import webpush from 'web-push'
import {Buffer} from 'node:buffer'
import {timingSafeEqual} from 'node:crypto'
import {lookup} from 'node:dns/promises'
import {validateDevice,validVapid,pinnedLookup,sendPinned,retryDelay} from './push-test.mjs'
import {weatherSnapshot,weatherEvents,weatherMessage} from '../../../server/push-weather.js'
const reply=(status,error,stats={})=>new Response(JSON.stringify({error,...stats}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
export function prepareWeatherPush(device,config,now=Date.now()) {
 validateDevice(device,config,device.id)
 const ttl=Math.min(3600,Math.floor((device.end-now)/1000))
 if(ttl<1)throw Error('EXPIRED_EVENT')
 return webpush.generateRequestDetails({endpoint:device.endpoint,keys:{p256dh:device.p256dh,auth:device.auth}},JSON.stringify(weatherMessage(device)),{
  TTL:ttl,urgency:['walk','garden','sport'].includes(device.kind)?'low':'high',contentEncoding:'aes128gcm',
  vapidDetails:{subject:config.subject,publicKey:config.publicKey,privateKey:config.privateKey},
 })
}
// One authenticated, bounded cycle. No browser sender, arbitrary text, URLs or recipients.
export function createWeatherHandler({env,rpc,fetcher=fetch,send=sendPinned,resolver=lookup,now=Date.now,prepare=prepareWeatherPush}) {
 return async req=>{
  if(env.PUSH_WEATHER_DELIVERY_ENABLED!=='true')return reply(503,'PUSH_WEATHER_DISABLED')
  if(req.method!=='POST')return reply(405,'METHOD_NOT_ALLOWED')
  const token=env.PUSH_WEATHER_OPERATOR_TOKEN||'',supplied=req.headers.get('authorization')||''
  if(!/^[A-Za-z0-9_-]{43,128}$/.test(token))return reply(503,'PUSH_WEATHER_UNCONFIGURED')
  const wanted=Buffer.from('Bearer '+token),got=Buffer.from(supplied)
  if(got.length!==wanted.length||!timingSafeEqual(got,wanted))return reply(401,'UNAUTHORIZED')
  if(req.headers.has('origin')||new URL(req.url).search)return reply(400,'INVALID_REQUEST')
  try {
   const reader=req.body?.getReader();if(!reader)return reply(400,'INVALID_REQUEST')
   const chunks=[];let size=0,timer
   try {
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('BODY_TIMEOUT')),2000)})
    for(;;){const item=await Promise.race([reader.read(),timeout]);if(item.done)break;size+=item.value.length;if(size>128)return reply(413,'BODY_TOO_LARGE');chunks.push(Buffer.from(item.value))}
   }finally{clearTimeout(timer);void reader.cancel().catch(()=>{})}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'))
   if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length)return reply(400,'INVALID_REQUEST')
  }catch{return reply(400,'INVALID_REQUEST')}
  const config={publicKey:env.PUSH_VAPID_PUBLIC_KEY,privateKey:env.PUSH_VAPID_PRIVATE_KEY,subject:env.PUSH_VAPID_SUBJECT}
  if(!validVapid(config.publicKey,config.privateKey,config.subject))return reply(503,'PUSH_WEATHER_UNCONFIGURED')
  const deadline=now()+95000,stats={forecasts:0,forecastErrors:0,accepted:0,deliveryErrors:0};let run
  try {
   run=await rpc('begin_weather_push',{key_public:config.publicKey})
   if(!run)return reply(409,'PUSH_WEATHER_NOT_DUE')
   for(const target of run.cities) {
    if(now()>deadline-15000)break
    try {
     const snapshot=await weatherSnapshot(target.city,fetcher,now())
     await rpc('stage_weather_push',{run:run.runId,city_id:target.key,events:weatherEvents(snapshot,now())});stats.forecasts++
    }catch{stats.forecastErrors++} // No fabricated warning or raw provider error.
   }
   for(let i=0;i<5 && now()<deadline-22000;i++) {
    const claim=await rpc('claim_weather_push',{run:run.runId,key_public:config.publicKey})
    if(!claim)break
    let details
    try {validateDevice(claim,config,claim.id)}catch{
     await rpc('finish_weather_push',{job:claim.id,claim:claim.claimId,outcome:'invalid',retry_seconds:0});stats.deliveryErrors++;continue
    }
    try {details=prepare(claim,config,now())}catch{stats.deliveryErrors++;continue} // An expired event/encryption failure does not invalidate a valid device.
    try {
     const dns=await pinnedLookup(new URL(details.endpoint).hostname,resolver)
     if(now()>deadline-18000)break
     const authorized=await rpc('authorize_weather_push',{run:run.runId,job:claim.id,claim:claim.claimId,key_public:config.publicKey})
     if(!authorized){stats.deliveryErrors++;continue}
     const result=await send(details,async()=>new Promise((resolve,reject)=>dns('',{all:true},(error,addresses)=>error?reject(error):resolve(addresses))))
     const outcome=result.status>=200&&result.status<300?'sent':[404,410].includes(result.status)?'expired':result.status===429?'throttled':'failed'
     await rpc('finish_weather_push',{job:claim.id,claim:claim.claimId,outcome,retry_seconds:outcome==='throttled'?retryDelay(result.retryAfter):0})
     if(outcome==='sent')stats.accepted++;else stats.deliveryErrors++
     if(outcome==='throttled')break
    }catch{stats.deliveryErrors++;break} // Uncertain reservations are never retried.
   }
   return reply(stats.deliveryErrors||stats.forecastErrors?503:200,stats.deliveryErrors||stats.forecastErrors?'PUSH_WEATHER_PARTIAL':'PUSH_WEATHER_CHECKED',stats)
  }catch{return reply(503,'PUSH_WEATHER_UNCERTAIN',stats)}
  finally{if(run)try{await rpc('end_weather_push',{run:run.runId})}catch{/* Lease expires without another send. */}}
 }
}
