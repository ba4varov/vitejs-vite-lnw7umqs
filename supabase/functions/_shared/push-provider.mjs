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
export const safeProviderReason=value=>typeof value==='string'&&Object.values(reasons).includes(value)?value:undefined
function classify(bytes,type) {
 const text=bytes.toString('utf8').trim()
 if(type==='text/plain')return Object.hasOwn(reasons,text)?reasons[text]:undefined
 try {
  const error=JSON.parse(text)?.error
  const detail=Array.isArray(error?.details)?error.details.find(d=>d?.['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError'):undefined
  const code=detail?.errorCode
  if(typeof code==='string'&&Object.hasOwn(reasons,code))return reasons[code]
  return typeof error?.status==='string'&&Object.hasOwn(reasons,error.status)?reasons[error.status]:undefined
 }catch{return undefined}
}
// Optional diagnostics cannot turn a known HTTP rejection into an uncertain delivery.
// Bound time, wire bytes (including chunk framing), and decoded body independently.
export async function readProviderReason(connection,initial,lines) {
 let timer
 const read=async()=>{
  const headers=new Map()
  for(const line of lines){
   const colon=line.indexOf(':'),name=line.slice(0,colon).toLowerCase(),value=line.slice(colon+1).trim()
   if(headers.has(name))return undefined
   headers.set(name,value)
  }
  const type=headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if(!['application/json','text/plain'].includes(type)||headers.has('content-encoding')&&headers.get('content-encoding')!=='identity')return undefined
  const length=headers.get('content-length'),transfer=headers.get('transfer-encoding')
  if(transfer&&transfer.toLowerCase()!=='chunked'||transfer&&length!==undefined)return undefined
  if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>1024))return undefined
  let wire=Buffer.from(initial),body=Buffer.alloc(0),offset=0
  if(wire.length>2048)return undefined
  while(true){
   if(transfer){
    while(true){
     const end=wire.indexOf('\r\n',offset)
     if(end<0)break
     const sizeText=wire.subarray(offset,end).toString('ascii')
     if(!/^[0-9a-fA-F]{1,4}$/.test(sizeText))return undefined
     const size=parseInt(sizeText,16),start=end+2
     if(body.length+size>1024)return undefined
     if(wire.length<start+size+2)break
     if(wire.subarray(start+size,start+size+2).toString()!=='\r\n')return undefined
     if(size===0)return classify(body,type)
     body=Buffer.concat([body,wire.subarray(start,start+size)]);offset=start+size+2
    }
   }else if(length!==undefined&&wire.length>=Number(length)){
    return classify(wire.subarray(0,Number(length)),type)
   }
   if(wire.length>=2048)return undefined
   const buffer=new Uint8Array(2048-wire.length),n=await connection.read(buffer)
   if(n===null||n===0)return !transfer&&length===undefined&&wire.length<=1024?classify(wire,type):undefined
   if(!Number.isInteger(n)||n<1||n>buffer.length)return undefined
   wire=Buffer.concat([wire,Buffer.from(buffer.subarray(0,n))])
  }
 }
 try{return await Promise.race([read(),new Promise(resolve=>{timer=setTimeout(()=>resolve(undefined),300)})])}
 catch{return undefined}
 finally{clearTimeout(timer)}
}
