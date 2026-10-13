import test from 'node:test'
import assert from 'node:assert/strict'
import {fixtureKeys} from './push-fixtures.mjs'
import {createOperatorHandler} from '../../supabase/functions/_shared/push-operator.mjs'
const key=fixtureKeys(),id='b0000000-0000-0000-0000-000000000001',other='b0000000-0000-0000-0000-000000000002'
const env={PUSH_TEST_DELIVERY_ENABLED:'true',PUSH_TEST_OPERATOR_TOKEN:'a'.repeat(43),PUSH_VAPID_PUBLIC_KEY:key.publicKey,PUSH_VAPID_PRIVATE_KEY:key.privateKey,PUSH_VAPID_SUBJECT:'mailto:test@example.invalid'}
const device={endpoint:'https://fcm.googleapis.com/wp/test-only',publicKey:key.publicKey,p256dh:fixtureKeys(2).publicKey,auth:Buffer.alloc(16,1).toString('base64url'),claimId:id}
const prep={operation:'prepare',userId:id,deviceId:id,category:'wind',requestId:id}
const req=(b,authorization='Bearer '+env.PUSH_TEST_OPERATOR_TOKEN+'.user.jwt.signature',extra={})=>new Request('https://edge.example.invalid/',{method:'POST',headers:{authorization,...extra},body:JSON.stringify(b)})
function fixture({deny,fail,status=403}={}){
 const calls=[];let sent=0,armed=false
 const deps={env,getUser:async jwt=>{assert.equal(jwt,'user.jwt.signature');if(fail==='session')throw Error('private');return {id}},resolver:async()=>{if(fail==='dns')throw Error('private');return [{address:'8.8.8.8',family:4}]},rpc:async(name,payload)=>{
  calls.push([name,payload]);if(name==='push_operator_access')return !deny
  if(name==='prepare_push_operator')return {permitId:id,userId:id,deviceId:id,category:'wind',expiresAt:new Date(Date.now()+120000).toISOString()}
  if(name==='inspect_push_operator')return fail==='device'?{...device,auth:'bad'}:device
  if(name==='arm_push_operator'){if(fail==='arm'||armed)throw Error('private');armed=true;return true}
  if(name==='claim_push_test')return fail==='claim'?null:device
  if(name==='authorize_push_test')return fail!=='authorize'
  if(name==='finish_push_test'&&fail==='finish')throw Error('private')
  return true
 },send:async()=>{sent++;if(fail==='send')throw Error('private');return {status}}}
 return {calls,deps,handler:createOperatorHandler(deps),sent:()=>sent}
}
test('operator alone, JWT alone, forged/expired session and nonselected admin cannot initiate',async()=>{
 for(const header of ['Bearer '+env.PUSH_TEST_OPERATOR_TOKEN,'Bearer user.jwt.signature','Bearer '+'b'.repeat(43)+'.user.jwt.signature']){
  const f=fixture();assert.equal((await f.handler(req(prep,header))).status,401);assert.equal(f.calls.length,0)
 }
 const bad=fixture({fail:'session'});assert.equal((await bad.handler(req(prep))).status,401);assert.equal(bad.calls.length,0)
 const denied=fixture({deny:true});assert.equal((await denied.handler(req(prep))).status,403);assert.equal(denied.sent(),0)
})
test('preflight binds verified actor and selected device, validates subscription, never sends or opens lease',async()=>{
 const f=fixture(),response=await f.handler(req(prep));assert.equal(response.status,200)
 assert.deepEqual(f.calls.map(c=>c[0]),['push_operator_access','prepare_push_operator','inspect_push_operator'])
 assert.equal(f.calls[1][1].actor_id,id);assert.equal(f.sent(),0)
 const body=await response.json();assert.equal(body.error,'PUSH_TEST_READY')
 for(const secret of [device.endpoint,device.auth,key.privateKey,env.PUSH_TEST_OPERATOR_TOKEN])assert.equal(JSON.stringify(body).includes(secret),false)
 const invalid=fixture({fail:'device'});assert.equal((await invalid.handler(req(prep))).status,409)
 assert.equal(invalid.calls.at(-1)[0],'cancel_push_operator')
})
test('client actor spoofing, arbitrary recipients/text, legacy send and browser Origin are refused',async()=>{
 for(const b of [{...prep,actorId:other},{...prep,endpoint:device.endpoint},{...prep,message:'arbitrary'},{permitId:id}]){
  const f=fixture();assert.equal((await f.handler(req(b))).status,400);assert.equal(f.sent(),0)
 }
 const f=fixture();assert.equal((await f.handler(req(prep,undefined,{origin:'https://app.invalid'}))).status,400);assert.equal(f.calls.length,0)
 const off=fixture();assert.equal((await createOperatorHandler({...off.deps,env:{...env,PUSH_TEST_DELIVERY_ENABLED:'false'}})(req(prep))).status,503);assert.equal(off.calls.length,0)
})
test('confirmed send is armed server-side once, provider status retained; duplicate cannot replay',async()=>{
 const f=fixture(),body={operation:'send',permitId:id,confirmation:`SEND ONE ${id} ${id}`}
 const response=await f.handler(req(body));assert.equal(response.status,502);assert.deepEqual((await response.json()).diagnostic,{category:'provider_auth_rejected',providerStatus:403})
 assert.equal(f.sent(),1);assert.equal(f.calls.at(-1)[0],'close_push_operator')
 assert.equal((await f.handler(req(body))).status,409);assert.equal(f.sent(),1)
})
test('arm/consent/DNS/transport/finish errors never retry and always close/cancel',async()=>{
 for(const fail of ['arm','claim','authorize','dns','send','finish']){
  const f=fixture({fail}),r=await f.handler(req({operation:'send',permitId:id,confirmation:`SEND ONE ${id} ${id}`}))
  assert.ok([409,503].includes(r.status));assert.equal(f.sent(),['send','finish'].includes(fail)?1:0)
  assert.equal(f.calls.at(-1)[0],fail==='arm'?'cancel_push_operator':'close_push_operator')
  assert.equal((await r.text()).includes('private'),false)
 }
})
