import test from 'node:test'
import assert from 'node:assert/strict'
import {weatherSnapshot,weatherEvents,weatherMessage} from '../../server/push-weather.js'
import {createWeatherHandler,prepareWeatherPush} from '../../supabase/functions/_shared/push-weather.mjs'
import webpush from 'web-push'
import {createECDH,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto'
const now=Date.parse('2026-10-11T09:30Z'),hour=3600000,city={name:'София',latitude:42.6977,longitude:23.3219,zone:'Europe/Sofia'}
function forecast(at=now,changes={}) {
 const start=Math.floor(at/hour)*hour
 return {timezone:city.zone,current:{time:start/1000},hourly_units:{time:'unixtime',apparent_temperature:'°C',precipitation_probability:'%',precipitation:'mm',wind_speed_10m:'km/h',weather_code:'wmo code'},hourly:{time:Array.from({length:72},(_,i)=>(start+i*hour)/1000),apparent_temperature:Array(72).fill(20),precipitation_probability:Array(72).fill(10),precipitation:Array(72).fill(0),wind_speed_10m:Array(72).fill(10),weather_code:Array(72).fill(0),...changes}}
}
const response=data=>new Response(JSON.stringify(data))
test('server-only fixed source, bounded response, explicit units and strict freshness/data validation',async()=>{
 let url,options
 const snapshot=await weatherSnapshot(city,async(u,o)=>{url=new URL(u);options=o;return response(forecast())},now)
 assert.equal(url.origin,'https://api.open-meteo.com');assert.equal(url.searchParams.get('timeformat'),'unixtime');assert.equal(options.redirect,'error')
 assert.equal(snapshot.hours.length,72)
 for(const data of [{...forecast(),timezone:'UTC'},{...forecast(),current:{time:now/1000-91*60}},{...forecast(),hourly_units:{...forecast().hourly_units,wind_speed_10m:'m/s'}},forecast(now,{time:Array(72).fill(now/1000)}),forecast(now,{precipitation:[-1,...Array(71).fill(0)]}),forecast(now,{wind_speed_10m:Array(72).fill(401)}),forecast(now,{weather_code:Array(72).fill(1000)}),forecast(now,{time:forecast().hourly.time.slice(1)})])await assert.rejects(weatherSnapshot(city,async()=>response(data),now))
 await assert.rejects(weatherSnapshot(city,async()=>new Response('a'.repeat(150001)),now))
 await assert.rejects(weatherSnapshot(city,async()=>new Response('',{status:429}),now))
})
test('shared risk thresholds, categories, contiguous periods, 24-hour horizon and daily Pro windows',async()=>{
 const h=forecast();h.hourly.wind_speed_10m[0]=60;h.hourly.wind_speed_10m[1]=70;h.hourly.precipitation[3]=10;h.hourly.weather_code[4]=95;h.hourly.apparent_temperature[5]=-15;h.hourly.apparent_temperature[6]=40
 const snapshot=await weatherSnapshot(city,async()=>response(h),now),events=weatherEvents(snapshot,now)
 assert.deepEqual(events.filter(e=>['rain','storm','wind','cold','heat'].includes(e.kind)).map(e=>e.kind),['wind','rain','storm','cold','heat'])
 const wind=events.find(e=>e.kind==='wind');assert.equal(wind.end-wind.start,2*hour)
 for(const kind of ['walk','garden','sport'])assert.ok(events.some(e=>e.kind===kind))
 assert.ok(events.every(e=>e.end>now&&e.start<now+24*hour))
 assert.throws(()=>weatherEvents(snapshot,now+16*60000),/STALE/)
 const constant=await weatherSnapshot(city,async()=>response(forecast(now,{wind_speed_10m:Array(72).fill(80)})),now)
 const event=weatherEvents(constant,now)[0];assert.equal(event.end-event.start,24*hour)
})
test('epoch hours survive DST fallback and both notification languages include local periods and source',async()=>{
 const at=Date.parse('2026-10-25T00:00Z'),snapshot=await weatherSnapshot(city,async()=>response(forecast(at,{wind_speed_10m:Array(72).fill(80)})),at)
 const event=weatherEvents(snapshot,at).find(e=>e.kind==='wind');assert.equal(event.end-event.start,24*hour)
 for(const language of ['bg','en']) {
  const message=weatherMessage({...event,id:'00000000-0000-0000-0000-000000000001',city,language})
  assert.match(message.body,/Open-Meteo/);assert.match(message.body,language==='bg'?/Силен вятър/:/Strong wind/);assert.ok(message.body.length<=240)
 }
})
const keys=webpush.generateVAPIDKeys(),config={publicKey:keys.publicKey,privateKey:keys.privateKey,subject:'mailto:operator@example.invalid'}
const env={PUSH_WEATHER_DELIVERY_ENABLED:'true',PUSH_WEATHER_OPERATOR_TOKEN:randomBytes(32).toString('base64url'),PUSH_VAPID_PUBLIC_KEY:keys.publicKey,PUSH_VAPID_PRIVATE_KEY:keys.privateKey,PUSH_VAPID_SUBJECT:config.subject}
const receiver=createECDH('prime256v1');receiver.generateKeys();const auth=randomBytes(16)
const claim={id:'c0000000-0000-0000-0000-000000000001',claimId:'c0000000-0000-0000-0000-000000000002',endpoint:'https://fcm.googleapis.com/wp/isolated-weather',p256dh:receiver.getPublicKey().toString('base64url'),auth:auth.toString('base64url'),publicKey:keys.publicKey,language:'en',city,kind:'wind',start:now,end:now+hour}
const request=(body={},headers={})=>new Request('https://edge.example.invalid/push-check',{method:'POST',headers:{authorization:'Bearer '+env.PUSH_WEATHER_OPERATOR_TOKEN,...headers},body:JSON.stringify(body)})
const resolver=async()=>[{address:'142.250.74.234',family:4}]
test('actual weather payload uses RFC encryption, bounded TTL and selected locale',()=>{
 const details=prepareWeatherPush(claim,config,now),body=details.body,salt=body.subarray(0,16),sender=body.subarray(21,21+body[20])
 const shared=receiver.computeSecret(sender),ikm=Buffer.from(hkdfSync('sha256',shared,auth,Buffer.concat([Buffer.from('WebPush: info\0'),receiver.getPublicKey(),sender]),32))
 const cek=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16)),nonce=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12))
 const encrypted=body.subarray(21+body[20]),decipher=createDecipheriv('aes-128-gcm',cek,nonce);decipher.setAuthTag(encrypted.subarray(-16))
 const plaintext=Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]),message=JSON.parse(plaintext.subarray(0,-1).toString())
 assert.equal(message.eventId,claim.id);assert.match(message.body,/Strong wind/);assert.equal(details.headers.TTL,3600);assert.equal(details.headers.Urgency,'high');assert.throws(()=>prepareWeatherPush(claim,config,now+hour))
})
test('default-off gate, scheduler secret, method/origin/body rejection make zero database calls',async()=>{
 let calls=0;const rpc=async()=>{calls++;throw Error('must not query')}
 assert.equal((await createWeatherHandler({env:{},rpc})(request())).status,503)
 const handler=createWeatherHandler({env,rpc})
 assert.equal((await handler(request({}, {authorization:'Bearer user-jwt'}))).status,401)
 assert.equal((await handler(request({}, {origin:'https://app.invalid'}))).status,400)
 for(const body of [{city},{endpoint:claim.endpoint},{text:'spoof'},{userId:'other'},[],null])assert.equal((await handler(request(body))).status,400)
 assert.equal((await handler(request({padding:'a'.repeat(129)}))).status,413)
 assert.equal((await handler(new Request('https://edge.invalid/push-check',{method:'GET'}))).status,405)
 assert.equal(calls,0)
})
function dependencies({authorize=true,status=201,sendError=false,badForecast=false,claims=1}={}) {
 let sends=0,count=0;const calls=[]
 return {calls,get sends(){return sends},handler:createWeatherHandler({env,now:()=>now,resolver,
  fetcher:async()=>badForecast?new Response('',{status:503}):response(forecast()),
  rpc:async(name,payload)=>{calls.push([name,payload]);if(name==='begin_weather_push')return {runId:claim.claimId,cities:[{key:'city-key',city}]};if(name==='claim_weather_push')return count++<claims?{...claim,id:claim.id.slice(0,-1)+String(count)}:null;if(name==='authorize_weather_push')return authorize},
  send:async()=>{assert.equal(calls.at(-1)[0],'authorize_weather_push');sends++;if(sendError)throw Error('secret endpoint must not leak');return {status,retryAfter:'123'}}})}
}
test('verified weather is staged before sending; current consent and rights authorization precedes POST',async()=>{
 const d=dependencies();const result=await d.handler(request());assert.equal(result.status,200);assert.equal(d.sends,1)
 assert.equal(d.calls[1][0],'stage_weather_push');assert.ok(d.calls[1][1].events.length);assert.equal(d.calls.at(-1)[0],'end_weather_push')
 const no=dependencies({authorize:false});assert.equal((await no.handler(request())).status,503);assert.equal(no.sends,0)
})
test('provider errors cleanup/throttling/uncertainty never retry, and bounded cycles stop at five sends',async()=>{
 for(const [status,outcome] of [[404,'expired'],[410,'expired'],[429,'throttled'],[302,'failed']]) {
  const d=dependencies({status});assert.equal((await d.handler(request())).status,503);assert.equal(d.sends,1)
  const finish=d.calls.find(c=>c[0]==='finish_weather_push');assert.equal(finish[1].outcome,outcome);assert.equal(finish[1].retry_seconds,status===429?123:0)
 }
 const uncertain=dependencies({sendError:true});const r=await uncertain.handler(request());assert.equal(r.status,503);assert.equal(uncertain.sends,1);assert.equal((await r.text()).includes('secret'),false);assert.equal(uncertain.calls.some(c=>c[0]==='finish_weather_push'),false)
 const capped=dependencies({claims:20});await capped.handler(request());assert.equal(capped.sends,5)
 const unavailable=dependencies({badForecast:true,claims:0});assert.equal((await unavailable.handler(request())).status,503);assert.equal(unavailable.calls.some(c=>c[0]==='stage_weather_push'),false);assert.equal(unavailable.sends,0)
})
test('lease/cooldown refusal and private DNS make no provider request',async()=>{
 let sends=0
 const off=createWeatherHandler({env,rpc:async()=>null,now:()=>now,send:async()=>sends++});assert.equal((await off(request())).status,409);assert.equal(sends,0)
 const calls=[]
 const handler=createWeatherHandler({env,now:()=>now,resolver:async()=>[{address:'10.0.0.1',family:4}],rpc:async(name)=>{calls.push(name);if(name==='begin_weather_push')return {runId:claim.claimId,cities:[]};if(name==='claim_weather_push')return claim},send:async()=>sends++})
 assert.equal((await handler(request())).status,503);assert.equal(sends,0);assert.equal(calls.includes('authorize_weather_push'),false)
})

