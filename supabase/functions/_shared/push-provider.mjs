import {Buffer} from 'node:buffer'

// Only fixed identifiers leave this module. Never return provider text or messages.
const reasons={
 INVALID_ARGUMENT:'fcm_invalid_argument',UNAUTHENTICATED:'fcm_unauthenticated',
 PERMISSION_DENIED:'fcm_permission_denied',NOT_FOUND:'fcm_not_found',
 RESOURCE_EXHAUSTED:'fcm_resource_exhausted',INTERNAL:'fcm_internal',UNAVAILABLE:'fcm_unavailable',
 UNREGISTERED:'fcm_unregistered',SENDER_ID_MISMATCH:'fcm_sender_id_mismatch',
 QUOTA_EXCEEDED:'fcm_quota_exceeded',THIRD_PARTY_AUTH_ERROR:'fcm_third_party_auth_error',
 InvalidRegistration:'fcm_invalid_registration',UnauthorizedRegistration:'fcm_unauthorized_registration',
 InvalidTTL:'fcm_invalid_ttl',
}
const bodyStatuses=['recognized','empty','unknown_format','incomplete','timeout','too_large','unsupported_encoding','invalid_framing','read_failed']
export const safeProviderReason=value=>typeof value==='string'&&[...Object.values(reasons),'fcm_vapid_subscription_mismatch'].includes(value)?value:undefined
export const safeProviderBodyStatus=value=>typeof value==='string'&&bodyStatuses.includes(value)?value:undefined
export const providerPhraseReason=value=>typeof value==='string'&&Object.hasOwn(reasons,value)?reasons[value]:undefined
function classify(bytes,type) {
 if(bytes.length===0)return {providerBodyStatus:'empty'}
 const text=bytes.toString('utf8').trim()
 let reason
 if(type==='text/plain'){
  reason=providerPhraseReason(text)
  // Observed FCM Web Push response, not an FCM HTTP v1 error schema.
  if(text==='the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions.')reason='fcm_vapid_subscription_mismatch'
 }else if(type==='text/html'){
  // Match the observed FCM error template, not keywords embedded in arbitrary HTML.
  const html=/^<html>\s*<head>\s*<title>\s*([A-Za-z]+)\s*<\/title>\s*<\/head>\s*<body(?:\s+[^<>]*)?>\s*<h1>\s*([A-Za-z]+)\s*<\/h1>\s*<h2>\s*Error [45][0-9]{2}\s*<\/h2>\s*(?:<!--[\s\S]*?-->\s*)*<\/body>\s*<\/html>$/i.exec(text)
  if(html&&html[1]===html[2])reason=providerPhraseReason(html[1])
 }else if(type==='application/json'){
  try {
   const error=JSON.parse(text)?.error
   const detail=Array.isArray(error?.details)?error.details.find(d=>d?.['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError'):undefined
   reason=providerPhraseReason(detail?.errorCode)||providerPhraseReason(error?.status)
  }catch{/* Unknown JSON is not a provider reason. */}
 }
 return reason?{providerBodyStatus:'recognized',providerReason:reason}:{providerBodyStatus:'unknown_format'}
}
// Optional diagnostics cannot turn a known HTTP rejection into an uncertain delivery.
// Bound time, wire bytes (including chunk framing), and decoded body independently.
export async function readProviderDiagnostic(connection,initial,lines) {
 let timer
 const status=providerBodyStatus=>({providerBodyStatus})
 const read=async()=>{
  const headers=new Map()
  for(const line of lines){
   const colon=line.indexOf(':'),name=line.slice(0,colon).toLowerCase(),value=line.slice(colon+1).trim()
   if(!['content-type','content-encoding','content-length','transfer-encoding'].includes(name))continue
   if(headers.has(name))return status('invalid_framing')
   headers.set(name,value)
  }
  const type=headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  const length=headers.get('content-length'),transfer=headers.get('transfer-encoding')
  if(transfer&&transfer.toLowerCase()!=='chunked'||transfer&&length!==undefined)return status('invalid_framing')
  if(length!==undefined&&!/^\d+$/.test(length))return status('invalid_framing')
  if(length!==undefined&&Number(length)>1024)return status('too_large')
  if(length==='0')return status('empty')
  if(headers.has('content-encoding')&&headers.get('content-encoding').toLowerCase()!=='identity')return status('unsupported_encoding')
  let wire=Buffer.from(initial),body=Buffer.alloc(0),offset=0
  if(wire.length>2048)return status('too_large')
  while(true){
   if(transfer){
    while(true){
     const end=wire.indexOf('\r\n',offset)
     if(end<0)break
     const sizeText=wire.subarray(offset,end).toString('ascii')
     if(!/^[0-9a-fA-F]{1,4}$/.test(sizeText))return status('invalid_framing')
     const size=parseInt(sizeText,16),start=end+2
     if(body.length+size>1024)return status('too_large')
     if(wire.length<start+size+2)break
     if(wire.subarray(start+size,start+size+2).toString()!=='\r\n')return status('invalid_framing')
     if(size===0)return classify(body,type)
     body=Buffer.concat([body,wire.subarray(start,start+size)]);offset=start+size+2
    }
   }else if(length!==undefined&&wire.length>=Number(length)){
    return classify(wire.subarray(0,Number(length)),type)
   }else if(length===undefined&&wire.length>1024)return status('too_large')
   if(wire.length>=2048)return status('too_large')
   const buffer=new Uint8Array(2048-wire.length),n=await connection.read(buffer)
   if(n===null||n===0)return !transfer&&length===undefined?classify(wire,type):status('incomplete')
   if(!Number.isInteger(n)||n<1||n>buffer.length)return status('read_failed')
   wire=Buffer.concat([wire,Buffer.from(buffer.subarray(0,n))])
  }
 }
 try{return await Promise.race([read(),new Promise(resolve=>{timer=setTimeout(()=>resolve(status('timeout')),300)})])}
 catch{return status('read_failed')}
 finally{clearTimeout(timer)}
}
