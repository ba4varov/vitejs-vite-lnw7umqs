import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {stripTypeScriptTypes} from 'node:module'
const original=await readFile(new URL('../../src/push-client.ts',import.meta.url),'utf8')
let serial=0
async function fixture(t,restore){
 const state={restore,calls:[]}
 globalThis.__pushSessionFixture=state
 t.after(()=>{delete globalThis.__pushSessionFixture})
 const source=original.replace(/^import .*$/gm,'')+'\n'
 const injected="const accountSession=(id)=>globalThis.__pushSessionFixture.restore(id);const restoreSession=()=>accountSession('unused');const requestPushKeyCheck=()=>{};\n"
 const client=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(injected+source)).toString('base64')+'#'+serial++)
 t.mock.method(globalThis,'fetch',async(_url,options)=>{state.calls.push(options);return Response.json({code:'device:ready',deliveryEnabled:false,phoneDelivery:'unconfirmed'})})
 return {client,state}
}
const originalSession={user:{id:'same'},access_token:'synthetic-old'}
test('Push request restores the account and sends the latest token exactly once',async t=>{
 const f=await fixture(t,async id=>{assert.equal(id,'same');return {...originalSession,access_token:'synthetic-new'}})
 await f.client.sessionPushTest(originalSession,{operation:'send'})
 assert.equal(f.state.calls.length,1);assert.equal(f.state.calls[0].headers.Authorization,'Bearer synthetic-new')
})
test('logout, another account, or invalidated lifecycle during restore prevents any request',async t=>{
 for(const active of [null,{user:{id:'other'},access_token:'synthetic-other'},originalSession]){
  let current=true
  const f=await fixture(t,async()=>{current=false;return active})
  await assert.rejects(f.client.sessionPushTest(originalSession,{operation:'send'},()=>current),/session:changed/)
  assert.equal(f.state.calls.length,0)
 }
})
test('lost send response remains unknown with no automatic retry',async t=>{
 const f=await fixture(t,async()=>originalSession)
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('synthetic lost response')})
 await assert.rejects(f.client.sessionPushTest(originalSession,{operation:'send'}),/network:unknown/)
 assert.equal(calls,1)
})

test('safe provider fields survive HTTP failure and UI diagnostics never echo arbitrary data',async t=>{
 const f=await fixture(t,async()=>originalSession)
 for(const lang of ['bg','en'])for(const bodyStatus of ['recognized','empty','unknown_format','incomplete','timeout','too_large','unsupported_encoding','invalid_framing','read_failed']){
  const diagnostic={category:'request_rejected',providerStatus:400,providerBodyStatus:bodyStatus,...(bodyStatus==='recognized'?{providerReason:'fcm_unauthorized_registration'}:{}),raw:'PRIVATE_FCM_TEXT'}
  t.mock.method(globalThis,'fetch',async()=>Response.json({code:'fcm:rejected',diagnostic},{status:502}))
  let error;try{await f.client.sessionPushTest(originalSession,{operation:'send'})}catch(e){error=e}
  assert.match(error.message,/fcm:rejected.*HTTP 502/)
  const text=f.client.pushTestDiagnostic(error,lang)
  assert.ok(text.includes('provider HTTP 400'));assert.ok(text.includes('providerBodyStatus:'+bodyStatus))
  assert.ok(text.includes(bodyStatus==='recognized'?'providerReason:fcm_unauthorized_registration':lang==='bg'?'Точната причина за отказа не е установена.':'The exact rejection reason is unknown.'))
  assert.equal(text.includes('PRIVATE_FCM_TEXT'),false)
 }
 const malicious={diagnostic:{category:'PRIVATE_CATEGORY',providerStatus:'PRIVATE_STATUS',providerReason:'PRIVATE_TOKEN',providerBodyStatus:'PRIVATE_ENDPOINT',providerMimeCategory:'PRIVATE_MIME',providerBodyShape:'PRIVATE_SHAPE'}}
 for(const lang of ['bg','en'])assert.equal(f.client.pushTestDiagnostic(malicious,lang),'')
})

test('HTTP failure categories reach the phone formatter in both languages, with independent allowlists',async t=>{
 const f=await fixture(t,async()=>originalSession)
 for(const lang of ['bg','en'])for(const providerMimeCategory of ['missing','plain','html','json','other'])for(const providerBodyShape of ['known_fcm_html','generic_bad_request_html','json_error','other']){
  t.mock.method(globalThis,'fetch',async()=>Response.json({code:'fcm:rejected',diagnostic:{category:'request_rejected',providerStatus:400,providerBodyStatus:'unknown_format',providerMimeCategory,providerBodyShape}},{status:502}))
  let failure;try{await f.client.sessionPushTest(originalSession,{operation:'send'})}catch(e){failure=e}
  const text=f.client.pushTestDiagnostic(failure,lang)
  assert.ok(text.includes('providerMimeCategory:'+providerMimeCategory));assert.ok(text.includes('providerBodyShape:'+providerBodyShape))
  for(const invalid of ['PRIVATE',null,{},[],['html'],400]){
   const safe=f.client.pushTestDiagnostic({diagnostic:{providerMimeCategory:invalid,providerBodyShape:invalid}},lang)
   assert.equal(safe,'')
  }
 }
 const ui=await readFile(new URL('../../src/PushSettings.tsx',import.meta.url),'utf8')
 assert.match(ui,/catch\(e\)\{if\(current\(\)\)setMessage[\s\S]*?pushTestDiagnostic\(e,lang\)/)
 assert.match(ui,/\{message\}/)
})
