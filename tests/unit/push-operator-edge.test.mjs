import test from 'node:test'
import assert from 'node:assert/strict'
import {fixtureKeys} from './push-fixtures.mjs'
import {createTestHandler} from '../../supabase/functions/_shared/push-test.mjs'
const key=fixtureKeys(),id='b0000000-0000-0000-0000-000000000001'
const env={PUSH_TEST_DELIVERY_ENABLED:'true',PUSH_TEST_OPERATOR_TOKEN:'a'.repeat(43),PUSH_VAPID_PUBLIC_KEY:key.publicKey,PUSH_VAPID_PRIVATE_KEY:key.privateKey,PUSH_VAPID_SUBJECT:'mailto:test@example.invalid'}
const device={endpoint:'https://fcm.googleapis.com/wp/test-only',publicKey:key.publicKey,p256dh:fixtureKeys(2).publicKey,auth:Buffer.alloc(16,1).toString('base64url'),claimId:id}
const req=b=>new Request('https://edge.example.invalid/',{method:'POST',headers:{authorization:'Bearer '+env.PUSH_TEST_OPERATOR_TOKEN},body:JSON.stringify(b)})
test('configuration/device preflights never claim, authorize, arm or send; device secrets stay on Edge',async()=>{
 const calls=[]
 const handler=createTestHandler({env,rpc:async name=>{calls.push(name);return device},send:async()=>{throw Error('must not send')}})
 assert.equal((await handler(req({operation:'preflight'}))).status,200);assert.equal(calls.length,0)
 const response=await handler(req({preflightPermitId:id}));assert.equal(response.status,200)
 assert.deepEqual(calls,['inspect_push_operator']);assert.deepEqual(await response.json(),{error:'PUSH_TEST_READY',deliveryEnabled:false})
 assert.equal((await handler(req({operation:'preflight',permitId:id}))).status,400)
})
test('cleanup is attempted on DNS failure, denied claim/authorization, invalid device and send uncertainty',async()=>{
 for(const failure of ['dns','claim','authorize','device','send']){
  let sends=0;const calls=[]
  const handler=createTestHandler({env,resolver:async()=>{if(failure==='dns')throw Error('secret');return [{address:'8.8.8.8',family:4}]},rpc:async name=>{
   calls.push(name);if(name==='claim_push_test')return failure==='claim'?null:failure==='device'?{...device,auth:'bad'}:device
   return name==='authorize_push_test'?failure!=='authorize':true
  },send:async()=>{sends++;throw Error('secret')}})
  const response=await handler(req({permitId:id}));assert.ok([409,503].includes(response.status))
  assert.equal(calls.at(-1),'close_push_operator');assert.equal(sends,failure==='send'?1:0)
 }
})
