import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:https'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,readFileSync,rmSync,mkdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import webpush from 'web-push'
import {sendPinned,connectNode} from '../../supabase/functions/_shared/push-test.mjs'

test('real local TLS simulated provider exercises Node/Deno https IP target, SNI, headers and redirect refusal',async()=>{
 mkdirSync('work',{recursive:true})
 const root=mkdtempSync(join(resolve('work'),'push-tls-'))
 execFileSync('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-days','1','-subj','/CN=fcm.googleapis.com','-addext','subjectAltName=DNS:fcm.googleapis.com'],{stdio:'ignore'})
 const cert=readFileSync(join(root,'cert.pem')),key=readFileSync(join(root,'key.pem'))
 let mode=201,hits=0,pins=0,received
 const server=createServer({key,cert},(req,res)=>{
  hits++;assert.equal(req.url,'/wp/isolated');assert.equal(req.headers.host,'fcm.googleapis.com');assert.equal(req.headers['content-encoding'],'aes128gcm');assert.match(req.headers.authorization,/^vapid /)
  const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{received=Buffer.concat(chunks);res.writeHead(mode,{location:'https://untrusted.example.invalid/'});res.end()})
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const vapid=webpush.generateVAPIDKeys(),subscriber=webpush.generateVAPIDKeys()
 const details=webpush.generateRequestDetails({endpoint:'https://fcm.googleapis.com/wp/isolated',keys:{p256dh:subscriber.publicKey,auth:Buffer.alloc(16,1).toString('base64url')}},'isolated',{contentEncoding:'aes128gcm',vapidDetails:{...vapid,subject:'mailto:test@example.invalid'}})
 const resolver=async()=>[{address:'8.8.8.8',family:4}]
 // Test-only adapter substitutes loopback for the validated IP, preserving verified provider SNI.
 const connector=(target,signal)=>{assert.equal(target.address,'8.8.8.8');assert.equal(target.hostname,'fcm.googleapis.com');pins++;return connectNode({...target,address:'127.0.0.1',port:server.address().port,testCa:cert},signal)}
 try {
  assert.equal((await sendPinned(details,resolver,connector)).status,201)
  assert.deepEqual(received,details.body);assert.equal(pins,1)
  mode=302;assert.equal((await sendPinned(details,resolver,connector)).status,302);assert.equal(hits,2)
  await assert.rejects(sendPinned(details,resolver,(target,signal)=>connectNode({...target,hostname:'wrong.example.invalid',address:'127.0.0.1',port:server.address().port,testCa:cert},signal)))
  assert.equal(hits,2,'A certificate hostname mismatch must fail before any HTTP payload')
 }finally{await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true})}
})
