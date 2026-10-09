import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync,statSync,rmSync,mkdirSync,mkdtempSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {validVapid} from '../../supabase/functions/_shared/push-test.mjs'
test('explicit isolated VAPID generator keeps private keys out of stdout, refuses overwrite and non-work destinations',()=>{
 mkdirSync('work',{recursive:true});const root=mkdtempSync(resolve('work/vapid-generator-')),target=join(root,'isolated.json')
 try{
  const output=execFileSync(process.execPath,['scripts/generate-vapid.mjs',target],{encoding:'utf8'})
  const pair=JSON.parse(readFileSync(target,'utf8'))
  assert.equal(validVapid(pair.publicKey,pair.privateKey,'mailto:test@example.invalid'),true)
  assert.equal(output.includes(pair.privateKey),false);assert.equal(output.includes(pair.publicKey),false)
  assert.equal(statSync(target).mode & 0o777,0o600)
  assert.throws(()=>execFileSync(process.execPath,['scripts/generate-vapid.mjs',target],{stdio:'ignore'}))
  assert.throws(()=>execFileSync(process.execPath,['scripts/generate-vapid.mjs','output/not-allowed.json'],{stdio:'ignore'}))
 }finally{rmSync(root,{recursive:true,force:true})}
})
