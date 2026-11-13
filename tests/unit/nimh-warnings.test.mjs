import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseNimh,handleNimh,sofiaDate,createNimhGuard} from '../../server/nimh-warnings.js'
const html=readFileSync(new URL('../fixtures/nimh/varna-2026-11-13.html',import.meta.url),'utf8')
const tomorrow=readFileSync(new URL('../fixtures/nimh/varna-2026-11-14.html',import.meta.url),'utf8')
test('real NIMH Varna tables distinguish municipality, district and marine scopes',()=>{
 const d=parseNimh(html,'VAR','2026-11-13')
 assert.equal(d.municipalities.Варна[0].level,'yellow')
 assert.equal(d.municipalities.Аврен[0].level,'orange')
 assert.deepEqual(d.warnings.map(w=>[w.scope,w.level]),[['district','orange'],['marine','orange']])
 assert.deepEqual(d.warnings[0].hazards,['wind'])
 assert.match(d.warnings[1].description,/Вълнение на морето 4 бала/)
 assert.deepEqual(parseNimh(tomorrow,'VAR','2026-11-14').municipalities.Варна,[])
})
test('unknown colours, missing data, stale dates and changed column order fail closed',()=>{
 for(const s of [html.replaceAll('#ffff00','#abcdef'),html.replaceAll('13.11.2026','12.11.2026'),html.replaceAll('13.11.2026','31.02.2026'),html.replace("id='myTable'","id='changed'"),html.replace('Вятър<br/>','Дъжд<br/>')])assert.throws(()=>parseNimh(s,'VAR','2026-11-13'))
 assert.throws(()=>parseNimh(html.replaceAll('прогноза за: 13.11.2026','прогноза за: 12.11.2026'),'VAR','2026-11-13'))
 assert.equal(parseNimh(html.replaceAll('#ffff00','#ff0000'),'VAR','2026-11-13').municipalities.Варна[0].level,'red')
})
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(data){this.data=data;return this}})
test('endpoint uses verified admin2, two shared region fetches, bounded cache and separate partial failures',async()=>{
 const calls=[];const now=Date.parse('2026-11-13T12:00:00Z')
 const fetcher=async url=>{calls.push(url);return {ok:true,text:async()=>url.includes('geocoding')?JSON.stringify({id:726050,country_code:'BG',admin1:'Област Варна',admin2:'Варна'}):url.includes('z=d')?html:tomorrow}}
 const a=response(),b=response()
 await Promise.all([handleNimh({method:'GET',query:{id:'726050'}},a,fetcher,now),handleNimh({method:'GET',query:{id:'726050'}},b,fetcher,now)])
 assert.equal(calls.length,3);assert.equal(a.data.days[0].warnings[0].level,'yellow');assert.equal(a.data.days[1].status,'verified')
 assert.match(a.headers['Cache-Control'],/s-maxage=300/)
 const c=response();await handleNimh({method:'GET',query:{id:'726050'}},c,async()=>{throw Error('offline')},now+16*60000)
 assert.ok(c.data.days.every(d=>d.status==='unavailable'&&d.warnings.length===0))
})
test('foreign places are unverified; missing municipalities receive district scope only',async()=>{
 for(const [id,geo] of [['1',{country_code:'US',admin1:'Област Варна',admin2:'Варна'}],['2',{country_code:'BG',admin1:'Област Варна',admin2:'Несъществуваща'}]]){
 const r=response();await handleNimh({method:'GET',query:{id}},r,async url=>({ok:true,text:async()=>url.includes('geocoding')?JSON.stringify(geo):url.includes('z=d')?html:tomorrow}),Date.parse('2026-11-13T12:40:00Z'))
 assert.ok(r.data.status==='unverified'||r.data.coverage==='district'&&r.data.days.every(d=>d.warnings.every(w=>w.scope!=='municipality')))
 }
 const r=response();await handleNimh({method:'GET',query:{id:'https://evil.invalid'}},r);assert.equal(r.code,400)
})
test('Sofia calendar dates follow midnight and DST',()=>{
 assert.equal(sofiaDate(Date.parse('2026-11-13T22:01:00Z')),'2026-11-14')
 assert.equal(sofiaDate(Date.parse('2026-07-13T21:01:00Z')),'2026-07-14')
})
test('Bulgarian municipality prefixes and Sofia capital/province resolve independently',async()=>{
 const now=Date.parse('2026-11-13T14:00:00Z')
 for(const [id,admin1,admin2,admin2_id,municipality,region] of [['3','Област Бургас','Община Варна',726048,'Варна','BGS'],['4','Област София град','Stolichna Obshtina',6458974,'Столична','SOF'],['5','Софийска област','Община Варна',726048,'Варна','SFO']]) {
  const calls=[],r=response()
  await handleNimh({method:'GET',query:{id}},r,async url=>{
   calls.push(url)
   return {ok:true,text:async()=>url.includes('geocoding')?JSON.stringify({id:Number(id),country_code:'BG',admin1,admin2,admin2_id}):(url.includes('z=d')?html:tomorrow).replaceAll('Варна',municipality)}
  },now)
  assert.equal(r.data.municipality,municipality)
  assert.equal(r.data.days[0].status,'verified')
  assert.ok(calls.some(url=>url.includes(`o=${region}`)))
 }
})
test('public dispatch validates its own query while personal alerts remain private',async()=>{
 const {default:handler}=await import('../../api/alerts.ts')
 const invalid=response();await handler({method:'GET',query:{source:'nimh',id:'bad'}},invalid);assert.equal(invalid.code,400)
 const mutation=response();await handler({method:'PATCH',query:{source:'nimh',id:'726050'}},mutation);assert.equal(mutation.code,405)
 const personal=response();await handler({method:'GET',query:{},headers:{}},personal);assert.ok([401,503].includes(personal.code));assert.equal(personal.headers['Cache-Control'],'private, no-store')
})

