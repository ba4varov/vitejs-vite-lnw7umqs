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
