// Disposable synthetic fixture. Never deploy or supply real subscriptions to this service.
import {createServer as httpsServer, Agent} from 'node:https'
import {createServer} from 'node:http'
import {readFileSync} from 'node:fs'
import {timingSafeEqual} from 'node:crypto'
import WebPushLib from 'web-push/src/web-push-lib.js'

const details=JSON.parse(readFileSync('/fixtures/request.json','utf8'))
details.body=Buffer.from(details.body,'base64')
const ca=readFileSync('/fixtures/ca.pem')
const tls={key:readFileSync('/fixtures/key.pem'),cert:readFileSync('/fixtures/cert.pem')}
let mode='accepted',observed
function reset(){observed={selected:0,decoy:0,redirect:0,selectedConnections:0,decoyConnections:0,redirectConnections:0,wireMatches:true,sniMatches:true}}
reset()
const active=new Set()
for(const [label,ip] of [['selected','127.0.0.1'],['decoy','127.0.0.2'],['redirect','127.0.0.3']]){
 const server=httpsServer(tls,(req,res)=>{
  observed[label]++
  const record=observed,scenario=mode,chunks=[]
  req.on('data',c=>chunks.push(c))
  req.on('end',()=>{
   const body=Buffer.concat(chunks)
   const expected=Object.fromEntries(Object.entries(details.headers).map(([k,v])=>[k.toLowerCase(),String(v)]))
   const headersMatch=Object.entries(expected).every(([k,v])=>req.headers[k]===v)
   const lengthHeaders=req.rawHeaders.filter((_,i)=>i%2===0).filter(k=>k.toLowerCase()==='content-length').length
   record.wireMatches&&=req.method===details.method && req.url==='/wp/synthetic' && req.headers.host==='push.test.invalid:9443' && headersMatch && lengthHeaders===1 && !req.headers['transfer-encoding'] && body.length===details.body.length && timingSafeEqual(body,details.body)
   record.sniMatches&&=req.socket.servername==='push.test.invalid'
   if(scenario==='hang')return
   if(scenario==='redirect'){
    res.writeHead(307,{location:'https://redirect.test.invalid:9443/wp/synthetic'});res.end();return
   }
   if(scenario==='large'){
    res.writeHead(400,{'content-type':'text/plain','content-length':65536});res.end(Buffer.alloc(65536,65));return
   }
   if(scenario==='body-hang'){
    res.writeHead(400,{'content-type':'text/plain','content-length':100});res.flushHeaders();res.write('S');return
   }
   const text=scenario==='rejected'?'SYNTHETIC_REJECTION':''
   res.writeHead(scenario==='rejected'?400:201,{'content-type':'text/plain','content-length':Buffer.byteLength(text)});res.end(text)
  })
 })
 server.on('connection',socket=>{observed[label+'Connections']++;active.add(socket);socket.once('close',()=>active.delete(socket))})
 server.on('tlsClientError',()=>{}) // No raw TLS errors in output.
 await new Promise(resolve=>server.listen(9443,ip,resolve))
}
// Reference: the actual web-push sender in Node, replaying ONE generated request.
// No re-encryption: random salt/ephemeral key would otherwise invalidate byte comparison.
async function baseline(){
 reset();mode='accepted'
 let lookups=0
 const agent=new Agent({ca,keepAlive:false,lookup:(_hostname,options,cb)=>{lookups++;options?.all?cb(null,[{address:'127.0.0.1',family:4}]):cb(null,'127.0.0.1',4)}})
 const sender=new WebPushLib()
 sender.generateRequestDetails=()=>({...details,agent,timeout:1500})
 try{
  const result=await sender.sendNotification({endpoint:details.endpoint})
  return {status:result.statusCode,lookups,...observed}
 }finally{agent.destroy()}
}
const control=createServer(async(req,res)=>{
 try{
  let result
  if(req.method==='POST' && req.url==='/reset'){
   const chunks=[];for await(const c of req)chunks.push(c)
   const input=JSON.parse(Buffer.concat(chunks).toString())
   if(!['accepted','rejected','redirect','large','hang','body-hang'].includes(input.mode))throw Error('INVALID_MODE')
   for(const socket of active)socket.destroy()
   mode=input.mode;reset();result={ready:true}
  }else if(req.url==='/snapshot')result=observed
  else if(req.method==='POST' && req.url==='/baseline')result=await baseline()
  else {res.writeHead(404);res.end();return}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result))
 }catch{res.writeHead(500);res.end('{"error":"FIXTURE_FAILED"}')}
})
await new Promise(resolve=>control.listen(9080,'127.0.0.1',resolve))
console.log('synthetic-provider-ready')
