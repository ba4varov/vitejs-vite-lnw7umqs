import {test} from 'node:test'
import assert from 'node:assert/strict'
import {startupReport} from './startup-report.js'
const entry={event:'app:view',document:1,ms:10,view:'forecast',ready:true}
const journal=()=>({document:1,events:[{...entry}]})
test('exports only existing safe snapshots',()=>{
 const input=journal(),timing=[{phase:'module',ms:0.1}]
 assert.deepEqual(JSON.parse(startupReport(input,timing)),{lifecycle:input,timing})
 assert.deepEqual(input,journal())
})
for(const field of ['latitude','longitude','id','email','token','subscription','secret','city','url'])test(`blocks unexpected ${field}`,()=>{
 const input=journal();input.events[0][field]='private'
 assert.throws(()=>startupReport(input,[]))
})
test('blocks private strings in allowed fields and invalid timing',()=>{
 for(const value of ['a@example.com','secret-token','43.2256,27.8888']){
  const input=journal();input.events[0].view=value
  assert.throws(()=>startupReport(input,[]))
  assert.throws(()=>startupReport(journal(),[{phase:value,ms:1}]))
 }
 assert.throws(()=>startupReport(journal(),[{phase:'module',ms:1,token:'secret'}]))
 assert.throws(()=>startupReport({...journal(),email:'private'},[]))
 assert.throws(()=>startupReport(journal(),[{phase:'module',ms:Infinity}]))
})
