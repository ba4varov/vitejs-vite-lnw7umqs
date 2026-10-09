import test from 'node:test'
import assert from 'node:assert/strict'
import {handleActivity} from '../../server/activity-core.js'
import {createActivityTracker} from '../../src/activity-tracker.js'
const id='10000000-0000-0000-0000-000000000001'
const session={user:{id},access_token:'isolated-token'}
const env={SUPABASE_URL:'https://isolated.invalid',SUPABASE_ANON_KEY:'anon'}
const res=()=>({statusCode:0,payload:null,setHeader(){},status(n){this.statusCode=n;return this},json(v){this.payload=v;return this}})
const run=async(method,body,fetcher,authorization='Bearer isolated-token')=>{const r=res();await handleActivity({method,body,headers:{authorization}},r,env,fetcher);return r}
test('analytics requires a real Auth user for every method; expired/malformed JWT rejected',async()=>{
 for(const method of ['GET','PATCH','POST']) for(const token of [undefined,'invalid','Bearer expired']) {
  const result=await run(method,{},async()=>({ok:false}),token)
  assert.equal(result.statusCode,401)
 }
})
test('event API whitelists payload; forged identity or content never reaches RPC',async()=>{
 for(const body of [{action:'chat_text',operationId:id,revision:id},{action:'chat_use',operationId:id,revision:id,userId:id},{action:'chat_use',operationId:'bad',revision:id},{enabled:true,userId:id}]) {
  const result=await run('enabled'in body?'PATCH':'POST',body,async()=>({ok:true,json:async()=>session.user}))
  assert.equal(result.statusCode,400)
 }
})
test('API forwards only verified token and minimal RPC body; never service role',async()=>{
 const calls=[]
 const result=await run('POST',{action:'chat_use',operationId:id,revision:id},async(url,init)=>{
  calls.push({url,init});return {ok:true,json:async()=>url.endsWith('/user')?session.user:{recorded:true}}
 })
 assert.equal(result.statusCode,200)
 assert.equal(calls[1].init.headers.Authorization,'Bearer isolated-token')
 assert.deepEqual(JSON.parse(calls[1].init.body),{selected_action:'chat_use',operation_id:id,consent_revision:id})
})
test('absent migration and network failure produce bounded unavailable result',async()=>{
 assert.equal((await run('GET',{},async()=>{throw Error('offline')})).statusCode,503)
 assert.equal((await run('GET',{},async(url)=>url.endsWith('/user')?{ok:true,json:async()=>session.user}:{ok:false,status:404})).statusCode,503)
})
test('no guest, default, or withdrawn-consent tracking; consent enables only minimal counts',async()=>{
 const calls=[];const tracker=createActivityTracker({getSession:async()=>session,request:async(...args)=>{calls.push(args);return{recorded:true}},randomId:()=>id})
 assert.equal(await tracker.track('forecast_view'),false)
 tracker.reset(id);tracker.apply(id,{enabled:false,revision:id});await tracker.track('chat_use');assert.equal(calls.length,0)
 tracker.apply(id,{enabled:true,revision:id});assert.equal(await tracker.track('chat_use'),true)
 assert.deepEqual(calls[0][2],{action:'chat_use',operationId:id,revision:id})
 tracker.invalidate();await tracker.track('chat_use');assert.equal(calls.length,1)
})
test('withdrawal and account changes cancel awaiting events',async()=>{
 let complete;const calls=[]
 const tracker=createActivityTracker({getSession:()=>new Promise(resolve=>complete=resolve),request:async(...args)=>{calls.push(args)},randomId:()=>id})
 tracker.reset(id);tracker.apply(id,{enabled:true,revision:id});const pending=tracker.track('chat_use');tracker.invalidate();complete(session)
 assert.equal(await pending,false);assert.equal(calls.length,0)
 tracker.apply(id,{enabled:true,revision:id});const pending2=tracker.track('chat_use');tracker.reset('other');complete(session);assert.equal(await pending2,false)
})
test('failed analytics never rejects user action and is never retried',async()=>{
 let calls=0;const tracker=createActivityTracker({getSession:async()=>session,request:async()=>{calls++;throw Error('offline')},randomId:()=>id})
 tracker.reset(id);tracker.apply(id,{enabled:true,revision:id})
 assert.equal(await tracker.track('chat_use'),false);assert.equal(calls,1)
})

test('public entry does not load unconditional Vercel analytics for guests',async()=>{
 const {readFile}=await import('node:fs/promises')
 assert.doesNotMatch(await readFile(new URL('../../index.html',import.meta.url),'utf8'), /insights\/script|google-analytics|gtag/)
})
