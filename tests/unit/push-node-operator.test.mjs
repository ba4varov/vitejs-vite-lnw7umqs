import test from 'node:test'
import assert from 'node:assert/strict'
import webpush from 'web-push'
import {createNodeOperatorHandler} from '../../server/push-node-operator.js'

// Atomic in-memory model of the existing RPC contract. Never connects to Supabase/FCM.
// Real migrations/grants/leases are independently exercised by check-push-test CI.
const permit='b0000000-0000-0000-0000-000000000001',user='b0000000-0000-0000-0000-000000000002',device='b0000000-0000-0000-0000-000000000003'
const vapid=webpush.generateVAPIDKeys(),subscriber=webpush.generateVAPIDKeys(),secret='SYNTHETIC_PRIVATE_MUST_NOT_ESCAPE'
const baseEnv={VERCEL:'1',VERCEL_ENV:'production',PUSH_NODE_OPERATOR_ENABLED:'true',SUPABASE_URL:`https://${'a'.repeat(20)}.supabase.co`,SUPABASE_SERVICE_ROLE_KEY:'synthetic_service_key_do_not_use',PUSH_TEST_OPERATOR_TOKEN:'A'.repeat(43),PUSH_VAPID_PUBLIC_KEY:vapid.publicKey,PUSH_NODE_VAPID_PRIVATE_KEY:vapid.privateKey,PUSH_VAPID_SUBJECT:'mailto:fixture@example.invalid'}
const sendBody={operation:'send',permitId:permit,confirmation:`SEND ONE ${user} ${device}`}
const prepareBody={operation:'prepare',userId:user,deviceId:device,category:'wind',requestId:permit}
const req=(body=sendBody,{authorization=`Bearer ${baseEnv.PUSH_TEST_OPERATOR_TOKEN}.synthetic.jwt.signature`,headers={},url='https://weather.fixture.invalid/api/push-operator',method='POST',signal}={})=>new Request(url,{method,headers:{authorization,...headers},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{}),signal})

