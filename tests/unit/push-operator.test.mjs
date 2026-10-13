import test from 'node:test'
import assert from 'node:assert/strict'
import {options,runOperator} from '../../scripts/push-operator.mjs'
const id='b0000000-0000-0000-0000-000000000001'
const o=options(['a'.repeat(20),id,id,id,'wind'])
function fixture({approve=true,fail,diagnostic={category:'accepted',providerStatus:201}}={}){
 const sql=[],calls=[],output=[]
 return {sql,calls,output,deps:{
  db:async s=>{sql.push(s);if(s.includes('prepare_'))return id;if(fail==='arm'&&s.includes('arm_'))throw Error('private');if(fail==='cleanup'&&s.includes('close_'))throw Error('private');return 't'},
  edge:async b=>{calls.push(b);if(b.permitId){if(fail==='send')throw Error('private token');return {diagnostic}}return {error:'PUSH_TEST_READY'}},
  confirm:async phrase=>{assert.equal(phrase,`SEND ONE ${o.project} ${o.user} ${o.device}`);return approve},output:s=>output.push(s),
 }}
}
test('strict selection prevents SQL/URL injection and arbitrary recipients',()=>{
 for(const args of [[],['https://evil',id,id,id,'wind'],['a'.repeat(20),id+"';",id,id,'wind'],['a'.repeat(20),id,id,id,'unknown']])assert.throws(()=>options(args))
})
test('cancelled confirmation never arms or sends and revokes the prepared permit',async()=>{
 const f=fixture({approve:false});await runOperator(o,f.deps)
 assert.equal(f.calls.filter(b=>b.permitId).length,0)
 assert.equal(f.sql.some(s=>s.includes('arm_')),false)
 assert.match(f.sql.at(-1),/close_push_operator/)
})
test('single confirmed send, cleanup after accepted/rejected/unknown/DB failures',async()=>{
 for(const fail of [undefined,'send','arm']){
  const f=fixture({fail});if(fail)await assert.rejects(runOperator(o,f.deps));else await runOperator(o,f.deps)
  assert.equal(f.calls.filter(b=>b.permitId).length,fail==='arm'?0:1)
  assert.match(f.sql.at(-1),/close_push_operator/)
 }
 const f=fixture({diagnostic:{category:'provider_auth_rejected',providerStatus:403}});await runOperator(o,f.deps)
 assert.ok(f.output.some(s=>s.includes('provider_auth_rejected')&&s.includes('403')))
})
test('untrusted Edge diagnostics cannot inject secret output',async()=>{
 const f=fixture({diagnostic:{category:'secret-token',providerStatus:'secret-token',endpoint:'secret-token'}})
 await runOperator(o,f.deps);assert.equal(f.output.join().includes('secret-token'),false)
})
test('cleanup failure is explicit, never retried; preflight failure never opens a gate',async()=>{
 const f=fixture({fail:'cleanup'});await assert.rejects(runOperator(o,f.deps),/CLEANUP_UNCONFIRMED/)
 assert.equal(f.sql.filter(s=>s.includes('close_')).length,1)
 const x=fixture();x.deps.edge=async()=>({error:'PUSH_TEST_DISABLED'})
 await assert.rejects(runOperator(o,x.deps),/EDGE_NOT_READY/);assert.equal(x.sql.length,0)
})
