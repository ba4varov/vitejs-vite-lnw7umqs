import {requestPushKeyCheck} from './push-key-request.js'
import {restoreSession,type AuthSession} from './auth-client'
export type PushCity={name:string;latitude:number;longitude:number;zone:string}
export type PushPreferences={enabled:boolean;cities:PushCity[];categories:string[]}
export type PushDevice={id:string;label:string;fingerprint:string;createdAt:string}
export type PushSnapshot={contractVersion:1;pro:boolean;preferences:PushPreferences;devices:PushDevice[];registrationEnabled:boolean;publicKey:string|null;deliveryEnabled:false}
export async function pushRequest(session:AuthSession,method='GET',body?:object):Promise<PushSnapshot> {
 const active=await restoreSession()
 if(!active||active.user.id!==session.user.id)throw Error('SESSION_CHANGED')
 const response=await fetch('/api/push',{method,headers:{Authorization:`Bearer ${active.access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(10000)})
 if(!response.ok)throw Object.assign(Error(String(response.status)),{status:response.status})
 const data=await response.json()
 if(data.contractVersion!==1||data.deliveryEnabled!==false||!Array.isArray(data.devices)||!Array.isArray(data.preferences?.cities)||!Array.isArray(data.preferences?.categories)||typeof data.pro!=='boolean')throw Error('INVALID_RESPONSE')
 return data
}

export async function pushKeySessionMatches(session:AuthSession) {
 const active=await restoreSession()
 return !!active&&active.user.id===session.user.id
}
export async function pushKeyRequest(session:AuthSession,body:object) {
 return requestPushKeyCheck(session,body,{getSession:restoreSession})
}

// Fixed vocabulary only: never expose arbitrary server strings or provider details.
export const safePushTestCode=(value:unknown):string => typeof value==='string'&&new Set([
 'configuration:disabled','configuration:missing','request:method','request:input','rights:origin','rights:denied','rights:allowed','rights:permit-refused',
 'session:missing','session:rejected','session:changed','database:access-unavailable','vapid:configuration','vapid:subscription-invalid',
 'device:ready','device:closed','device:registration-or-consent','fcm:accepted','fcm:rejected','attempt:unknown','attempt:refused',
 'request:http','request:response','network:unknown'
]).has(value)?value:'attempt:unknown'

export function pushTestDiagnostic(result:any):string {
 const category=result?.diagnostic?.category,status=result?.diagnostic?.providerStatus
 const categories=['accepted','subscription_expired','provider_auth_rejected','rate_limited','provider_unavailable','redirect_refused','request_rejected','provider_rejected','tls_failed','connect_failed','write_failed','response_failed','response_limit','invalid_response','invalid_headers','request_limit','timeout','transport_failed','transport_uncertain','dns_failed','preparation_failed','database_uncertain','gate_cleanup_failed']
 return (categories.includes(category)?' · '+category:'')+(Number.isInteger(status)&&status>=100&&status<=599?' · provider HTTP '+status:'')
}

// No retries: a lost response may follow an already consumed provider attempt.
export async function sessionPushTest(session:AuthSession,body:object) {
 const active=await restoreSession()
 if(!active||active.user.id!==session.user.id)throw Error('session:changed')
 let response:Response
 try {
  response=await fetch('/api/push-operator',{method:'POST',headers:{Authorization:`Bearer ${active.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(55000)})
 }catch {throw Error('network:unknown')}
 const result=await response.json().catch(()=>null)
 if(!response.ok)throw Object.assign(Error(`${typeof result?.code==='string'&&safePushTestCode(result.code)===result.code?result.code:'request:http'} · HTTP ${response.status}`),{diagnostic:result?.diagnostic})
 if(!result||safePushTestCode(result.code)!==result.code||result.deliveryEnabled!==false||result.phoneDelivery!=='unconfirmed')throw Error('request:response')
 return result
}