function fixture({failure,env=baseEnv,deny=false,hook=()=>{},transport}={}){
 const state={armed:false,claimed:false,burned:false,revoked:false,sends:0,dns:0,calls:[],logs:[],finishes:[],prepared:0}
 const claim={claimId:permit,endpoint:'https://fcm.googleapis.com/wp/SYNTHETIC',publicKey:vapid.publicKey,p256dh:subscriber.publicKey,auth:Buffer.alloc(16,9).toString('base64url'),language:'en'}
 const fetcher=async(url,options)=>{
  assert.equal(options.redirect,'error');assert.ok(options.signal);assert.equal(options.signal.aborted,false)
  assert.equal(options.headers.apikey,baseEnv.SUPABASE_SERVICE_ROLE_KEY)
  const parsed=new URL(url);assert.equal(parsed.origin,baseEnv.SUPABASE_URL);assert.equal(parsed.search,'')
  const name=parsed.pathname.split('/').pop();state.calls.push(name)
  await hook(name,state,options)
  if(options.signal.aborted)throw Error(secret)
  if(failure===`lost_${name}`&&name!=='authorize_push_test')throw Error(secret)
  if(name==='user'){
   assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer synthetic.jwt.signature')
   if(failure==='session')return new Response(secret,{status:401})
   if(failure==='auth_redirect')return new Response(null,{status:302,headers:{location:'https://evil.invalid'}})
   if(failure==='auth_large')return new Response('x'.repeat(32769))
   return Response.json({id:user})
  }
  assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,`Bearer ${baseEnv.SUPABASE_SERVICE_ROLE_KEY}`)
  const args=JSON.parse(options.body);let result
  if(name==='push_operator_access'){
   assert.deepEqual(args,{actor_id:user});result=!deny
  }else if(name==='prepare_push_operator'){
   assert.deepEqual(args,{actor_id:user,target_user:user,target_device:device,test_category:'wind',request_id:permit})
   state.prepared++;result={permitId:permit,userId:user,deviceId:device,category:'wind',expiresAt:new Date(Date.now()+120000).toISOString()}
  }else if(name==='inspect_push_operator')result=failure==='nonfcm'?{...claim,endpoint:'https://web.push.apple.com/synthetic'}:claim
  else if(name==='arm_push_operator'){
   result=!state.armed&&!state.revoked&&args.confirmation===sendBody.confirmation&&!['expired_prepare','revoked_prepare','wrong_actor','cooldown'].includes(failure)
   if(result)state.armed=true
  }else if(name==='claim_push_test'){
   assert.equal(args.key_public,vapid.publicKey)
   result=state.armed&&!state.claimed&&!state.revoked&&!['expired_lease','changed_revision'].includes(failure)?claim:null
   if(result)state.claimed=true
  }else if(name==='authorize_push_test'){
   assert.equal(args.claim_id,permit)
   result=state.claimed&&!state.burned&&!state.revoked&&!['expired_claim','revoked_consent','authorize_refused'].includes(failure)
   if(result){state.burned=true;state.revoked=true}
   if(failure==='lost_authorize_push_test')throw Error(secret)
  }else if(name==='finish_push_test'){
   state.finishes.push(args)
   if(failure==='finish')throw Error(secret)
   return new Response(null,{status:204})
  }else if(name==='close_push_operator'||name==='cancel_push_operator'){state.revoked=true;result=true}
  else throw Error('UNEXPECTED_RPC')
  if(failure==='rpc_large'&&name==='claim_push_test')return new Response('x'.repeat(8193))
  if(failure==='malformed_authorize'&&name==='authorize_push_test')return Response.json([true])
  return Response.json(result)
 }
 const resolver=async()=>{
  state.dns++;assert.ok(state.claimed);assert.equal(state.burned,false)
  if(failure==='dns')throw Error(secret)
  if(failure==='dns_private')return [{address:'127.0.0.1',family:4}]
  return [{address:'8.8.8.8',family:4}]
 }
 const prepareTransport=async(details,cached,signal)=>{
  assert.equal(state.burned,true);assert.equal(state.revoked,true)
  assert.equal(details.endpoint,claim.endpoint);assert.equal(details.method,'POST')
  assert.deepEqual(await cached(),[{address:'8.8.8.8',family:4}]);assert.equal(state.dns,1)
  if(signal.aborted)throw Error(secret)
  return async()=>{
   if(signal.aborted)throw Error(secret)
   state.sends++
   if(transport)return transport({signal,state,details})
   if(failure==='disconnect')throw Object.assign(Error(secret),{diagnosticCode:'transport_failed'})
   if(failure==='http400')return {status:400,providerReason:'fcm_invalid_argument',providerBodyStatus:'recognized',raw:secret}
   if(failure==='http429')return {status:429,retryAfter:'INVALID_RETRY_AFTER'}
   return {status:201}
  }
 }
 return {state,claim,handler:()=>createNodeOperatorHandler({env,fetcher,resolver,prepareTransport,diagnose:x=>state.logs.push(x)})}
}

test('disabled by default; Preview/local/spoofed Production always stops before secrets, Auth, DB or DNS',async()=>{
 for(const env of [{},{...baseEnv,PUSH_NODE_OPERATOR_ENABLED:undefined},{...baseEnv,PUSH_NODE_OPERATOR_ENABLED:'TRUE'},{...baseEnv,VERCEL_ENV:'preview'},{...baseEnv,VERCEL_ENV:'development'},{...baseEnv,VERCEL:undefined},{...baseEnv,VERCEL_ENV:undefined,NODE_ENV:'production'}]){
  Object.defineProperty(env,'SUPABASE_SERVICE_ROLE_KEY',{get(){throw Error('MUST_NOT_READ_SECRET')}})
  const f=fixture({env});const r=await f.handler()(req(sendBody,{headers:{'x-vercel-env':'production'}}))
  assert.equal(r.status,503);assert.equal((await r.json()).error,'PUSH_NODE_DISABLED');assert.deepEqual(f.state.calls,[])
  assert.equal(f.state.dns,0);assert.equal(f.state.sends,0)
 }
})

