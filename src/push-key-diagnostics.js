import {safeKeyStage} from './push-key-stages.js'
import {checkPushRegistration} from './push-browser.js'
const unavailable=()=>({p256dh:'unavailable',auth:'unavailable'})
export const keyDiagnosticStatuses=['match','mismatch','missing','unavailable']
export const validKeyDiagnostic=result=>result&&Object.keys(result).length===2&&['p256dh','auth'].every(k=>keyDiagnosticStatuses.includes(result[k]))
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')
// Only nonce-bound digests leave this function. No subscription serialization,
// permissions, registration, storage, logging or notification delivery.
export async function checkPushKeys({scope=window,device,key,verify,authorize,onDiagnostic=(_stage)=>{}}) {
 let stage='session:before'
 const report=code=>onDiagnostic(safeKeyStage(code)||'request:response')
 const stop=code=>{report(code);return unavailable()}
 try {
  if(!await authorize())return stop(stage)
  stage='registration:rejected'
  if(await checkPushRegistration({scope,device,key})!=='match')return stop(stage)
  stage='browser:subscription'
  const registration=await scope.navigator.serviceWorker.getRegistration('/')
  const sub=await registration?.pushManager.getSubscription()
  if(!sub){report('browser:key-missing');return {p256dh:'missing',auth:'missing'}}
  stage='browser:crypto'
  // Recheck the actual subscription used for getKey, including a possible change
  // between the first registration check and this read.
  const fingerprint=hex(new Uint8Array(await scope.crypto.subtle.digest('SHA-256',new TextEncoder().encode(sub.endpoint))))
  if(fingerprint!==device.fingerprint||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(device.id))return stop('browser:identity')
  const nonce=hex(scope.crypto.getRandomValues(new Uint8Array(32)))
  const context=`meteo-pulse:push-key:v1\n${device.id}\n${fingerprint}\n${nonce}\n`
  let keyIssue=null
  const proof=async(name,size)=>{
   let proofStage='browser:key-read'
   try {
    const raw=sub.getKey(name)
    if(raw===null){keyIssue=keyIssue||'browser:key-missing';return 'missing'}
    const bytes=new Uint8Array(raw)
    if(bytes.length!==size||(name==='p256dh'&&bytes[0]!==4)){keyIssue='browser:key-format';return 'unavailable'}
    proofStage='browser:crypto'
    const prefix=new TextEncoder().encode(context+name+'\n'),input=new Uint8Array(prefix.length+bytes.length)
    input.set(prefix);input.set(bytes,prefix.length)
    return hex(new Uint8Array(await scope.crypto.subtle.digest('SHA-256',input)))
   }catch{keyIssue=proofStage;return 'unavailable'}
  }
  const [p256dh,auth]=await Promise.all([proof('p256dh',65),proof('auth',16)])
  stage='session:before-request'
  if(!await authorize())return stop(stage)
  stage='request:transport'
  const result=await verify({deviceId:device.id,fingerprint,nonce,p256dh,auth})
  stage='session:after-request'
  if(!await authorize())return stop(stage)
  const keys=result&&{p256dh:result.p256dh,auth:result.auth}
  if(!validKeyDiagnostic(keys)||Object.keys(result).some(k=>!['p256dh','auth','diagnostic'].includes(k))||(result.diagnostic!==undefined&&!safeKeyStage(result.diagnostic)))return stop('request:response')
  report(keyIssue||safeKeyStage(result.diagnostic)||(Object.values(keys).includes('unavailable')?'rpc:result-unavailable':'rpc:complete'))
  return {p256dh:result.p256dh,auth:result.auth}
 }catch(error){return stop(safeKeyStage(error?.diagnostic)||(error?.message==='SESSION_CHANGED'?'session:after-request':stage))}
}
export const pushKeyMessages={
 bg:{match:'съвпада',mismatch:'не съвпада',missing:'липсва в браузъра или в записа',unavailable:'не може да бъде проверен'},
 en:{match:'matches',mismatch:'does not match',missing:'missing in the browser or stored record',unavailable:'cannot be checked'},
}
