import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseNimh,handleNimh,sofiaDate} from '../../server/nimh-warnings.js'
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
test('unverified, foreign and missing municipalities never inherit district codes',async()=>{
 for(const [id,geo] of [['1',{country_code:'US',admin1:'Област Варна',admin2:'Варна'}],['2',{country_code:'BG',admin1:'Област Варна',admin2:'Несъществуваща'}]]){
 const r=response();await handleNimh({method:'GET',query:{id}},r,async url=>({ok:true,text:async()=>url.includes('geocoding')?JSON.stringify(geo):url.includes('z=d')?html:tomorrow}),Date.parse('2026-11-13T12:40:00Z'))
 assert.ok(r.data.status==='unverified'||r.data.days.every(d=>d.status==='unavailable'))
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
