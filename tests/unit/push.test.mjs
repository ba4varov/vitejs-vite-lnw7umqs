import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {validPushEndpoint,validPushSubscription,validPushPreferences} from '../../server/push-validation.js'
import {handlePush} from '../../server/push-core.js'
import {fetchPushForecast,evaluatePushForecast} from '../../server/push-forecast.js'
import {pushSupport,enrollPush,removePushDevice} from '../../src/push-browser.js'
const key=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url')
const sub={endpoint:'https://fcm.googleapis.com/wp/test',keys:{p256dh:key,auth:Buffer.alloc(16,1).toString('base64url')},expirationTime:null}
const prefs={enabled:true,cities:[{name:'София',latitude:42.6977,longitude:23.3219,zone:'Europe/Sofia'}],categories:['wind']}
test('SSRF: only reviewed HTTPS provider endpoints; no suffix, credentials, redirects or private IP hosts',()=>{
 for(const url of [sub.endpoint,'https://web.push.apple.com/token','https://wns2-test.notify.windows.com/w/?token=abc%2Bdef','https://updates.push.services.mozilla.com/wpush/v2/test'])assert.equal(validPushEndpoint(url),true,url)
 for(const url of ['http://fcm.googleapis.com/wp/test','https://fcm.googleapis.com.evil.test/wp/test','https://fcm.googleapis.com@127.0.0.1/wp/test','https://localhost/wp/test','https://169.254.169.254/','https://[::1]/','https://fcm.googleapis.com:8443/wp/test','https://fcm.googleapis.com:443/wp/test','https://fcm.googleapis.com/wp/test#secret','https://fcm.googleapis.com/wp/test?redirect=http://localhost','https://web.push.apple.com/a/../token','https://evil.notify.windows.com.evil.test/w/?token=a',null,'https://web.push.apple.com/'+ 'a'.repeat(2100)])assert.equal(validPushEndpoint(url),false,String(url))
})
test('bounded keys, device preferences, coordinates, IANA zones and explicit categories',()=>{
 assert.ok(validPushSubscription(sub));assert.ok(validPushPreferences(prefs))
 for(const s of [{...sub,owner:'other'}, {...sub,keys:{...sub.keys,p256dh:'A'.repeat(87)}},{...sub,keys:{...sub.keys,auth:'short'}},{...sub,expirationTime:'tomorrow'}])assert.equal(validPushSubscription(s),false)
 for(const p of [{...prefs,cities:[]},{...prefs,categories:[]},{...prefs,categories:['wind','wind']},{...prefs,categories:['admin']},{...prefs,cities:[{...prefs.cities[0],zone:'invalid'}]},{...prefs,cities:[{...prefs.cities[0],latitude:NaN}]},{...prefs,cities:[prefs.cities[0],prefs.cities[0]]},{...prefs,user_id:'other'}])assert.equal(validPushPreferences(p),false)
 assert.ok(validPushPreferences({enabled:false,cities:[],categories:[]}))
})
async function api(method,body,extraEnv={},rpcStatus=200,rpcBody={contractVersion:1,pro:false,preferences:prefs,devices:[]}) {
 const calls=[];const res={headers:{},setHeader(k,v){this.headers[k]=v},status(v){this.code=v;return this},json(v){this.data=v;return this}}
 await handlePush({method,body,headers:{authorization:'Bearer isolated'},query:{}},res,{SUPABASE_URL:'https://db.example.invalid',SUPABASE_ANON_KEY:'anon',...extraEnv},async(url,opts)=>{
  calls.push({url,opts});return new Response(JSON.stringify(url.endsWith('/user')?{id:'owner'}:rpcBody),{status:url.endsWith('/user')?200:rpcStatus})
 });return {res,calls}
}
test('API no sender, private caching, user JWT only; registration defaults off; mutation validation',async()=>{
 const off=await api('POST',{subscription:sub,label:'Phone'});assert.equal(off.res.code,503);assert.equal(off.calls.length,1)
 const on=await api('POST',{subscription:sub,label:'Phone'},{PUSH_REGISTRATION_ENABLED:'true',PUSH_VAPID_PUBLIC_KEY:key});assert.equal(on.res.code,200);assert.equal(on.res.data.deliveryEnabled,false);assert.equal(on.calls.length,2)
 assert.equal(on.calls[1].opts.headers.Authorization,'Bearer isolated');assert.equal(on.calls[1].opts.redirect,'error');assert.equal(on.res.headers['Cache-Control'],'private, no-store')
 const bad=await api('POST',{subscription:{...sub,endpoint:'http://127.0.0.1'},label:'Phone'},{PUSH_REGISTRATION_ENABLED:'true',PUSH_VAPID_PUBLIC_KEY:key});assert.equal(bad.res.code,400);assert.equal(bad.calls.length,1)
 assert.equal((await api('PATCH',{...prefs,user_id:'other'})).res.code,400)
 assert.equal((await api('DELETE',{id:'x'})).res.code,400)
 assert.equal((await api('GET',null,{},400,{message:'PUSH_RATE_LIMITED'})).res.code,429)
 assert.equal((await api('GET',null,{},200,{contractVersion:0})).res.code,503)
 const anon={setHeader(){},status(c){this.code=c;return this},json(){return this}}
 await handlePush({method:'GET',headers:{},query:{}},anon,{SUPABASE_URL:'https://db.invalid',SUPABASE_ANON_KEY:'a'},()=>{throw Error('must not fetch')});assert.equal(anon.code,401)
})
const browser=(userAgent='Chrome',standalone=false)=>({isSecureContext:true,Notification:{},PushManager:{},navigator:{userAgent,maxTouchPoints:0,serviceWorker:{}},matchMedia:()=>({matches:standalone})})
test('Android/Windows feature detection, iOS Home Screen and unsupported contexts',()=>{
 for(const ua of ['Android Chrome','Windows Chrome','Windows Edg'])assert.equal(pushSupport(browser(ua)),'supported')
 assert.equal(pushSupport(browser('iPhone')),'ios-install');assert.equal(pushSupport(browser('iPhone',true)),'supported')
 assert.equal(pushSupport({...browser(),isSecureContext:false}),'unsupported')
 const noPush=browser();delete noPush.PushManager;assert.equal(pushSupport(noPush),'unsupported')
})
test('denial/dismissal never subscribe; failed persistence rolls back only newly created subscription',async()=>{
 let prompts=0,subscriptions=0,writes=0,removed=0
 const registration={pushManager:{getSubscription:async()=>null,subscribe:async()=>{subscriptions++;return {toJSON:()=>sub,unsubscribe:async()=>{removed++;return true}}}}}
 for(const permission of ['denied','default'])await assert.rejects(enrollPush({scope:{Notification:{requestPermission:()=>{prompts++;return Promise.resolve(permission)}}},registration,key,persist:async()=>{writes++}}))
 assert.equal(prompts,2);assert.equal(subscriptions,0);assert.equal(writes,0)
 const promise=enrollPush({scope:{Notification:{requestPermission:()=>{prompts++;return Promise.resolve('granted')}}},registration,key,persist:async()=>{throw Error('storage failed')}})
 assert.equal(prompts,3,'permission requested synchronously before first await');await assert.rejects(promise);assert.equal(removed,1)
})
test('server unsubscribe precedes browser cleanup and cannot unsubscribe a different device',async()=>{
 const events=[];const fingerprint=await import('node:crypto').then(c=>c.createHash('sha256').update(sub.endpoint).digest('hex'))
 const registration={pushManager:{getSubscription:async()=>({endpoint:sub.endpoint,unsubscribe:async()=>{events.push('browser');return true}})}}
 await removePushDevice({registration,device:{id:'one',fingerprint},persist:async()=>{events.push('server');return {ok:true}}});assert.deepEqual(events,['server','browser'])
 events.length=0;await removePushDevice({registration,device:{id:'other',fingerprint:'other'},persist:async()=>events.push('server')});assert.deepEqual(events,['server'])
 await assert.rejects(removePushDevice({registration,device:{id:'one',fingerprint},persist:async()=>{throw Error('offline')}}))
})
test('VAPID rotation refuses to relabel old or unknown browser subscriptions; never silently unsubscribes',async()=>{
 let writes=0,removed=0
 const existing={options:{applicationServerKey:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,2)])},toJSON:()=>sub,unsubscribe:async()=>removed++}
 const registration={pushManager:{getSubscription:async()=>existing}}
 const scope={Notification:{requestPermission:async()=>'granted'}}
 await assert.rejects(enrollPush({scope,registration,key,persist:async()=>writes++}),/KEY_ROTATION_REQUIRED/)
 delete existing.options
 await assert.rejects(enrollPush({scope,registration,key,persist:async()=>writes++}),/KEY_ROTATION_REQUIRED/)
 assert.equal(writes,0);assert.equal(removed,0)
 existing.options={applicationServerKey:Buffer.from(key,'base64url')}
 await enrollPush({scope,registration,key,persist:async()=>writes++})
 assert.equal(writes,1);assert.equal(removed,0)
})
test('registration public key must agree with DB gate; caller cannot choose a different VAPID key',async()=>{
 const settings={PUSH_REGISTRATION_ENABLED:'true',PUSH_VAPID_PUBLIC_KEY:key}
 const off=await api('GET',null,settings)
 assert.equal(off.res.data.registrationEnabled,false)
 const on=await api('GET',null,settings,200,{contractVersion:1,registrationPublicKey:key})
 assert.equal(on.res.data.registrationEnabled,true)
 assert.equal((await api('POST',{subscription:sub,label:'Phone',vapidPublicKey:'caller-key'},settings)).res.code,400)
 const saved=await api('POST',{subscription:sub,label:'Phone'},settings)
 assert.equal(JSON.parse(saved.calls[1].opts.body).payload.vapidPublicKey,key)
})
const now=Date.parse('2026-10-09T00:00Z')
const forecastData=()=>({timezone:'UTC',current:{time:now/1000},hourly_units:{time:'unixtime',apparent_temperature:'°C',precipitation_probability:'%',precipitation:'mm',wind_speed_10m:'km/h'},hourly:{time:Array.from({length:72},(_,i)=>now/1000+i*3600),apparent_temperature:Array(72).fill(20),precipitation_probability:Array(72).fill(0),precipitation:Array(72).fill(0),wind_speed_10m:Array(72).fill(65),weather_code:Array(72).fill(0)}})
test('forecast fetched server side from fixed provider; malformed, stale, oversized data rejected',async()=>{
 const city={...prefs.cities[0],zone:'UTC'}
 const snapshot=await fetchPushForecast(city,async(url,opts)=>{assert.equal(new URL(url).hostname,'api.open-meteo.com');assert.equal(opts.redirect,'error');assert.equal(opts.cache,'no-store');return Response.json(forecastData())},now)
 assert.equal(snapshot.source,'server-open-meteo');assert.equal(snapshot.forecast.hours.length,72)
 for(const mutation of [d=>d.current.time-=7200,d=>d.hourly.wind_speed_10m[0]=500,d=>d.hourly.precipitation.pop(),d=>d.hourly_units.wind_speed_10m='m/s',d=>d.timezone='wrong',d=>d.hourly.time[1]+=1]){const d=forecastData();mutation(d);await assert.rejects(fetchPushForecast(city,async()=>Response.json(d),now))}
 await assert.rejects(fetchPushForecast(city,async()=>new Response('x'.repeat(150001)),now))
 const selected={...prefs,cities:[city],categories:['wind','walk']}
 assert.deepEqual(evaluatePushForecast(snapshot,selected,{plan:'free',permissions:[]},now).map(e=>e.kind),['wind'])
 const calm=forecastData();calm.hourly.wind_speed_10m.fill(5)
 const good=await fetchPushForecast(city,async()=>Response.json(calm),now)
 assert.ok(evaluatePushForecast(good,selected,{plan:'pro',permissions:['planner:advanced']},now).some(e=>e.kind==='walk'))
 assert.deepEqual(evaluatePushForecast(good,selected,{plan:'pro',permissions:[]},now),[])
 await assert.rejects(async()=>evaluatePushForecast(good,selected,{plan:'pro',permissions:['planner:advanced']},now+16*60000))
 assert.deepEqual(evaluatePushForecast(good,{...selected,enabled:false},{plan:'pro',permissions:['planner:advanced']},now),[])
})
test('SW never caches/intercepts fetch or opens external notification payload URLs; Edge stub always off',async()=>{
 const handlers={},notifications=[],opened=[]
 const self={addEventListener:(name,fn)=>handlers[name]=fn,location:{origin:'https://meteo.invalid'},registration:{showNotification:async(t,o)=>notifications.push({t,o})},clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async url=>opened.push(url)},skipWaiting:()=>{}}
 vm.runInNewContext(readFileSync(new URL('../../public/push-sw.js',import.meta.url),'utf8'),{self,URL})
 assert.equal(handlers.fetch,undefined)
 let waiting;handlers.push({data:{json:()=>({title:'test',url:'https://evil.invalid'})},waitUntil:p=>waiting=p});await waiting;assert.equal(notifications[0].o.data.url,'/')
 handlers.notificationclick({notification:{close(){}},waitUntil:p=>waiting=p});await waiting;assert.deepEqual(opened,['https://meteo.invalid/'])
 let handler;vm.runInNewContext(readFileSync(new URL('../../supabase/functions/push-check/index.ts',import.meta.url),'utf8'),{Deno:{serve:fn=>handler=fn},Response,JSON});assert.equal(handler().status,503)
})