test('missing/invalid configuration fails closed for every operation, without external I/O',async()=>{
 for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','PUSH_TEST_OPERATOR_TOKEN','PUSH_VAPID_PUBLIC_KEY','PUSH_NODE_VAPID_PRIVATE_KEY','PUSH_VAPID_SUBJECT']){
  for(const value of [undefined,'bad']){
   const f=fixture({env:{...baseEnv,[key]:value}})
   for(const body of [sendBody,prepareBody,{operation:'cancel',permitId:permit}]){
    const r=await f.handler()(req(body));assert.equal(r.status,503);assert.equal((await r.json()).error,'PUSH_NODE_UNCONFIGURED')
   }
   assert.deepEqual(f.state.calls,[])
  }
 }
 const f=fixture({env:{...baseEnv,SUPABASE_URL:'https://evil.invalid'}});assert.equal((await f.handler()(req())).status,503)
})

test('operator credential, live user session and selected DB administrator are all required',async()=>{
 for(const authorization of ['',`Bearer ${baseEnv.PUSH_TEST_OPERATOR_TOKEN}`,'Bearer synthetic.jwt.signature',`Bearer ${'B'.repeat(43)}.synthetic.jwt.signature`]){
  const f=fixture();assert.equal((await f.handler()(req(sendBody,{authorization}))).status,401);assert.deepEqual(f.state.calls,[])
 }
 for(const failure of ['session','auth_redirect','auth_large']){
  const f=fixture({failure});assert.equal((await f.handler()(req())).status,401);assert.deepEqual(f.state.calls,['user'])
 }
 const f=fixture({deny:true});assert.equal((await f.handler()(req())).status,403);assert.equal(f.state.sends,0)
})

test('rejects browser origins, query parameters, non-POST, oversized body, target/payload/transport/batch overrides',async()=>{
 for(const options of [{headers:{origin:'https://browser.invalid'}},{url:'https://weather.fixture.invalid/api/push-operator?transport=node'},{method:'GET'}]){
  const f=fixture();assert.ok([400,405].includes((await f.handler()(req(sendBody,options))).status));assert.deepEqual(f.state.calls,[])
 }
 for(const body of ['x'.repeat(1025),{...sendBody,endpoint:'https://evil.invalid'},{...sendBody,payload:'arbitrary'},{...sendBody,transport:'legacy'},{...sendBody,deviceId:device},{...sendBody,actorId:user},[sendBody,sendBody]]){
  const f=fixture();assert.equal((await f.handler()(req(body))).status,400);assert.equal(f.state.sends,0);assert.equal(f.state.calls.includes('arm_push_operator'),false)
 }
})

test('prepare and inspection are server-owned; cancel revokes; only exact confirmation can arm',async()=>{
 const f=fixture();assert.equal((await f.handler()(req(prepareBody))).status,200);assert.equal(f.state.sends,0)
 assert.deepEqual(f.state.calls,['user','push_operator_access','prepare_push_operator','inspect_push_operator'])
 assert.equal((await f.handler()(req({operation:'cancel',permitId:permit}))).status,200)
 assert.equal((await f.handler()(req())).status,409);assert.equal(f.state.sends,0)
 for(const confirmation of ['SEND ONE','SEND','send one',`${sendBody.confirmation} `]){
  const x=fixture();assert.equal((await x.handler()(req({...sendBody,confirmation}))).status,409);assert.equal(x.state.sends,0)
 }
 const nonfcm=fixture({failure:'nonfcm'});assert.equal((await nonfcm.handler()(req(prepareBody))).status,409)
 assert.equal(nonfcm.state.revoked,true);assert.equal(nonfcm.state.dns,0)
})