test('an expired event or encryption failure does not delete a valid device',async()=>{
 const calls=[];let attempts=0
 const handler=createWeatherHandler({env,now:()=>now,resolver,rpc:async(name,payload)=>{calls.push([name,payload]);if(name==='begin_weather_push')return {runId:claim.claimId,cities:[]};if(name==='claim_weather_push')return attempts++===0?claim:null},prepare:()=>{throw Error('EXPIRED_EVENT')}})
 assert.equal((await handler(request())).status,503)
 assert.equal(calls.some(c=>c[0]==='finish_weather_push'),false)
 assert.equal(calls.some(c=>c[0]==='authorize_weather_push'),false)
})

test('non-integer timezone offsets preserve hourly epoch grids and valid values',async()=>{
 const kathmandu={...city,zone:'Asia/Kathmandu'},data=forecast();data.timezone=kathmandu.zone
 data.hourly.time=data.hourly.time.map(t=>t+900)
 data.hourly.wind_speed_10m.fill(80)
 const snapshot=await weatherSnapshot(kathmandu,async()=>response(data),now)
 assert.equal(snapshot.hours[0].epoch%hour,15*60000)
 const event=weatherEvents(snapshot,now).find(e=>e.kind==='wind')
 assert.equal(event.end-event.start,24*hour)
})
