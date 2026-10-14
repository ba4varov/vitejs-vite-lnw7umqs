import test from 'node:test'
import assert from 'node:assert/strict'
import {options,runOperator} from '../../scripts/push-operator.mjs'
const id='b0000000-0000-0000-0000-000000000001',o=options(['a'.repeat(20),id,id])
function fixture({approve=true,fail,diagnostic={category:'accepted',providerStatus:201}}={}){
 const calls=[],output=[]
 return {calls,output,deps:{requestId:id,edge:async b=>{
  calls.push(b);if(b.operation==='prepare')return {error:'PUSH_TEST_READY',permitId:id,userId:o.user,deviceId:o.device,category:o.category}
  if(b.operation==='cancel'){if(fail==='cancel')throw Error('private');return {error:'PUSH_TEST_CLOSED'}}
  if(fail==='send')throw Error('private-token');return {diagnostic}
 },confirm:async phrase=>{assert.equal(phrase,'SEND ONE');return approve?'SEND ONE':'CANCEL'},output:s=>output.push(s)}}
}
test('strict Production selection requires no psql, approver argument or DB credentials',()=>{
 assert.equal(o.category,'wind')
 for(const args of [[],['https://evil',id,id],['a'.repeat(20),id+"';",id],['a'.repeat(20),id,id,'unknown']])assert.throws(()=>options(args))
})
test('cancelled confirmation never sends; server owns preparation and cancellation',async()=>{
 const f=fixture({approve:false});await runOperator(o,f.deps)
 assert.deepEqual(f.calls.map(b=>b.operation),['prepare','cancel'])
})
test('one confirmed send even after uncertainty; cancellation is never a delivery retry',async()=>{
 for(const fail of [undefined,'send']){
  const f=fixture({fail});if(fail)await assert.rejects(runOperator(o,f.deps));else await runOperator(o,f.deps)
  assert.deepEqual(f.calls.map(b=>b.operation),['prepare','send','cancel'])
  assert.equal(f.calls[1].confirmation,`SEND ONE ${o.user} ${o.device}`)
 }
})
test('actual provider status/category survives; untrusted diagnostics are never printed',async()=>{
 const f=fixture({diagnostic:{category:'provider_auth_rejected',providerStatus:403}});await runOperator(o,f.deps)
 assert.ok(f.output.some(s=>s.includes('403')&&s.includes('provider_auth_rejected')))
 const bad=fixture({diagnostic:{category:'private-token',providerStatus:'private-token',endpoint:'private-token'}});await runOperator(o,bad.deps)
 assert.equal(bad.output.join().includes('private-token'),false)
})
test('failed cleanup is explicit; failed preflight never confirms or sends',async()=>{
 const f=fixture({fail:'cancel'});await runOperator(o,f.deps);assert.ok(f.output.some(s=>s.includes('не е потвърдено')))
 const x=fixture();x.deps.edge=async b=>{x.calls.push(b);return {error:'FORBIDDEN'}}
 await assert.rejects(runOperator(o,x.deps),/NOT_READY/);assert.equal(x.calls.length,1)
})

test('only the exact short confirmation sends; cancellation always closes the permit',async()=>{
 for(const answer of ['',true,'send one',' SEND ONE','SEND ONE ','SEND ONE\n','SEND ONE extra',`SEND ONE ${o.user} ${o.device}`]){
  const f=fixture();f.deps.confirm=async()=>answer;await runOperator(o,f.deps)
  assert.deepEqual(f.calls.map(b=>b.operation),['prepare','cancel'])
 }
 const f=fixture();f.deps.confirm=async()=>{throw Error('CANCELLED')}
 await assert.rejects(runOperator(o,f.deps),/CANCELLED/)
 assert.deepEqual(f.calls.map(b=>b.operation),['prepare','cancel'])
})

test('operator prints only allowlisted provider reasons',async()=>{
 for(const reason of ['fcm_invalid_argument','private provider response']){
  const f=fixture({diagnostic:{category:'request_rejected',providerStatus:400,providerReason:reason}})
  await runOperator(o,f.deps)
  const output=f.output.join()
  assert.equal(output.includes(reason),reason==='fcm_invalid_argument')
  assert.ok(output.includes('400'))
 }
})

test('operator prints only allowlisted provider body status',async()=>{
 for(const status of ['empty','unknown_format','incomplete','timeout','private body']){
  const f=fixture({diagnostic:{category:'request_rejected',providerStatus:400,providerBodyStatus:status}})
  await runOperator(o,f.deps)
  assert.equal(f.output.join().includes(status),status!=='private body')
  assert.deepEqual(f.calls.map(b=>b.operation),['prepare','send','cancel'])
 }
})
