// Network-isolated Supabase Edge Runtime fixture ONLY. Never deploy this service.
import webpush from 'web-push'
import {Buffer} from 'node:buffer'
import {readFileSync} from 'node:fs'
import {createWeatherHandler} from '../../supabase/functions/_shared/push-weather.mjs'
import {sendPinned} from '../../supabase/functions/_shared/push-test.mjs'
import {denoConnector} from '../../supabase/functions/_shared/push-deno.ts'
Deno.serve(async()=>{
 const start=performance.now(),now=Date.now(),hour=3600000,epoch=Math.floor(now/hour)*hour
 const keys=webpush.generateVAPIDKeys(),receiver=webpush.generateVAPIDKeys(),runId='e0000000-0000-0000-0000-000000000001'
 const env={PUSH_WEATHER_DELIVERY_ENABLED:'true',PUSH_WEATHER_OPERATOR_TOKEN:'A'.repeat(43),PUSH_VAPID_PUBLIC_KEY:keys.publicKey,PUSH_VAPID_PRIVATE_KEY:keys.privateKey,PUSH_VAPID_SUBJECT:'mailto:test@example.invalid'}
 const city={name:'Isolated',latitude:42,longitude:23,zone:'Europe/Sofia'},calls:string[]=[]
 let claims=0,staged=0,sent=0,encrypted=true
 const cert=readFileSync('/fixtures/ca.pem').toString('utf8')
 const connector=denoConnector({...Deno,
  connect:options=>{if(options.hostname!=='8.8.8.8')throw Error('UNPINNED');return Deno.connect({...options,hostname:'127.0.0.1',port:9443})},
  startTls:(tcp,options)=>Deno.startTls(tcp,{...options,caCerts:[cert]}),
 })
 const handler=createWeatherHandler({env,now:()=>now,resolver:async()=>[{address:'8.8.8.8',family:4}],
  rpc:async(name,payload)=>{
   calls.push(name)
   if(name==='begin_weather_push')return {runId,cities:Array.from({length:5},(_,i)=>({key:'test-'+i,city:{...city,latitude:42+i}}))}
   if(name==='stage_weather_push'){if(!payload.events.some(e=>e.kind==='wind'))throw Error('MISSING_WARNING');staged++;return 1}
   if(name==='claim_weather_push')return {id:'e1000000-0000-0000-0000-'+String(++claims).padStart(12,'0'),claimId:runId,endpoint:'https://fcm.googleapis.com/wp/isolated',publicKey:keys.publicKey,p256dh:receiver.publicKey,auth:Buffer.alloc(16,1).toString('base64url'),language:claims%2?'bg':'en',city,kind:'wind',start:epoch,end:epoch+hour}
   if(name==='authorize_weather_push')return true
  },
  fetcher:async()=>Response.json({timezone:city.zone,current:{time:epoch/1000},hourly_units:{time:'unixtime',apparent_temperature:'°C',precipitation_probability:'%',precipitation:'mm',wind_speed_10m:'km/h',weather_code:'wmo code'},hourly:{time:Array.from({length:72},(_,i)=>(epoch+i*hour)/1000),apparent_temperature:Array(72).fill(20),precipitation_probability:Array(72).fill(10),precipitation:Array(72).fill(0),wind_speed_10m:Array(72).fill(80),weather_code:Array(72).fill(0)}}),
  send:async(details)=>{
   if(calls.at(-1)!=='authorize_weather_push')throw Error('UNAUTHORIZED_SEND')
   encrypted=encrypted&&details.body.length>0&&details.headers['Content-Encoding']==='aes128gcm'&&details.headers.Authorization.startsWith('vapid ')
   const result=await sendPinned(details,async()=>[{address:'8.8.8.8',family:4}],connector);sent++;return result
  },
 })
 const response=await handler(new Request('https://local.invalid/push-check',{method:'POST',headers:{authorization:'Bearer '+env.PUSH_WEATHER_OPERATOR_TOKEN},body:'{}'}))
 const body=await response.json(),released=calls.at(-1)==='end_weather_push'
 return Response.json({status:response.status,staged,sent,encrypted,released,elapsedMs:Math.round(performance.now()-start),accepted:body.accepted},{status:response.status===200&&staged===5&&sent===5&&encrypted&&released&&body.accepted===5?200:500})
})