test('independent serverless instances sharing the atomic DB model authorize at most one attempt',async()=>{
 const f=fixture();const responses=await Promise.all(Array.from({length:16},()=>f.handler()(req())))
 assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===409).length,15)
 assert.equal(f.state.sends,1);assert.equal(f.state.dns,1);assert.equal(f.state.finishes.length,1)
 assert.equal((await f.handler()(req())).status,409);assert.equal(f.state.sends,1)
 const important=f.state.calls.filter(n=>['claim_push_test','authorize_push_test','finish_push_test'].includes(n))
 assert.deepEqual(important,['claim_push_test','authorize_push_test','finish_push_test'])
})

test('expired/revoked permits, leases, claims and consent never reach transport',async()=>{
 for(const failure of ['expired_prepare','revoked_prepare','wrong_actor','cooldown','expired_lease','changed_revision','expired_claim','revoked_consent','authorize_refused','dns','dns_private','rpc_large','malformed_authorize','lost_arm_push_operator','lost_authorize_push_test']){
  const f=fixture({failure});const r=await f.handler()(req());assert.ok([409,503].includes(r.status),failure)
  assert.equal(f.state.sends,0,failure)
  assert.equal((await f.handler()(req())).status,409,failure);assert.equal(f.state.sends,0)
  assert.equal(JSON.stringify([await r.json(),f.state.logs]).includes(secret),false)
 }
})

test('HTTP 400, provider disconnect, unknown authorize/finish outcomes never replay and never leak secrets',async()=>{
 for(const failure of ['http400','disconnect','finish','http429']){
  const f=fixture({failure});const r=await f.handler()(req());assert.ok([502,503].includes(r.status));assert.equal(f.state.sends,1)
  const output=JSON.stringify([await r.json(),f.state.logs])
  if(failure==='http400'){assert.ok(output.includes('400'));assert.ok(output.includes('fcm_invalid_argument'));assert.equal(f.state.finishes[0].outcome,'failed')}
  if(failure==='http429')assert.equal(f.state.finishes[0].retry_seconds,null)
  for(const sensitive of [secret,vapid.privateKey,f.claim.auth,f.claim.endpoint,baseEnv.PUSH_TEST_OPERATOR_TOKEN,baseEnv.SUPABASE_SERVICE_ROLE_KEY])assert.equal(output.includes(sensitive),false)
  assert.equal((await f.handler()(req())).status,409);assert.equal(f.state.sends,1)
  assert.ok(f.state.calls.includes('close_push_operator'))
 }
})

test('caller abort before authorize prevents sending; cleanup uses an independent bounded signal',async()=>{
 const controller=new AbortController()
 const f=fixture({hook:async(name)=>{if(name==='authorize_push_test')controller.abort()}})
 const r=await f.handler()(req(sendBody,{signal:controller.signal}));assert.equal(r.status,503);assert.equal(f.state.sends,0)
 assert.ok(f.state.calls.includes('close_push_operator'));assert.equal(f.state.revoked,true)
 const already=fixture();assert.equal((await already.handler()(req(sendBody,{signal:AbortSignal.abort()}))).status,503);assert.deepEqual(already.state.calls,[])
})

test('caller abort after authorize keeps the consumed permit; no retry after interrupted send',async()=>{
 const controller=new AbortController()
 const f=fixture({transport:async({signal})=>{controller.abort();assert.equal(signal.aborted,true);throw Error(secret)}})
 const r=await f.handler()(req(sendBody,{signal:controller.signal}));assert.equal(r.status,503)
 assert.equal(f.state.burned,true);assert.equal(f.state.sends,1);assert.ok(f.state.calls.includes('close_push_operator'))
 assert.equal((await f.handler()(req())).status,409);assert.equal(f.state.sends,1)
})

test('control-plane response streaming is bounded and cancels on client abort',async()=>{
 const controller=new AbortController();let cancelled=false
 const handler=createNodeOperatorHandler({env:baseEnv,fetcher:async()=>new Response(new ReadableStream({start(){setTimeout(()=>controller.abort(),20)},cancel(){cancelled=true}}))})
 assert.equal((await handler(req(sendBody,{signal:controller.signal}))).status,401);assert.equal(cancelled,true)
})
