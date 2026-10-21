import test from 'node:test'
import assert from 'node:assert/strict'
import {createStartupLifecycle,installStartupLifecycle} from './startup-lifecycle.js'
const memory=()=>{let value;return {getItem:()=>value,setItem:(_key,next)=>{value=next}}}
test('disabled diagnostics never touch storage/listeners or retain payloads',()=>{
 const scope=new Proxy({}, {get(){assert.fail('disabled installation accessed browser')}})
 const d=installStartupLifecycle(scope,false)
 d.record('app:view',{latitude:43,token:'private'});assert.equal(d.instance(),0)
 assert.deepEqual(d.snapshot(),{document:0,events:[]})
})
test('reload is a new document; StrictMode rehearsal and remount have distinct instance signatures',()=>{
 const storage=memory(),d=createStartupLifecycle(true,{storage,now:()=>123.456})
 d.record('document:start',{navigation:'navigate'})
 const first=d.instance();d.record('app:setup',{instance:first});d.record('app:cleanup',{instance:first});d.record('app:setup',{instance:first})
 const remount=d.instance();d.record('app:setup',{instance:remount})
 const next=createStartupLifecycle(true,{storage,now:()=>1});next.record('document:start',{navigation:'reload'})
 assert.equal(next.snapshot().document,2)
 assert.deepEqual(d.snapshot().events.filter(e=>e.event==='app:setup').map(e=>e.instance),[1,1,2])
 assert.deepEqual(next.snapshot().events.filter(e=>e.event==='document:start').map(e=>e.document),[1,2])
})
test('journal is bounded, copied and drops arbitrary fields and invalid values',()=>{
 const storage=memory(),d=createStartupLifecycle(true,{storage,now:()=>10})
 for(let i=0;i<250;i++)d.record('app:view',{instance:1,view:'forecast',ready:true,latitude:43,url:'private',token:'private',source:'private-city'})
 d.record('private-token');d.record('app:view',{instance:-1,view:'private-city'})
 const snapshot=d.snapshot();assert.equal(snapshot.events.length,200)
 assert.doesNotMatch(JSON.stringify(snapshot),/private|latitude|token|url|source/)
 snapshot.events[0].event='tampered';assert.equal(d.snapshot().events[0].event,'app:view')
 storage.setItem('',JSON.stringify({document:2,events:[{event:'private',document:1,ms:0},{event:'app:setup',document:1,ms:0,token:'private'}]}))
 const fresh=createStartupLifecycle(true,{storage});assert.equal(fresh.snapshot().events.length,1);assert.doesNotMatch(JSON.stringify(fresh.snapshot()),/private/)
})
test('blocked or malformed storage never interrupts diagnostics',()=>{
 for(const storage of [{getItem(){throw Error()},setItem(){throw Error()}},{getItem:()=>'{',setItem(){}}]){
  const d=createStartupLifecycle(true,{storage});assert.doesNotThrow(()=>d.record('root:create'));assert.equal(d.snapshot().events.length,1)
 }
})
test('module reevaluation in one Window does not masquerade as a new document',()=>{
 const listeners=[],scope={sessionStorage:memory(),performance:{getEntriesByType:()=>[{type:'reload'}]},document:{addEventListener:(...args)=>listeners.push(args)},navigator:{},addEventListener:(...args)=>listeners.push(args)}
 const first=installStartupLifecycle(scope,true),count=listeners.length
 const again=installStartupLifecycle(scope,true)
 assert.equal(first,again);assert.equal(listeners.length,count)
 assert.equal(first.snapshot().document,1)
 assert.equal(first.snapshot().events.filter(e=>e.event==='document:start').length,1)
 assert.equal(first.snapshot().events.filter(e=>e.event==='module:evaluate').length,2)
})
test('a BFCache-restored document appends without losing newer document evidence',()=>{
 const storage=memory(),old=createStartupLifecycle(true,{storage,now:()=>1})
 old.record('document:start',{navigation:'navigate'})
 const next=createStartupLifecycle(true,{storage,now:()=>2});next.record('document:start',{navigation:'navigate'})
 old.record('document:pageshow',{persisted:true})
 assert.equal(old.snapshot().document,1)
 assert.deepEqual(old.snapshot().events.map(e=>e.document),[1,2,1])
 const reloaded=createStartupLifecycle(true,{storage,now:()=>3});reloaded.record('document:start',{navigation:'reload'})
 assert.equal(reloaded.snapshot().document,3)
 assert.deepEqual(reloaded.snapshot().events.filter(e=>e.event==='document:start').map(e=>e.document),[1,2,3])
})
