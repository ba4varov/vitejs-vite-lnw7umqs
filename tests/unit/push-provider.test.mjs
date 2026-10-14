import test from 'node:test'
import assert from 'node:assert/strict'
import {setImmediate as nextTurn} from 'node:timers/promises'
import {fixtureKeys} from './push-fixtures.mjs'
import {preparePush,sendPinned} from '../../supabase/functions/_shared/push-test.mjs'
import {safeProviderReason} from '../../supabase/functions/_shared/push-provider.mjs'

const keys=fixtureKeys(),receiver=fixtureKeys(2),id='b0000000-0000-0000-0000-000000000001'
const details=preparePush({endpoint:'https://fcm.googleapis.com/wp/isolated',publicKey:keys.publicKey,p256dh:receiver.publicKey,auth:Buffer.alloc(16,1).toString('base64url')},{...keys,subject:'mailto:test@example.invalid'},id)
const resolver=async()=>[{address:'8.8.8.8',family:4}]
async function simulate(raw,{split=4096,readError=false,stall=false,endpoint=details.endpoint}={}){
 const data=Buffer.from(raw);let offset=0,closed=0,writes=0
 const result=await sendPinned({...details,endpoint},resolver,async()=>({
  write:async bytes=>{writes++;return bytes.length},
  read:async buffer=>{
   if(offset===data.length){if(readError)throw Error('private error');if(stall)return new Promise(()=>{});return null}
   const n=Math.min(buffer.length,split,data.length-offset);buffer.set(data.subarray(offset,offset+n));offset+=n;return n
  },close:()=>closed++,
 }))
 assert.equal(closed,1);assert.equal(writes,1);return result
}
const response=(body,headers='')=>`HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\n${headers}\r\n${body}`
test('fragmented content-length/chunked FCM rejection only exposes fixed codes, ignoring private messages',async()=>{
 const body=JSON.stringify({error:{status:'INVALID_ARGUMENT',message:details.endpoint,details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:'SENDER_ID_MISMATCH',private:keys.privateKey}]}})
 for(const split of [1,7,4096]){
  for(const raw of [response(body,`Content-Length: ${Buffer.byteLength(body)}\r\n`),response(body.length.toString(16)+'\r\n'+body+'\r\n0\r\n\r\n','Transfer-Encoding: chunked\r\n')]){
   assert.deepEqual(await simulate('HTTP/1.1 100 Continue\r\n\r\n'+raw,{split}),{status:400,retryAfter:undefined,providerReason:'fcm_sender_id_mismatch'})
  }
 }
})
test('unknown, oversized, truncated, encoded and ambiguously framed bodies preserve 400 without leaking text',async()=>{
 const known=JSON.stringify({error:{status:'INVALID_ARGUMENT'}})
 const cases=[
  response(JSON.stringify({error:{status:details.endpoint,message:'INVALID_ARGUMENT'}})),
  response('malformed '+details.endpoint),
  response('x'.repeat(1025)),
  response(known,'Content-Length: 1025\r\n'),
  response(known,'Content-Length: 1000\r\n'),
  response(known,`Content-Length: ${known.length}\r\nContent-Length: ${known.length}\r\n`),
  response(known,'Content-Length: 1\r\nTransfer-Encoding: chunked\r\n'),
  response(known,'Content-Encoding: gzip\r\n'),
  response('z\r\n'+known+'\r\n','Transfer-Encoding: chunked\r\n'),
  response('ffff\r\n','Transfer-Encoding: chunked\r\n'),
  response('1\r\nxXX0\r\n\r\n','Transfer-Encoding: chunked\r\n'),
  'HTTP/1.1 400 Bad Request\r\nContent-Type: text/html\r\n\r\nINVALID_ARGUMENT',
 ]
 for(const raw of cases)assert.deepEqual(await simulate(raw),{status:400,retryAfter:undefined})
 assert.deepEqual(await simulate(response('', 'Content-Length: 100\r\n'),{readError:true}),{status:400,retryAfter:undefined})
 assert.deepEqual(await simulate(response(known),{endpoint:'https://updates.push.services.mozilla.com/wpush/v2/isolated'}),{status:400,retryAfter:undefined})
})
test('plaintext classification requires an exact known identifier; arbitrary text is never returned',async()=>{
 for(const [body,reason] of [['InvalidRegistration','fcm_invalid_registration'],['UnauthorizedRegistration','fcm_unauthorized_registration'],['InvalidTTL','fcm_invalid_ttl'],['InvalidTTL '+details.endpoint,undefined]]){
  const result=await simulate(`HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\n\r\n${body}`)
  assert.equal(result.providerReason,reason)
 }
 for(const value of ['private token',details.endpoint,keys.privateKey,null,{},'INVALID_ARGUMENT'])assert.equal(safeProviderReason(value),undefined)
})
test('diagnostic reads stop after 300 ms; the original 8 s deadline also preserves a received final status',async t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 const raw=response('','Content-Length: 100\r\n')
 let result=simulate(raw,{stall:true});await nextTurn();t.mock.timers.tick(300)
 assert.deepEqual(await result,{status:400,retryAfter:undefined})
 result=simulate(raw,{stall:true});await nextTurn();t.mock.timers.tick(8000)
 assert.deepEqual(await result,{status:400,retryAfter:undefined})
})
