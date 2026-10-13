import test from 'node:test'
import assert from 'node:assert/strict'
import {createPublicKey,verify} from 'node:crypto'
import {fixtureKeys} from './push-fixtures.mjs'
import {preparePush,sendPinned,createTestHandler} from '../../supabase/functions/_shared/push-test.mjs'
const keys=fixtureKeys(),receiver=fixtureKeys(2),id='b0000000-0000-0000-0000-000000000001'
const config={...keys,subject:'mailto:test@example.invalid'}
const device={endpoint:'https://fcm.googleapis.com/wp/private-token',publicKey:keys.publicKey,p256dh:receiver.publicKey,auth:Buffer.alloc(16,1).toString('base64url'),claimId:id}
const env={PUSH_TEST_DELIVERY_ENABLED:'true',PUSH_TEST_OPERATOR_TOKEN:'a'.repeat(43),PUSH_VAPID_PUBLIC_KEY:keys.publicKey,PUSH_VAPID_PRIVATE_KEY:keys.privateKey,PUSH_VAPID_SUBJECT:config.subject}
const resolver=async()=>[{address:'8.8.8.8',family:4}]
const request=()=>new Request('https://edge.example.invalid/',{method:'POST',headers:{authorization:'Bearer '+env.PUSH_TEST_OPERATOR_TOKEN},body:JSON.stringify({permitId:id})})
test('VAPID signature verifies with exact provider audience, subject and bounded expiration',()=>{
 const details=preparePush(device,config,id),match=/^vapid t=([^,]+),\s*k=(.+)$/.exec(details.headers.Authorization)
 assert.equal(match[2],keys.publicKey)
 const [head,payload,signature]=match[1].split('.'),jwt=JSON.parse(Buffer.from(payload,'base64url'))
 assert.equal(jwt.aud,'https://fcm.googleapis.com');assert.equal(jwt.sub,config.subject)
 assert.ok(jwt.exp>Date.now()/1000 && jwt.exp<=Date.now()/1000+86400)
 const p=Buffer.from(keys.publicKey,'base64url')
 const publicKey=createPublicKey({key:{kty:'EC',crv:'P-256',x:p.subarray(1,33).toString('base64url'),y:p.subarray(33).toString('base64url')},format:'jwk'})
 assert.equal(verify('sha256',Buffer.from(head+'.'+payload),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),true)
})
test('safe provider categories retain status, with one send and no sensitive data',async()=>{
 for(const [status,category] of [[201,'accepted'],[400,'request_rejected'],[401,'provider_auth_rejected'],[403,'provider_auth_rejected'],[404,'subscription_expired'],[410,'subscription_expired'],[413,'request_rejected'],[429,'rate_limited'],[302,'redirect_refused'],[500,'provider_unavailable'],[418,'provider_rejected']]){
  let sends=0;const logs=[]
  const handler=createTestHandler({env,resolver,diagnose:d=>logs.push(d),rpc:async name=>name==='claim_push_test'?device:true,send:async()=>{sends++;return {status,retryAfter:'120',body:'secret provider body'}}})
  const response=await handler(request()),body=await response.json()
  assert.equal(response.status,status===201?200:502);assert.deepEqual(body.diagnostic,{category,providerStatus:status});assert.equal(sends,1)
  const output=JSON.stringify([body,logs]);for(const secret of [device.endpoint,device.auth,keys.privateKey,env.PUSH_TEST_OPERATOR_TOKEN,'secret provider body',id])assert.equal(output.includes(secret),false)
 }
})
test('transport errors expose only allowlisted codes; finish failure preserves provider status without retry',async()=>{
 for(const phase of ['transport','finish']){
  let sends=0;const handler=createTestHandler({env,resolver,rpc:async name=>{if(name==='finish_push_test')throw Error(device.endpoint);return name==='claim_push_test'?device:true},send:async()=>{sends++;if(phase==='transport')throw Error(device.endpoint);return {status:403}}})
  const response=await handler(request()),body=await response.json();assert.equal(response.status,503);assert.equal(sends,1)
  assert.equal(body.diagnostic.category,phase==='transport'?'transport_uncertain':'database_uncertain')
  if(phase==='finish')assert.equal(body.diagnostic.providerStatus,403)
  assert.equal(JSON.stringify(body).includes(device.endpoint),false)
 }
})
test('interim and final responses in shared or split reads; malformed response and TLS errors remain uncertain',async()=>{
 const details=preparePush(device,config,id)
 for(const split of [1,7,4096]){
  const data=Buffer.from('HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 103 Early Hints\r\n\r\nHTTP/1.1 403 Forbidden\r\n\r\n');let offset=0,closed=0
  const result=await sendPinned(details,resolver,async()=>({write:async b=>b.length,read:async b=>{const n=Math.min(split,b.length,data.length-offset);b.set(data.subarray(offset,offset+n));offset+=n;return n||null},close:()=>closed++}))
  assert.equal(result.status,403);assert.equal(closed,1)
 }
 for(const message of ['TLS_FAILED','CONNECT_FAILED','private endpoint'])await assert.rejects(sendPinned(details,resolver,async()=>{throw Error(message)}),e=>e.message==='PROVIDER_UNCERTAIN' && e.diagnosticCode===(message==='private endpoint'?'transport_failed':message.toLowerCase()))
})
test('malformed headers, upgrade and excessive interim responses fail closed',async()=>{
 for(const raw of ['HTTP/1.1 101 Switching Protocols\r\n\r\n','HTTP/1.1 100 Continue\r\nBroken\r\n\r\n','HTTP/1.1 100 Continue\r\n\r\n'.repeat(5)+'HTTP/1.1 201 OK\r\n\r\n','HTTP/1.1 403 Forbidden\r\nBroken\r\n\r\n']){
  let offset=0,closed=0;const data=Buffer.from(raw)
  await assert.rejects(sendPinned(preparePush(device,config,id),resolver,async()=>({write:async b=>b.length,read:async b=>{const n=Math.min(b.length,data.length-offset);b.set(data.subarray(offset,offset+n));offset+=n;return n||null},close:()=>closed++})),e=>e.diagnosticCode==='invalid_response')
  assert.equal(closed,1)
 }
})
test('diagnostic sink failure cannot change delivery; disabled gate never touches dependencies',async()=>{
 let sends=0
 const deps={env,resolver,rpc:async name=>name==='claim_push_test'?device:true,send:async()=>{sends++;return {status:201}},diagnose:()=>{throw Error('sink failure')}}
 assert.equal((await createTestHandler(deps)(request())).status,200);assert.equal(sends,1)
 assert.deepEqual(await (await createTestHandler({...deps,env:{...env,PUSH_TEST_DELIVERY_ENABLED:'false'},rpc:()=>{throw Error('must not call')}})(request())).json(),{error:'PUSH_TEST_DISABLED',deliveryEnabled:false})
 assert.equal(sends,1)
})
