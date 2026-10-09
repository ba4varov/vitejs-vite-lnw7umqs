import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const exec=promisify(execFile)

test('Preview verifier accepts matching served bytes and rejects stale assets and redirects',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-assets-test-'))
 const html='<script src="/assets/app.js"></script><link href="/assets/app.css" rel="stylesheet">'
 const assets={'/':html,'/assets/app.js':'const classes="profile-dialog profile-tabs"','/assets/app.css':'.profile-dialog{width:960px}.profile-tabs{display:flex}'}
 await mkdir(join(root,'assets'))
 await writeFile(join(root,'index.html'),html)
 for(const [path,body] of Object.entries(assets))if(path!=='/')await writeFile(join(root,path.slice(1)),body)
 let mode='current'
 const server=createServer((request,response)=>{
  if(mode==='redirect'){response.writeHead(302,{location:'https://production.example.invalid/'});response.end();return}
  response.end(mode==='stale'&&request.url==='/assets/app.js'?'const classes="auth-dialog"':assets[request.url]||'')
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const address=server.address(),report=join(root,'comparison.json')
 const run=async()=>{
  let code=0
  try{await exec(process.execPath,[resolve('scripts/verify-profile-preview.mjs'),`http://127.0.0.1:${address.port}/`,root,report])}catch(error){code=error.code}
  return {code,...JSON.parse(await readFile(report,'utf8'))}
 }
 try{
  assert.equal((await run()).hostedVerified,true)
  mode='stale';const stale=await run();assert.equal(stale.code,1);assert.equal(stale.hostedVerified,false)
  assert.ok(stale.errors.some(error=>error.includes('Asset bytes differ')))
  assert.ok(stale.errors.some(error=>error.includes('selectors missing')))
  mode='redirect';const redirect=await run();assert.equal(redirect.hostedVerified,false)
  assert.ok(redirect.errors.some(error=>error.includes('HTTP 302')))
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})}
})
