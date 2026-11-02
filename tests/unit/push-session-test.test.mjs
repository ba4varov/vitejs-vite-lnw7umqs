import test from 'node:test'
import assert from 'node:assert/strict'
import webpush from 'web-push'
import {createSessionPushHandler} from '../../server/push-session-test.js'
import {checkLocalNotification} from '../../src/push-local-test.js'

const testDevice='b1000000-0000-0000-0000-000000000001'
const actor='b0000000-0000-0000-0000-000000000001',permit='b0000000-0000-0000-0000-000000000002'
const vapid=webpush.generateVAPIDKeys(),subscriber=webpush.generateVAPIDKeys()
const env={VERCEL:'1',VERCEL_ENV:'production',PUSH_SESSION_TEST_ENABLED:'true',SUPABASE_URL:`https://${'a'.repeat(20)}.supabase.co`,SUPABASE_SERVICE_ROLE_KEY:'synthetic_service_key',PUSH_VAPID_PUBLIC_KEY:vapid.publicKey,PUSH_NODE_VAPID_PRIVATE_KEY:vapid.privateKey,PUSH_VAPID_SUBJECT:'mailto:fixture@example.invalid'}
const send={operation:'send',permitId:permit,confirmation:`SEND ONE ${actor} ${testDevice}`}
const prepare={operation:'prepare',category:'wind',requestId:permit}
const request=(body,headers={})=>new Request('https://fixture.invalid/api/push-operator',{method:'POST',headers:{origin:'https://fixture.invalid',authorization:'Bearer synthetic.jwt.signature',...headers},body:JSON.stringify(body)})
function fixture({failure,status=201,configuration=env,diagnostic={}}={}){
 const state={calls:[],sends:0,armed:false,burned:false,finishes:[]}
 const claim={claimId:permit,endpoint:'https://fcm.googleapis.com/wp/SYNTHETIC',publicKey:vapid.publicKey,p256dh:subscriber.publicKey,auth:Buffer.alloc(16,9).toString('base64url')}
 const fetcher=async(url,options)=>{
  const u=new URL(url),name=u.pathname.split('/').pop();state.calls.push(name)
  if(name==='user')return Response.json({id:actor},{status:failure==='session'?401:200})
  const args=JSON.parse(options.body)
  if(name==='push_operator_access')return Response.json(failure!=='rights')
  if(name==='push_session_target')return Response.json(failure==='target'?null:{deviceId:testDevice,userId:failure==='target-owner'?permit:actor,label:'Desktop Chrome (synthetic)'})
  if(name==='push_session_scope')return Response.json(!['scope','wrong-device'].includes(failure))
  if(name==='prepare_push_session'){
   assert.equal(args.actor_id,actor);assert.equal(Object.hasOwn(args,'target_device'),false);assert.equal(Object.hasOwn(args,'target_user'),false)
   if(['expired','consent','cooldown'].includes(failure))return new Response(null,{status:409})
   return Response.json({permitId:permit,userId:actor,deviceId:testDevice,category:'wind',expiresAt:new Date(Date.now()+120000).toISOString()})
  }
  if(name==='inspect_push_operator')return Response.json({...claim,...(failure==='vapid'?{publicKey:subscriber.publicKey}:{})})
  if(name==='push_session_permit'){
   assert.equal(args.actor_id,actor);assert.equal(args.permit_id,permit)
   if(['scope','registration','expired','missing-permit'].includes(failure))return Response.json(false)
   if(args.action==='cancel')return Response.json(true)
   const ok=!state.armed&&args.confirmation===send.confirmation
   if(ok)state.armed=true
   return Response.json(ok)
  }
  if(name==='claim_push_test')return Response.json(state.armed?claim:null)
  if(name==='authorize_push_test'){
   const ok=!state.burned&&failure!=='revoked';if(ok)state.burned=true
   return Response.json(ok)
  }
  if(name==='finish_push_test'){
   state.finishes.push(args)
   if(failure==='finish')throw Error('SENSITIVE_UNTRUSTED_PROVIDER_DATA')
   return new Response(null,{status:204})
  }
  if(['close_push_operator','cancel_push_operator'].includes(name))return Response.json(true)
  throw Error('UNEXPECTED_RPC')
 }
 const handler=createSessionPushHandler({env:configuration,fetcher,resolver:async()=>{
  if(failure==='dns')throw Error('SENSITIVE_UNTRUSTED_PROVIDER_DATA')
  return [{address:'8.8.8.8',family:4}]
 },prepareTransport:async()=>async()=>{
  assert.equal(state.burned,true);state.sends++
  if(failure==='network')throw Error('SENSITIVE_UNTRUSTED_PROVIDER_DATA')
  return {status,...diagnostic,retryAfter:'900',raw:'SENSITIVE_UNTRUSTED_PROVIDER_DATA'}
 }})
 return {handler,state}
}

