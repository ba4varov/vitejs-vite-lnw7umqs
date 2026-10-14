import test from 'node:test'
import assert from 'node:assert/strict'
import {webcrypto,createHash} from 'node:crypto'
import {renewPush,pushRenewalMessages} from '../../src/push-renewal.js'
const key=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url')
function fixture(){
 const events=[],endpoint='https://fcm.googleapis.com/wp/synthetic-old'
 const device={id:'selected',label:'Note 13 Pro',fingerprint:createHash('sha256').update(endpoint).digest('hex')}
 const old={endpoint,options:{applicationServerKey:Buffer.from(key,'base64url')},unsubscribe:async()=>{events.push('unsubscribe');return true}}
 const payload={endpoint:'https://fcm.googleapis.com/wp/synthetic-new',keys:{p256dh:'synthetic',auth:'synthetic'}}
 const renewed={toJSON:()=>payload,unsubscribe:()=>{throw Error('must keep new subscription')}}
 const registration={scope:'https://meteo.invalid/',active:{scriptURL:'https://meteo.invalid/push-sw.js'},pushManager:{getSubscription:async()=>old,subscribe:async options=>{events.push('subscribe');assert.equal(options.userVisibleOnly,true);assert.deepEqual(options.applicationServerKey,new Uint8Array(Buffer.from(key,'base64url')));return renewed}}}
 const snapshot={registrationEnabled:true,publicKey:key,devices:[device],pro:false,preferences:{enabled:true,cities:[{}],categories:['danger']}}
 const scope={isSecureContext:true,location:{origin:'https://meteo.invalid'},crypto:webcrypto,navigator:{serviceWorker:{getRegistration:async()=>registration}},Notification:{permission:'granted',requestPermission:()=>{throw Error('no prompts')}}}
 const args={scope,device,key,load:async()=>{events.push('load');return snapshot},confirm:async()=>{events.push('confirm');return true},authorize:async()=>{events.push('authorize');return true},persist:async(value,label)=>{events.push('POST');assert.equal(value,payload);assert.equal(label,device.label);return {...snapshot,devices:[device,{id:'new'}]}}}
 return {args,events,old,registration,snapshot}
}
test('successful renewal retains old DB record and uses same VAPID and authenticated persistence',async()=>{
 const {args,events}=fixture();const result=await renewPush(args)
 assert.equal(result.status,'success');assert.equal(result.data.devices[0],args.device)
 assert.deepEqual(events,['load','confirm','load','authorize','unsubscribe','subscribe','POST'])
})
test('explicit cancellation never mutates',async()=>{
 const {args,events}=fixture();args.confirm=()=>false
 assert.equal((await renewPush(args)).status,'cancelled');assert.deepEqual(events,['load'])
})
test('endpoint and VAPID mismatch never ask confirmation or mutate',async()=>{
 for(const mismatch of ['endpoint','key']){
  const {args,old,events}=fixture()
  if(mismatch==='endpoint')old.endpoint+='other';else old.options.applicationServerKey=new Uint8Array(65)
  assert.equal((await renewPush(args)).status,mismatch==='endpoint'?'device-mismatch':'vapid-mismatch')
  assert.deepEqual(events,['load'])
 }
})
test('disabled registrations, preferences, Pro access, device limit, permission and missing owner record block before unsubscribe',async()=>{
 for(const [status,change] of [
  ['registration-disabled',f=>f.snapshot.registrationEnabled=false],
  ['preferences-required',f=>f.snapshot.preferences.enabled=false],
  ['preferences-required',f=>f.snapshot.preferences.categories=['walk']],
  ['device-limit',f=>f.snapshot.devices=Array(10).fill(f.args.device)],
  ['permission-required',f=>f.args.scope.Notification.permission='denied'],
  ['device-mismatch',f=>f.snapshot.devices=[]],
  ['preflight-failed',f=>f.args.load=async()=>{throw Error('private')}],
 ]){
  const f=fixture();change(f);assert.equal((await renewPush(f.args)).status,status)
  assert.ok(!f.events.some(e=>['unsubscribe','subscribe','POST'].includes(e)))
 }
})
test('checks repeat after confirmation; changed permission, key or subscription cannot unsubscribe',async()=>{
 for(const change of [f=>f.snapshot.registrationEnabled=false,f=>f.old.endpoint+='other',f=>f.snapshot.publicKey='other']){
  const f=fixture();f.args.confirm=()=>{change(f);return true}
  assert.notEqual((await renewPush(f.args)).status,'success');assert.ok(!f.events.includes('unsubscribe'))
 }
 const f=fixture();let lookups=0
 f.registration.pushManager.getSubscription=async()=>++lookups===3?{...f.old,endpoint:'other'}:f.old
 assert.equal((await renewPush(f.args)).status,'device-mismatch');assert.ok(!f.events.includes('unsubscribe'))
})
test('session failure blocks unsubscribe',async()=>{
 const f=fixture();f.args.authorize=()=>false
 assert.equal((await renewPush(f.args)).status,'preflight-failed');assert.ok(!f.events.includes('unsubscribe'))
})
test('lost save response and explicit API rejection keep new subscription without retry',async()=>{
 for(const [error,status] of [[Error('lost response'),'save-unconfirmed'],[Object.assign(Error('forbidden'),{status:403}),'save-rejected']]){
  const f=fixture();f.args.persist=async()=>{f.events.push('POST');throw error}
  assert.equal((await renewPush(f.args)).status,status)
  assert.equal(f.events.filter(e=>e==='POST').length,1)
  assert.equal(f.events.filter(e=>e==='unsubscribe').length,1)
  assert.equal(f.events.filter(e=>e==='subscribe').length,1)
 }
})
test('failed new subscription preserves DB and never persists or retries',async()=>{
 const f=fixture();f.registration.pushManager.subscribe=async()=>{f.events.push('subscribe');throw Error('private')}
 assert.equal((await renewPush(f.args)).status,'subscribe-failed');assert.ok(!f.events.includes('POST'));assert.equal(f.snapshot.devices[0],f.args.device)
})
test('false or lost unsubscribe result never subscribes',async()=>{
 for(const fail of [async()=>false,async()=>{throw Error('private')}]){
  const f=fixture();f.old.unsubscribe=fail
  assert.equal((await renewPush(f.args)).status,'unsubscribe-unconfirmed');assert.ok(!f.events.includes('subscribe'))
 }
})
test('BG and EN cover every state with fixed messages and irreversible warning',()=>{
 assert.deepEqual(Object.keys(pushRenewalMessages.bg).sort(),Object.keys(pushRenewalMessages.en).sort())
 for(const messages of Object.values(pushRenewalMessages))for(const message of Object.values(messages))assert.ok(typeof message==='string'&&message.length>0&&!message.includes('synthetic'))
 assert.match(pushRenewalMessages.en.warning,/cannot reliably be restored/)
})
