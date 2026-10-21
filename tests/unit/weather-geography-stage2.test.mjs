import test from 'node:test'
import assert from 'node:assert/strict'
import { geminiClient } from '../../server/gemini-client.js'
import { invoke, forecast } from '../helpers/weather-chat-harness.mjs'
import { semanticFixture } from '../helpers/bobi-language-corpus.mjs'
import { geminiResponse } from '../helpers/bobi-regression.mjs'

const places = {
 bg: [{name:'София',latitude:42.7,longitude:23.3}, {name:'Варна',latitude:43.21,longitude:27.91}, {name:'Баня',latitude:42.5,longitude:24.8,admin1:'Пловдив',country:'България',population:100000}, {name:'Баня',latitude:41.8,longitude:23.5,admin1:'Благоевград',country:'България',population:100}],
 en: [{name:'Sofia',latitude:42.7,longitude:23.3}, {name:'Varna',latitude:43.21,longitude:27.91}, {name:'Springfield',latitude:39.78,longitude:-89.65,admin1:'Illinois',country:'United States',population:100000}, {name:'Springfield',latitude:44.05,longitude:-123.02,admin1:'Oregon',country:'United States',population:100}]
}
let sequence=0
function install(t, lang, city, source='explicit', fallback=false) {
 const old=process.env.GEMINI_API_KEY
 if(fallback)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY='offline-geography'
 t.after(()=>{if(old===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=old})
 t.mock.method(console,'info',()=>{})
 t.mock.method(geminiClient,'generate',async()=>geminiResponse(semanticFixture({intent:'rain',requestedCity:source==='explicit'?city:null,citySource:source,turnType:source==='context'?'follow_up':'new_question',timeScope:'tomorrow',timeSource:'explicit'})))
 return (message,extra={})=>invoke(t,message,lang,extra,forecast,new Date(Date.parse('2026-10-08T09:00:00Z')+sequence++*60000).toISOString(),places[lang])
}
function coordinates(result,place){
 assert.equal(result.body.needsClarification,false,JSON.stringify(result.body))
 assert.equal(result.body.targetDate,'2026-10-09')
 assert.equal(result.body.context.latitude,place.latitude);assert.equal(result.body.context.longitude,place.longitude)
 const calls=result.calls.filter(url=>!url.hostname.startsWith('geocoding-'));assert.ok(calls.length>=1)
 for(const url of calls){assert.equal(Number(url.searchParams.get('latitude')),place.latitude);assert.equal(Number(url.searchParams.get('longitude')),place.longitude)}
}
function clarifies(result){assert.equal(result.body.needsClarification,true);assert.equal(result.body.pendingClarification?.missing,'location');assert.ok(result.calls.every(url=>url.hostname.startsWith('geocoding-')))}
for(const lang of ['bg','en']) {
 const bg=lang==='bg', [origin,destination,large,small]=places[lang]
 const context={city:origin.name,latitude:origin.latitude,longitude:origin.longitude,intent:'rain',timeScope:'tomorrow',targetDate:'2026-10-09',previousQuestion:'Synthetic'}
 for(const mode of ['destination','wrong-origin','context','fallback'])test(`route roles ${lang}/${mode}`,async t=>{
  const run=install(t,lang,mode==='wrong-origin'?origin.name:destination.name,mode==='context'?'context':'explicit',mode==='fallback')
  const result=await run(bg?'Пътувам от София до Варна утре ще вали ли?':'I am travelling from Sofia to Varna tomorrow will it rain?',{context})
  coordinates(result,destination)
 })
 for(const text of [bg?'Ще вали ли утре в софия или варна?':'Will it rain tomorrow in sofia or varna?',bg?'Ще вали ли утре в София или Варна?':'Will it rain tomorrow in Sofia or Varna?',bg?'Сравни София и Варна утре ще вали ли?':'Compare Sofia and Varna tomorrow will it rain?'])test(`comparison never accepts single AI choice ${lang}/${text}`,async t=>{clarifies(await install(t,lang,destination.name)(text))})
 test(`same-name population is never identity ${lang}`,async t=>{clarifies(await install(t,lang,large.name)(bg?'Ще вали ли утре в Баня?':'Will it rain tomorrow in Springfield?'))})
 for(const aiQualified of [true,false])test(`raw region beats population and bare AI ${lang}/${aiQualified}`,async t=>{
  const city=`${small.name}, ${small.admin1}`
  coordinates(await install(t,lang,aiQualified?city:small.name)(bg?`Ще вали ли утре в ${small.name}, област ${small.admin1}?`:`Will it rain tomorrow in ${city}?`),small)
 })
 for(const comma of [true,false])test(`region without AI ${lang}/${comma}`,async t=>{
  const text=bg?`Ще вали ли утре в ${small.name}${comma?',':''} област ${small.admin1}?`:`Will it rain tomorrow in ${small.name}${comma?',':''} state ${small.admin1}?`
  coordinates(await install(t,lang,null,'explicit',true)(text),small)
 })
 test(`selected same-name coordinates do not short circuit geocoding ${lang}`,async t=>{
  const result=await install(t,lang,large.name)(bg?'Ще вали ли утре в Баня?':'Will it rain tomorrow in Springfield?',{city:large.name,latitude:small.latitude,longitude:small.longitude})
  clarifies(result);assert.ok(result.calls.some(url=>url.hostname.startsWith('geocoding-')))
 })
 test(`confirmed same-name context stays at verified coordinates ${lang}`,async t=>{
  const run=install(t,lang,small.name)
  const confirmed={...context,city:small.name,latitude:small.latitude,longitude:small.longitude}
  coordinates(await run(bg?'Ще вали ли утре в Баня?':'Will it rain tomorrow in Springfield?',{context:confirmed}),small)
 })
 test(`changed city invalidates saved coordinates, followup retains new ones ${lang}`,async t=>{
  const run=install(t,lang,destination.name)
  const changed=await run(bg?'Ще вали ли утре в Варна?':'Will it rain tomorrow in Varna?',{context})
  coordinates(changed,destination)
  // No new explicit place: the confirmed conversation location is authoritative.
  delete process.env.GEMINI_API_KEY
  coordinates(await run(bg?'А утре?':'And tomorrow?',{context:changed.body.context}),destination)
 })
 test(`lowercase comma-only list cannot inherit a selected city ${lang}`,async t=>{
  clarifies(await install(t,lang,origin.name)(bg?'Ще вали ли утре в софия, варна, баня, бургас?':'Will it rain tomorrow in sofia, varna, springfield, boston?',{context}))
 })
 test(`fourth place cannot disappear at candidate budget ${lang}`,async t=>{
  clarifies(await install(t,lang,origin.name)(bg?'Ще вали ли утре в София, Варна, Баня или Бургас?':'Will it rain tomorrow in Sofia, Varna, Springfield or Boston?',{context}))
 })
}