test('session route stays off by default and on Preview; no control/provider calls',async()=>{
 for(const configuration of [{},{...env,PUSH_SESSION_TEST_ENABLED:undefined},{...env,VERCEL_ENV:'preview'}]){
  const f=fixture({configuration});assert.equal((await f.handler(request(send))).status,503);assert.deepEqual(f.state.calls,[])
 }
})
test('same origin, verified session and selected DB administrator are mandatory',async()=>{
 for(const [headers,code] of [[{origin:'https://evil.invalid'},'rights:origin'],[{authorization:''},'session:missing']]){
  const f=fixture();assert.equal((await (await f.handler(request(send,headers))).json()).code,code);assert.equal(f.state.sends,0)
 }
 for(const failure of ['session','rights']){const f=fixture({failure});assert.ok([401,403].includes((await f.handler(request(send))).status));assert.equal(f.state.sends,0)}
})
test('preparation fixes owner/device and rejects arbitrary targets, expired registrations, consent, cooldown and VAPID mismatch',async()=>{
 const f=fixture();assert.equal((await (await f.handler(request(prepare))).json()).code,'device:ready');assert.equal(f.state.sends,0)
 for(const failure of ['expired','consent','cooldown','vapid']){
  const x=fixture({failure});assert.equal((await x.handler(request(prepare))).status,409);assert.equal(x.state.sends,0)
 }
 for(const extra of [{deviceId:testDevice},{userId:actor},{endpoint:'https://evil.invalid'},{payload:'arbitrary'}])assert.equal((await f.handler(request({...prepare,...extra}))).status,400)
})
test('foreign permits and missing confirmation never arm',async()=>{
 const f=fixture({failure:'scope'});assert.equal((await f.handler(request(send))).status,409);assert.equal(f.state.calls.includes('arm_push_operator'),false)
 const x=fixture();assert.equal((await x.handler(request({...send,confirmation:'yes'}))).status,409);assert.equal(x.state.sends,0)
})
test('provider acceptance, refusal, expiry, throttling, DNS/network and unknown DB outcome are safe and never retried',async()=>{
 for(const options of [{status:201},{status:400},{status:403},{status:404},{status:410},{status:429},{status:503},{failure:'network'},{failure:'finish'},{failure:'dns'},{failure:'revoked'}]){
  const f=fixture(options),result=await (await f.handler(request(send))).json()
  assert.equal(result.phoneDelivery,'unconfirmed');assert.equal(result.deliveryEnabled,false)
  if(options.status===201)assert.equal(result.code,'fcm:accepted')
  if([404,410].includes(options.status))assert.equal(f.state.finishes[0].outcome,'expired')
  if(options.status===429)assert.equal(f.state.finishes[0].retry_seconds,900)
  const output=JSON.stringify(result)
  for(const secret of ['SENSITIVE_UNTRUSTED_PROVIDER_DATA',vapid.privateKey,env.SUPABASE_SERVICE_ROLE_KEY,'fcm.googleapis.com','synthetic.jwt.signature'])assert.equal(output.includes(secret),false)
  const sends=f.state.sends;await f.handler(request(send));assert.equal(f.state.sends,sends)
 }
})
test('concurrent confirmations authorize at most one attempt',async()=>{
 const f=fixture();const results=await Promise.all(Array.from({length:12},()=>f.handler(request(send))))
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(f.state.sends,1)
})
test('local notification uses only the active worker; no permission request or provider request',async()=>{
 let displayed=0
 const registration={active:{scriptURL:'https://fixture.invalid/push-sw.js'},scope:'https://fixture.invalid/',showNotification:async()=>{displayed++}}
 const scope={isSecureContext:true,location:{origin:'https://fixture.invalid'},Notification:{permission:'granted'},navigator:{serviceWorker:{getRegistration:async()=>registration}}}
 assert.equal(await checkLocalNotification(scope),'local:requested');assert.equal(displayed,1)
 scope.Notification.permission='denied';assert.equal(await checkLocalNotification(scope),'local:permission-required');assert.equal(displayed,1)
 scope.Notification.permission='granted';registration.active.scriptURL='https://fixture.invalid/other.js';assert.equal(await checkLocalNotification(scope),'local:worker-unavailable')
 registration.active.scriptURL='https://fixture.invalid/push-sw.js';registration.showNotification=async()=>{throw Error('SECRET')};assert.equal(await checkLocalNotification(scope),'local:failed')
})


