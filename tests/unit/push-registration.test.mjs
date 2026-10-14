import test from 'node:test'
import assert from 'node:assert/strict'
import {webcrypto,createHash} from 'node:crypto'
import {checkPushRegistration,pushRegistrationMessages} from '../../src/push-browser.js'
const key=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url')
const endpoint='https://fcm.googleapis.com/wp/synthetic-private-token'
const device={fingerprint:createHash('sha256').update(endpoint).digest('hex')}
function fixture(){
 const forbidden=()=>{throw Error('Unexpected mutation or sensitive serialization')}
 const subscription={endpoint,options:{applicationServerKey:Uint8Array.from(Buffer.from(key,'base64url')).buffer},unsubscribe:forbidden,toJSON:forbidden,getKey:forbidden}
 const registration={scope:'https://meteo.invalid/',active:{scriptURL:'https://meteo.invalid/push-sw.js'},pushManager:{getSubscription:async()=>subscription,subscribe:forbidden}}
 const scope={isSecureContext:true,location:{origin:'https://meteo.invalid'},crypto:webcrypto,navigator:{serviceWorker:{getRegistration:async url=>{assert.equal(url,'/');return registration},register:forbidden}},Notification:{requestPermission:forbidden},fetch:forbidden,localStorage:{setItem:forbidden}}
 return {scope,registration,subscription}
}
test('read-only match hashes the endpoint and returns only a status',async()=>{
 const {scope}=fixture()
 assert.equal(await checkPushRegistration({scope,device,key}),'match')
})
test('missing subscription, missing worker and unrelated worker never match',async()=>{
 for(const kind of ['subscription','worker','script','scope']){
  const {scope,registration}=fixture()
  if(kind==='subscription')registration.pushManager.getSubscription=async()=>null
  if(kind==='worker')registration.active=null
  if(kind==='script')registration.active.scriptURL='https://meteo.invalid/other-sw.js'
  if(kind==='scope')registration.scope='https://meteo.invalid/other/'
  assert.equal(await checkPushRegistration({scope,device,key}),'missing-subscription')
 }
})
test('VAPID mismatch includes absent key and takes precedence over device mismatch',async()=>{
 for(const actual of [new Uint8Array(65).buffer,null]){
  const {scope,subscription}=fixture();subscription.options.applicationServerKey=actual
  assert.equal(await checkPushRegistration({scope,device:{fingerprint:'0'.repeat(64)},key}),'vapid-mismatch')
 }
})
test('different device and failures remain distinct; sensitive exception never escapes',async()=>{
 const {scope,registration}=fixture()
 assert.equal(await checkPushRegistration({scope,device:{fingerprint:'0'.repeat(64)},key}),'device-mismatch')
 for(const badKey of [null,'invalid'])assert.equal(await checkPushRegistration({scope,device,key:badKey}),'unavailable')
 assert.equal(await checkPushRegistration({scope,device:{fingerprint:''},key}),'unavailable')
 registration.pushManager.getSubscription=async()=>{throw Error(endpoint)}
 assert.equal(await checkPushRegistration({scope,device,key}),'unavailable')
 assert.equal(await checkPushRegistration({scope:{isSecureContext:false},device,key}),'unavailable')
 for(const messages of Object.values(pushRegistrationMessages))for(const status of ['match','missing-subscription','vapid-mismatch','device-mismatch','unavailable']){
  assert.equal(typeof messages[status],'string');assert.ok(!messages[status].includes(endpoint));assert.ok(!messages[status].includes(key))
 }
})
