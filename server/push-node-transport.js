// Server-only native Node HTTPS transport. No redirect, retry, family racing or fallback.
import {request,Agent} from 'node:https'
import {lookup} from 'node:dns/promises'
import ipaddr from 'ipaddr.js'
import {providerPhraseReason} from '../supabase/functions/_shared/push-provider.mjs'

export function isFcmEndpoint(value){
 if(typeof value!=='string'||value.length>2048)return false
 try{
  const u=new URL(value)
  return u.href===value&&u.protocol==='https:'&&u.hostname==='fcm.googleapis.com'&&!u.port&&!u.username&&!u.password&&!u.hash&&!u.search&&/^\/(?:wp|fcm\/send)\/[A-Za-z0-9_:-]+$/.test(u.pathname)
 }catch{return false}
}
export function isPublicAddress(address,family){
 try{
  const ip=ipaddr.parse(address)
  return (ip.kind()==='ipv4'?family===4:family===6)&&ip.range()==='unicast'&&(family===4||ip.match(ipaddr.parse('2000::'),3))
 }catch{return false}
}
const transportError=code=>Object.assign(Error('PUSH_TRANSPORT_UNCERTAIN'),{diagnosticCode:code})
const badText=value=>['\r','\n','\0'].some(c=>String(value).includes(c))