test('GPS region queries use NIMH directly, with optional exact municipality row',async()=>{
 for(const municipality of [undefined,'Варна','Непроверена']) {
  const r=response(),calls=[]
  await handleNimh({method:'GET',query:{region:'VAR',...(municipality?{municipality}:{})}},r,async url=>{calls.push(url);return {ok:true,text:async()=>url.includes('z=d')?html:tomorrow}},Date.parse('2026-11-13T16:00:00Z'))
  assert.equal(r.code,200)
  assert.ok(calls.every(url=>url.startsWith('https://weather.bg/')))
  assert.equal(r.data.coverage,municipality==='Варна'?'municipality':'district')
  assert.equal(r.data.days[0].warnings.some(w=>w.scope==='municipality'),municipality==='Варна')
  if(municipality!=='Варна')assert.ok(r.data.days.every(d=>d.warnings.every(w=>w.scope==='district')))
 }
})
test('bounded request and source budgets reset; public endpoint rejects excess requests before upstream I/O',async()=>{
 const guard=createNimhGuard()
 for(let i=0;i<30;i++)assert.equal(guard.allow('request',0,'one'),true)
 assert.equal(guard.allow('request',0,'one'),false)
 for(let i=0;i<40;i++)assert.equal(guard.allow('source',0),true)
 assert.equal(guard.allow('source',0),false)
 assert.equal(guard.allow('request',60000,'one'),true)
 let last
 for(let i=0;i<31;i++) {last=response();await handleNimh({method:'GET',headers:{'x-vercel-forwarded-for':'192.0.2.50'},query:{id:'bad'}},last,()=>{throw Error('must not fetch')},Date.parse('2026-11-13T18:00:00Z'))}
 assert.equal(last.code,429);assert.equal(last.headers['Retry-After'],'60');assert.equal(last.headers['Cache-Control'],'no-store')
})

test('random ID fan-out cannot exceed the shared outbound budget',async()=>{
 let calls=0,last
 for(let i=0;i<45;i++){
  last=response()
  await handleNimh({method:'GET',headers:{'x-vercel-forwarded-for':`192.0.2.${i}`},query:{id:String(100000+i)}},last,async()=>{calls++;return {ok:true,text:async()=>JSON.stringify({country_code:'US'})}},Date.parse('2026-11-13T19:00:00Z'))
 }
 assert.equal(calls,40);assert.equal(last.code,503)
})