test('session adapter preserves safe FCM 400 reason/body fields, excludes raw data and never replays',async()=>{
 for(const diagnostic of [
  {providerReason:'fcm_unauthorized_registration',providerBodyStatus:'recognized'},
  {providerBodyStatus:'empty'},
  {providerBodyStatus:'unknown_format'},
  {providerReason:'SENSITIVE_UNTRUSTED_PROVIDER_DATA',providerBodyStatus:'SENSITIVE_UNTRUSTED_PROVIDER_DATA'},
 ]){
  const f=fixture({status:400,diagnostic})
  const response=await f.handler(request(send)),result=await response.json()
  assert.equal(response.status,502);assert.equal(result.code,'fcm:rejected')
  assert.equal(result.diagnostic.providerStatus,400);assert.equal(result.diagnostic.category,'request_rejected')
  assert.equal(result.diagnostic.providerReason,diagnostic.providerReason==='fcm_unauthorized_registration'?diagnostic.providerReason:undefined)
  assert.equal(result.diagnostic.providerBodyStatus,['recognized','empty','unknown_format'].includes(diagnostic.providerBodyStatus)?diagnostic.providerBodyStatus:undefined)
  for(const sensitive of ['SENSITIVE_UNTRUSTED_PROVIDER_DATA',vapid.privateKey,env.SUPABASE_SERVICE_ROLE_KEY,'fcm.googleapis.com','synthetic.jwt.signature'])assert.equal(JSON.stringify(result).includes(sensitive),false)
  await f.handler(request(send));assert.equal(f.state.sends,1)
 }
})

test('DB target defaults closed, and access exposes only the allowed device identity',async()=>{
 for(const failure of ['target','target-owner']){
  const closed=fixture({failure})
  for(const body of [prepare,send])assert.equal((await (await closed.handler(request(body))).json()).code,'device:not-authorized')
  assert.equal(closed.state.sends,0)
 }
 const f=fixture(),access=await (await f.handler(request({operation:'access'}))).json()
 assert.deepEqual(access.target,{deviceId:testDevice,label:'Desktop Chrome (synthetic)'})
 assert.equal(JSON.stringify(access).includes('endpoint'),false)
})
test('wrong target, changed registration, expired or missing permit never reach provider',async()=>{
 for(const failure of ['wrong-device','registration','expired','missing-permit']){
  const f=fixture({failure});assert.equal((await f.handler(request(send))).status,409);assert.equal(f.state.sends,0)
 }
})
