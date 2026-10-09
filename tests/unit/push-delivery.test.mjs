import test from 'node:test'
import assert from 'node:assert/strict'
import {createECDH,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto'
import webpush from 'web-push'
import {validVapid,validEndpoint,publicAddress,pinnedLookup,retryDelay,preparePush,sendPinned,createTestHandler} from '../../supabase/functions/_shared/push-test.mjs'

// Ephemeral in-memory keys only. No provider requests or saved keys.
const keys=webpush.generateVAPIDKeys(),other=webpush.generateVAPIDKeys()
const config={publicKey:keys.publicKey,privateKey:keys.privateKey,subject:'mailto:test@example.invalid'}
const receiver=createECDH('prime256v1');receiver.generateKeys()
const auth=randomBytes(16),id='b0000000-0000-0000-0000-000000000001'
const device={endpoint:'https://fcm.googleapis.com/wp/isolated',publicKey:keys.publicKey,p256dh:receiver.getPublicKey().toString('base64url'),auth:auth.toString('base64url'),language:'bg',claimId:'b0000000-0000-0000-0000-000000000002'}
const env={PUSH_TEST_DELIVERY_ENABLED:'true',PUSH_TEST_OPERATOR_TOKEN:randomBytes(32).toString('base64url'),PUSH_VAPID_PUBLIC_KEY:keys.publicKey,PUSH_VAPID_PRIVATE_KEY:keys.privateKey,PUSH_VAPID_SUBJECT:config.subject}
const resolver=async()=>[{address:'142.250.74.234',family:4}]
const request=(body={permitId:id},headers={})=>new Request('https://edge.example.invalid/push-test',{method:'POST',headers:{authorization:'Bearer '+env.PUSH_TEST_OPERATOR_TOKEN,...headers},body:JSON.stringify(body)})

test('VAPID pair validates curve, canonical encoding, matching private key and subject',()=>{
 assert.equal(validVapid(keys.publicKey,keys.privateKey,config.subject),true)
 assert.equal(validVapid(keys.publicKey,keys.privateKey,'https://example.invalid/contact'),true)
 for(const [p,s,c] of [[keys.publicKey,other.privateKey,config.subject],['A'.repeat(87),keys.privateKey,config.subject],[keys.publicKey,'A'.repeat(43),config.subject],[keys.publicKey,keys.privateKey,'http://example.invalid'],[keys.publicKey,keys.privateKey,'mailto:broken'],[keys.publicKey,keys.privateKey,'https://user:secret@example.invalid']])assert.equal(validVapid(p,s,c),false)
})
test('web-push RFC 8291 encrypted body decrypts on simulated receiver; RFC 8292 signed VAPID headers',()=>{
 for(const language of ['bg','en']){
  const details=preparePush({...device,language},config,id)
  assert.equal(details.headers['Content-Encoding'],'aes128gcm')
  assert.match(details.headers.Authorization,/^vapid t=ey/)
  assert.equal(details.headers.TTL,60)
  const body=details.body,salt=body.subarray(0,16),keySize=body[20],sender=body.subarray(21,21+keySize)
  const shared=receiver.computeSecret(sender)
  const info=Buffer.concat([Buffer.from('WebPush: info\0'),receiver.getPublicKey(),sender])
  const ikm=Buffer.from(hkdfSync('sha256',shared,auth,info,32))
  const cek=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16))
  const nonce=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12))
  const encrypted=body.subarray(21+keySize),decrypt=createDecipheriv('aes-128-gcm',cek,nonce)
  decrypt.setAuthTag(encrypted.subarray(-16))
  const plaintext=Buffer.concat([decrypt.update(encrypted.subarray(0,-16)),decrypt.final()])
  assert.equal(plaintext.at(-1),2)
  const payload=JSON.parse(plaintext.subarray(0,-1).toString())
  assert.equal(payload.eventId,id);assert.equal(payload.url,undefined)
  assert.match(payload.body,language==='bg'?/изрично разрешеното/:/explicitly approved/)
 }
 for(const invalid of [{...device,endpoint:'https://127.0.0.1/'},{...device,publicKey:other.publicKey},{...device,p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url')},{...device,auth:'short'}])assert.throws(()=>preparePush(invalid,config,id))
})
test('SSRF allowlist and pinned DNS reject private, mapped, reserved, mixed and rebinding addresses',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.168.1.1','0.0.0.0','192.0.2.1','198.18.0.1','224.0.0.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1','invalid'])assert.equal(publicAddress(ip),false,ip)
 for(const ip of ['8.8.8.8','142.250.74.234','2606:4700:4700::1111'])assert.equal(publicAddress(ip),true,ip)
 for(const url of ['https://fcm.googleapis.com:443/wp/a','https://fcm.googleapis.com.evil.invalid/wp/a','https://user@fcm.googleapis.com/wp/a','https://fcm.googleapis.com/wp/a#x','https://fcm.googleapis.com/wp/a?url=http://localhost','https://[::1]/','http://fcm.googleapis.com/wp/a'])assert.equal(validEndpoint(url),false)
 await assert.rejects(pinnedLookup('fcm.googleapis.com',async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]))
 const pinned=await pinnedLookup('fcm.googleapis.com',resolver)
 await new Promise((resolve,reject)=>pinned('ignored.invalid',{},(err,address)=>{if(err)return reject(err);assert.equal(address,'142.250.74.234');resolve()}))
})
test('transport preserves TLS hostname, connects to a validated IP, bounds body and never follows redirects',async()=>{
 const details=preparePush(device,config,id);let requests=0
 const simulate=(status,oversized=false)=>async(target)=>{
  requests++;assert.equal(target.address,'142.250.74.234');assert.equal(target.hostname,'fcm.googleapis.com')
  const response=Buffer.from(`HTTP/1.1 ${status} Test\r\nRetry-After: 120\r\nLocation: http://127.0.0.1\r\n${oversized?'X-Padding: '+'a'.repeat(4097)+'\r\n':''}\r\n`);let offset=0
  return {write:async bytes=>{assert.match(bytes.toString(),/^POST \/wp\/isolated HTTP\/1\.1/);return bytes.length},read:async buffer=>{const n=Math.min(buffer.length,response.length-offset);buffer.set(response.subarray(offset,offset+n));offset+=n;return n || null},close(){}}
 }
 assert.equal((await sendPinned(details,resolver,simulate(302))).status,302);assert.equal(requests,1)
 await assert.rejects(sendPinned(details,resolver,simulate(200,true)))
 assert.equal(retryDelay('120'),120);assert.equal(retryDelay(undefined),900)
 assert.equal(retryDelay(new Date(Date.now()+180000).toUTCString())>=179,true)
 assert.equal(retryDelay('99999999999999'),null)
})
test('server gates and independent operator token reject users, extra recipients, URLs and browser calls before DB',async()=>{
 let db=0,sent=0
 const dependencies={env,rpc:async()=>{db++;return device},send:async()=>{sent++;return {status:201}},resolver}
 assert.equal((await createTestHandler({...dependencies,env:{...env,PUSH_TEST_DELIVERY_ENABLED:'false'}})(request())).status,503)
 assert.equal((await createTestHandler(dependencies)(request({}, {authorization:'Bearer ordinary-user-jwt'}))).status,401)
 for(const body of [{permitId:id,deviceId:'foreign'},{permitId:id,url:'https://evil.invalid'},{permitId:'bad'},{permitId:[id]}])assert.equal((await createTestHandler(dependencies)(request(body))).status,400)
 assert.equal((await createTestHandler(dependencies)(request({permitId:id},{origin:'https://app.invalid'}))).status,400)
 assert.equal((await createTestHandler({...dependencies,env:{...env,PUSH_VAPID_PRIVATE_KEY:other.privateKey}})(request())).status,503)
 assert.equal(db,0);assert.equal(sent,0)
})
test('single simulated delivery burns authorization; duplicates, current consent refusal and network uncertainty never retry',async()=>{
 let reserved=false,authorized=false,sent=0;const calls=[]
 const rpc=async(name,payload)=>{
  calls.push([name,payload])
  if(name==='claim_push_test'){if(reserved)return null;reserved=true;return device}
  if(name==='authorize_push_test'){authorized=true;return true}
 }
 const handler=createTestHandler({env,rpc,resolver,send:async()=>{assert.equal(authorized,true);sent++;return {status:201}}})
 const responses=await Promise.all([handler(request()),handler(request())])
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(sent,1)
 assert.equal(calls.at(-1)[1].outcome,'sent')
 const deny=createTestHandler({env,resolver,rpc:async name=>name==='claim_push_test'?device:false,send:async()=>{throw Error('must not send')}})
 assert.equal((await deny(request())).status,409)
 let attempts=0
 const uncertain=createTestHandler({env,resolver,rpc:async name=>name==='claim_push_test'?device:true,send:async()=>{attempts++;throw Error('secret endpoint must never escape')}})
 const response=await uncertain(request());assert.equal(response.status,503);assert.equal(attempts,1);assert.equal((await response.text()).includes('secret'),false)
})
test('provider 404/410 invalidate; 429 forwards Retry-After; redirects fail without another attempt',async()=>{
 for(const [status,outcome] of [[404,'expired'],[410,'expired'],[429,'throttled'],[302,'failed']]){
  const calls=[];let sent=0
  const handler=createTestHandler({env,resolver,rpc:async(name,payload)=>{calls.push([name,payload]);return name==='claim_push_test'?device:true},send:async()=>{sent++;return {status,retryAfter:'123'}}})
  assert.equal((await handler(request())).status,502);assert.equal(sent,1)
  assert.equal(calls.at(-1)[1].outcome,outcome)
  assert.equal(calls.at(-1)[1].retry_seconds,status===429?123:0)
 }
})
