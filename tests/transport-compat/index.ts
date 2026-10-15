// EXPERIMENT ONLY. No production imports, DB calls, secrets, deployment or real endpoints.
import {request,Agent} from 'node:https'
import WebPushLib from 'npm:web-push@3.6.7/src/web-push-lib.js'
import {Buffer} from 'node:buffer'
const fixture=JSON.parse(Deno.readTextFileSync('/fixtures/request.json'))
fixture.body=Buffer.from(fixture.body,'base64')
const ca=Deno.readTextFileSync('/fixtures/ca.pem')
const selected='127.0.0.1',hostname='push.test.invalid',port=9443
const control='http://127.0.0.1:9080'
const check=(value:unknown,name:string)=>{if(!value)throw Error(name)}
async function ctl(path:string,mode?:string){
 const response=await fetch(control+path,{method:mode===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(3000),...(mode===undefined?{}:{body:JSON.stringify({mode})})})
 check(response.ok,'CONTROL_FAILED');return response.json()
}
const safeError=(error:any)=>String(error?.message).includes('ClientRequest.options.lookup')?'lookup_unsupported':'transport_rejected'
// Standard HTTPS client, library-generated binary request, bounded diagnostics, wall deadline.
async function httpsAttempt(kind:string,endpoint=fixture.endpoint){
 let lookups=0
 const lookup=(_host:unknown,_options:unknown,cb:any)=>{lookups++;cb(null,selected,4)}
 const agent=kind==='agent'?new Agent({ca,keepAlive:false,lookup}):undefined
 let timer:any,req:any
 try{
  const result=await new Promise<any>((resolve,reject)=>{
   timer=setTimeout(()=>{req?.destroy();reject(Error('WALL_TIMEOUT'))},1200)
   const options:any={method:fixture.method,headers:fixture.headers,ca,agent:agent??false}
   if(kind==='lookup')options.lookup=lookup
   if(kind==='numeric'){options.servername=hostname;options.headers={...fixture.headers,Host:`${hostname}:${port}`}}
   req=request(endpoint,options,response=>{
    let size=0,finished=false
    const done=(bodyStatus:string)=>{if(finished)return;finished=true;clearTimeout(bodyTimer);resolve({status:response.statusCode,bodyStatus});response.destroy()}
    const bodyTimer=setTimeout(()=>done('timeout'),300)
    response.on('data',chunk=>{size+=chunk.length;if(size>1024)done('too_large')})
    response.on('end',()=>done(size===0?'empty':'complete'))
    response.on('error',()=>done('read_failed'))
   })
   req.on('error',reject);req.end(fixture.body)
  })
  return {...result,lookups}
 }catch(error){return {error:safeError(error),lookups}}
 finally{clearTimeout(timer);req?.destroy();agent?.destroy()}
}
async function standardAttempt(){
 let lookups=0,timer:any
 const agent=new Agent({ca,keepAlive:false,lookup:(_h:any,_o:any,cb:any)=>{lookups++;cb(null,selected,4)}})
 const sender=new WebPushLib()
 sender.generateRequestDetails=()=>({...fixture,agent,timeout:1200})
 try{
  const response:any=await Promise.race([sender.sendNotification({endpoint:fixture.endpoint}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('WALL_TIMEOUT')),1800)})])
  return {status:response.statusCode,lookups}
 }catch(error){return {error:safeError(error),lookups}}
 finally{clearTimeout(timer);agent.destroy()}
}
// Fetch owns HTTP framing/TLS. No hand-built HTTP or connection injection.
async function fetchAttempt(kind:string,endpoint=fixture.endpoint){
 let client:Deno.HttpClient|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,timer:any
 const abort=new AbortController();let status:number|undefined
 const deadline=setTimeout(()=>abort.abort(),1200)
 try{
  const options:any={caCerts:[ca],http2:false,poolMaxIdlePerHost:0}
  if(kind==='tcp')options.proxy={transport:'tcp',hostname:selected,port}
  if(kind==='numeric')options.allowHost=true
  // Candidate lookup option is deliberately probed: silently ignored options are failures.
  let lookups=0
  if(kind==='lookup')options.lookup=()=>{lookups++;return selected}
  client=Deno.createHttpClient(options)
  const headers=new Headers(Object.entries(fixture.headers).map(([k,v])=>[k,String(v)]))
  if(kind==='numeric')headers.set('Host',`${hostname}:${port}`)
  const response=await fetch(endpoint,{method:fixture.method,headers,body:fixture.body,client,redirect:'manual',signal:abort.signal})
  status=response.status
  // manual returns the first 3xx for safe status diagnostics; it never follows Location.
  if(status>=300&&status<400){void response.body?.cancel();return {status,bodyStatus:'redirect_refused',lookups}}
  reader=response.body?.getReader()
  let total=0
  const read=async()=>{
   if(!reader)return 'empty'
   while(true){const item=await reader.read();if(item.done)return total===0?'empty':'complete';total+=item.value.length;if(total>1024)return 'too_large'}
  }
  const bodyStatus=await Promise.race([read(),new Promise<string>(resolve=>{timer=setTimeout(()=>resolve('timeout'),300)})])
  return {status,bodyStatus,lookups}
 }catch(error){return {error:abort.signal.aborted?'timeout':safeError(error),...(status===undefined?{}:{status})}}
 finally{clearTimeout(deadline);clearTimeout(timer);abort.abort();void reader?.cancel().catch(()=>{});client?.close()}
}
async function run(){
 const observations:any[]=[]
 const sample=async(name:string,attempt:()=>Promise<any>,mode='accepted')=>{
  await ctl('/reset',mode)
  const start=performance.now(),result=await attempt(),elapsedMs=Math.round(performance.now()-start)
  const observed=await ctl('/snapshot')
  const row={name,mode,result,elapsedMs,observed};observations.push(row);return row
 }
 const candidates:[string,()=>Promise<any>][]=[
  ['node_https_lookup',()=>httpsAttempt('lookup')],
  ['node_https_agent',()=>httpsAttempt('agent')],
  ['web_push_sendNotification',standardAttempt],
  ['node_https_numeric_sni',()=>httpsAttempt('numeric',`https://${selected}:${port}/wp/synthetic`)],
  ['fetch_hostname_control',()=>fetchAttempt('hostname')],
  ['fetch_lookup_option',()=>fetchAttempt('lookup')],
  ['fetch_numeric_host',()=>fetchAttempt('numeric',`https://${selected}:${port}/wp/synthetic`)],
  ['fetch_tcp_transport',()=>fetchAttempt('tcp')],
 ]
 const pinned:any[]=[]
 for(const [name,attempt] of candidates){
  const row=await sample(name,attempt)
  if(row.result.status===201 && row.observed.selected===1 && row.observed.decoy===0 && row.observed.wireMatches && row.observed.sniMatches)pinned.push(name)
 }
 // Independent properties of the usable standard fetch path. DNS intentionally points at decoy.
 const accepted=observations.find(r=>r.name==='fetch_hostname_control')
 check(accepted.result.status===201 && accepted.observed.decoy===1 && accepted.observed.wireMatches && accepted.observed.sniMatches,'FETCH_POSITIVE_CONTROL_FAILED')
 const wrong=await sample('fetch_wrong_tls_name',()=>fetchAttempt('hostname','https://wrong.test.invalid:9443/wp/synthetic'))
 check(wrong.result.error && wrong.observed.decoy===0,'WRONG_CERTIFICATE_NOT_REJECTED')
 const redirect=await sample('fetch_redirect',()=>fetchAttempt('hostname'),'redirect')
 check(redirect.result.status===307 && redirect.observed.decoy===1 && redirect.observed.redirectConnections===0,'REDIRECT_FOLLOWED')
 const large=await sample('fetch_body_limit',()=>fetchAttempt('hostname'),'large')
 check(large.result.status===400 && large.result.bodyStatus==='too_large' && large.observed.decoy===1,'BODY_LIMIT_FAILED')
 const bodyHang=await sample('fetch_body_deadline',()=>fetchAttempt('hostname'),'body-hang')
 check(bodyHang.result.status===400 && bodyHang.result.bodyStatus==='timeout' && bodyHang.elapsedMs<2000,'BODY_DEADLINE_FAILED')
 const hang=await sample('fetch_wall_deadline',()=>fetchAttempt('hostname'),'hang')
 check(hang.result.error==='timeout' && hang.elapsedMs<2500 && hang.observed.decoy===1,'WALL_DEADLINE_FAILED')
 const rejection=await sample('fetch_http_400',()=>fetchAttempt('hostname'),'rejected')
 check(rejection.result.status===400 && rejection.result.bodyStatus==='complete' && rejection.observed.decoy===1,'HTTP_REJECTION_FAILED')
 // A newly supported pinning primitive needs its own full adversarial suite before integration.
 return {runtime:Deno.version,library:'web-push@3.6.7',observations,pinnedCandidates:pinned,decision:pinned.length?'further_validation_required':'no_safe_standard_transport',productionIntegration:false}
}
let running=false
Deno.serve(async()=>{
 if(running)return Response.json({error:'ALREADY_RUN'},{status:409})
 running=true
 try{return Response.json(await run())}
 catch{return Response.json({error:'HARNESS_ASSERTION_FAILED'},{status:500})}
})
