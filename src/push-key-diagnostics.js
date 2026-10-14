import {checkPushRegistration} from './push-browser.js'
const unavailable=()=>({p256dh:'unavailable',auth:'unavailable'})
export const keyDiagnosticStatuses=['match','mismatch','missing','unavailable']
export const validKeyDiagnostic=result=>result&&Object.keys(result).length===2&&['p256dh','auth'].every(k=>keyDiagnosticStatuses.includes(result[k]))
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')
// Only nonce-bound digests leave this function. No subscription serialization,
// permissions, registration, storage, logging or notification delivery.
export async function checkPushKeys({scope=window,device,key,verify,authorize}) {
 try {
  if(!await authorize())return unavailable()
  if(await checkPushRegistration({scope,device,key})!=='match')return unavailable()
  const registration=await scope.navigator.serviceWorker.getRegistration('/')
  const sub=await registration?.pushManager.getSubscription()
  if(!sub)return {p256dh:'missing',auth:'missing'}
  // Recheck the actual subscription used for getKey, including a possible change
  // between the first registration check and this read.
  const fingerprint=hex(new Uint8Array(await scope.crypto.subtle.digest('SHA-256',new TextEncoder().encode(sub.endpoint))))
  if(fingerprint!==device.fingerprint||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(device.id))return unavailable()
  const nonce=hex(scope.crypto.getRandomValues(new Uint8Array(32)))
  const context=`meteo-pulse:push-key:v1\n${device.id}\n${fingerprint}\n${nonce}\n`
  const proof=async(name,size)=>{
   try {
    const raw=sub.getKey(name)
    if(raw===null)return 'missing'
    const bytes=new Uint8Array(raw)
    if(bytes.length!==size||(name==='p256dh'&&bytes[0]!==4))return 'unavailable'
    const prefix=new TextEncoder().encode(context+name+'\n'),input=new Uint8Array(prefix.length+bytes.length)
    input.set(prefix);input.set(bytes,prefix.length)
    return hex(new Uint8Array(await scope.crypto.subtle.digest('SHA-256',input)))
   }catch{return 'unavailable'}
  }
  const [p256dh,auth]=await Promise.all([proof('p256dh',65),proof('auth',16)])
  if(!await authorize())return unavailable()
  const result=await verify({deviceId:device.id,fingerprint,nonce,p256dh,auth})
  if(!await authorize()||!validKeyDiagnostic(result))return unavailable()
  return {p256dh:result.p256dh,auth:result.auth}
 }catch{return unavailable()}
}
export const pushKeyMessages={
 bg:{match:'съвпада',mismatch:'не съвпада',missing:'липсва в браузъра или в записа',unavailable:'не може да бъде проверен'},
 en:{match:'matches',mismatch:'does not match',missing:'missing in the browser or stored record',unavailable:'cannot be checked'},
}