// Only allowlisted reasons escape this bounded (<=1024 bytes) parser.
function classifyBody(bytes,contentType){
 if(!bytes.length)return {providerBodyStatus:'empty'}
 const text=bytes.toString('utf8').trim(),type=typeof contentType==='string'?contentType.split(';')[0].trim().toLowerCase():''
 let reason
 if(type==='text/plain'){
  reason=providerPhraseReason(text)
  if(text==='the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions.')reason='fcm_vapid_subscription_mismatch'
 }else if(type==='application/json'){
  try{
   const error=JSON.parse(text)?.error
   const detail=Array.isArray(error?.details)?error.details.find(d=>d?.['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError'):undefined
   reason=providerPhraseReason(detail?.errorCode)||providerPhraseReason(error?.status)
  }catch{/* Raw JSON, messages and field violations are never returned. */}
 }else if(type==='text/html'){
  const html=/^<html>\s*<head>\s*<title>\s*([A-Za-z]+)\s*<\/title>\s*<\/head>\s*<body(?:\s+[^<>]*)?>\s*<h1>\s*([A-Za-z]+)\s*<\/h1>\s*<h2>\s*Error [45][0-9]{2}\s*<\/h2>\s*(?:<!--[\s\S]*?-->\s*)*<\/body>\s*<\/html>$/i.exec(text)
  if(html&&html[1]===html[2])reason=providerPhraseReason(html[1])
 }
 return reason?{providerBodyStatus:'recognized',providerReason:reason}:{providerBodyStatus:'unknown_format'}
}
// Options are trusted construction-time dependencies for local fixtures, never request data.
export function createNodeTransport({validEndpoint=isFcmEndpoint,allowedAddress=isPublicAddress,ca,port=443,deadlineMs=8000,bodyDeadlineMs=300}={}){
 return async function prepare(details,resolver=lookup,signal){
  if(signal?.aborted)throw transportError('transport_failed')
  // Snapshot before awaiting DNS: mutations must not swap the endpoint/body after validation.
  if(!details||!validEndpoint(details.endpoint)||details.method!=='POST'||!Buffer.isBuffer(details.body)||details.body.length>2048)throw Error('INVALID_PUSH_REQUEST')
  if(Object.keys(details).some(k=>!['endpoint','method','body','headers'].includes(k)))throw Error('UNSUPPORTED_PUSH_OPTIONS')
  const endpoint=new URL(details.endpoint),body=Buffer.from(details.body),headers={}
  const seen=new Set();let size=0
  for(const [name,input] of Object.entries(details.headers??{})){
   const key=name.toLowerCase(),value=String(input)
   if(!/^[A-Za-z0-9-]{1,64}$/.test(name)||badText(value)||value.length>2048||seen.has(key))throw Error('INVALID_PUSH_HEADERS')
   if(!['authorization','content-type','content-encoding','content-length','ttl','urgency'].includes(key))throw Error('INVALID_PUSH_HEADERS')
   seen.add(key);headers[name]=value;size+=name.length+value.length+4
  }
  if(size>4096||seen.size!==6)throw Error('INVALID_PUSH_HEADERS')
  const get=name=>Object.entries(headers).find(([k])=>k.toLowerCase()===name)?.[1]
  if(get('content-length')!==String(body.length)||get('content-encoding')!=='aes128gcm'||get('content-type')!=='application/octet-stream'||get('ttl')!=='60'||get('urgency')!=='very-low'||!/^vapid t=[A-Za-z0-9_.-]+, k=[A-Za-z0-9_-]{87}$/.test(get('authorization')??''))throw Error('INVALID_PUSH_HEADERS')
  let timer
  let addresses
  try{
   const result=await Promise.race([resolver(endpoint.hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DNS_TIMEOUT')),3000)})])
   if(!Array.isArray(result)||!result.length||result.length>32||result.some(a=>!a||!allowedAddress(a.address,a.family)))throw Error('UNSAFE_DNS')
   addresses=result.map(a=>Object.freeze({address:a.address,family:a.family}))
  }finally{clearTimeout(timer)}
  if(signal?.aborted)throw transportError('transport_failed')
  // Exactly one IP: disable Node's family racing and fresh socket reuse/retry.
  const target=addresses[0]
  let consumed=false
  return async function sendOnce(){
   if(consumed)throw Error('ATTEMPT_ALREADY_CONSUMED')
   if(signal?.aborted)throw transportError('transport_failed')
   consumed=true // Synchronous latch before creating any socket; not the distributed DB gate.
   let req,agent,totalTimer,bodyTimer,settled=false,finalStatus,finalRetry,interimCount=0,interimBytes=0
   return new Promise((resolve,reject)=>{
    const finish=(error,fields={})=>{
     if(settled)return;settled=true
     clearTimeout(totalTimer);clearTimeout(bodyTimer);signal?.removeEventListener('abort',cancel)
     req?.destroy();agent?.destroy()
     if(finalStatus!==undefined)resolve({status:finalStatus,...(finalRetry===undefined?{}:{retryAfter:finalRetry}),...fields})
     else reject(transportError(error??'transport_failed'))
    }
    const cancel=()=>finish('transport_failed',finalStatus===undefined?{}:{providerBodyStatus:'read_failed'})
    signal?.addEventListener('abort',cancel,{once:true})
    if(signal?.aborted){cancel();return}
    const pin=(_host,options,cb)=>{
     if(_host!==endpoint.hostname)return cb(Error('UNEXPECTED_LOOKUP_HOST'))
     if(options?.all)return cb(null,[{...target}])
     cb(null,target.address,target.family)
    }
    agent=new Agent({keepAlive:false,maxSockets:1,maxFreeSockets:0,lookup:pin,family:target.family,autoSelectFamily:false,rejectUnauthorized:true,...(ca?{ca}:{})})
    totalTimer=setTimeout(()=>finish('timeout',finalStatus===undefined?{}:{providerBodyStatus:'timeout'}),deadlineMs)
    try{
     req=request({protocol:'https:',hostname:endpoint.hostname,port,method:'POST',path:endpoint.pathname,headers:{...headers,Host:endpoint.host,Connection:'close'},agent,servername:endpoint.hostname,rejectUnauthorized:true,autoSelectFamily:false,family:target.family,ALPNProtocols:['http/1.1'],maxHeaderSize:4096},res=>{
      if(settled){res.destroy();return}
      finalStatus=res.statusCode
      if(!Number.isInteger(finalStatus)||finalStatus<200||finalStatus>599){finalStatus=undefined;res.destroy();finish('invalid_response');return}
      // Native https.request never follows Location. Do not even read redirect/success bodies.
      if(finalStatus<400){res.destroy();finish(undefined);return}
      const retry=res.headers['retry-after']
      if(retry!==undefined){
       if(typeof retry==='string'&&/^\d{1,64}$/.test(retry))finalRetry=retry
       else if(typeof retry==='string'&&/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retry)&&Number.isFinite(Date.parse(retry)))finalRetry=String(Math.max(0,Math.ceil((Date.parse(retry)-Date.now())/1000)))
       else finalRetry='INVALID_RETRY_AFTER' // Existing retryDelay turns ambiguity into a paused gate.
      }
      if(interimBytes+res.rawHeaders.reduce((n,text)=>n+Buffer.byteLength(text)+2,64)>4096){res.destroy();finish(undefined,{providerBodyStatus:'too_large'});return}
      const encoding=res.headers['content-encoding'],length=res.headers['content-length']
      const common={}
      if(encoding&&encoding!=='identity'){res.destroy();finish(undefined,{...common,providerBodyStatus:'unsupported_encoding'});return}
      if(typeof length==='string'&&Number(length)>1024){res.destroy();finish(undefined,{...common,providerBodyStatus:'too_large'});return}
      let chunks=[],bytes=0,complete=false
      const diagnostic=status=>{if(complete)return;complete=true;res.destroy();chunks=[];finish(undefined,{...common,providerBodyStatus:status})}
      bodyTimer=setTimeout(()=>diagnostic('timeout'),bodyDeadlineMs)
      res.on('data',chunk=>{
       bytes+=chunk.length
       if(bytes>1024){diagnostic('too_large');return}
       chunks.push(chunk)
      })
      res.on('end',()=>{
       if(complete)return
       const diagnostic=classifyBody(Buffer.concat(chunks),res.headers['content-type']);chunks=[]
       complete=true;finish(undefined,diagnostic)
      })
      res.on('aborted',()=>diagnostic('incomplete'))
      res.on('error',()=>diagnostic('read_failed'))
     })
     req.on('error',error=>finish(['ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN'].includes(error.code)?'tls_failed':error.code==='HPE_HEADER_OVERFLOW'?'response_limit':'transport_failed',finalStatus===undefined?{}:{providerBodyStatus:'read_failed'}))
     req.on('information',info=>{
      interimCount++;interimBytes+=info.rawHeaders.reduce((n,text)=>n+Buffer.byteLength(text)+2,64)
      if(interimCount>4||interimBytes>4096)finish('response_limit')
     })
     // Do not release even HTTP headers until the verified socket is at the pinned IP.
     // This also fails closed if a platform wrapper ever ignores the Agent lookup hook.
     req.on('socket',socket=>{
      const send=()=>{
       let samePeer=false
       try{samePeer=ipaddr.parse(socket.remoteAddress).toNormalizedString()===ipaddr.parse(target.address).toNormalizedString()}catch{}
       if(signal?.aborted){cancel();return}
       if(!samePeer||!socket.authorized){finish('tls_failed');return}
       if(!settled)req.end(body)
      }
      if(socket.authorized&&!socket.connecting)send()
      else socket.once('secureConnect',send)
     })
    }catch{finish('transport_failed')}
   })
  }
 }
}

// The route uses this fixed-policy instance; no HTTP field can select factory options.
export const prepareNodeAttempt=createNodeTransport()
