import {restoreSession,type AuthSession} from './auth-client'
export type PushCity={name:string;latitude:number;longitude:number;zone:string}
export type PushPreferences={enabled:boolean;cities:PushCity[];categories:string[]}
export type PushDevice={id:string;label:string;fingerprint:string;createdAt:string}
export type PushSnapshot={contractVersion:1;pro:boolean;preferences:PushPreferences;devices:PushDevice[];registrationEnabled:boolean;publicKey:string|null;deliveryEnabled:false}
// PostgreSQL jsonb may reorder object keys; category order has no semantic meaning.
export function pushPreferencesEqual(a:PushPreferences,b:PushPreferences) {
 const canonical=(p:PushPreferences)=>JSON.stringify({enabled:p.enabled,cities:p.cities.map(c=>({name:c.name,latitude:c.latitude,longitude:c.longitude,zone:c.zone})),categories:[...p.categories].sort()})
 return canonical(a)===canonical(b)
}
export async function pushRequest(session:AuthSession,method='GET',body?:object):Promise<PushSnapshot> {
 const active=await restoreSession()
 if(!active||active.user.id!==session.user.id)throw Error('SESSION_CHANGED')
 const response=await fetch('/api/push',{method,headers:{Authorization:`Bearer ${active.access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(10000)})
 if(!response.ok){
  const error=await response.json().catch(()=>({}))
  const codes=['INVALID_SESSION','PUSH_RATE_LIMITED','PUSH_FORBIDDEN','PUSH_MIGRATION_REQUIRED','PUSH_UNAVAILABLE','INVALID_BODY']
  throw Error(codes.includes(error?.error)?error.error:String(response.status))
 }
 const data=await response.json()
 const p=data?.preferences
 if(data?.contractVersion!==1||data.deliveryEnabled!==false||!Array.isArray(data.devices)||typeof p?.enabled!=='boolean'||!Array.isArray(p.cities)||!p.cities.every(c=>c&&typeof c.name==='string'&&Number.isFinite(c.latitude)&&Number.isFinite(c.longitude)&&typeof c.zone==='string')||!Array.isArray(p.categories)||!p.categories.every(c=>typeof c==='string')||typeof data.pro!=='boolean')throw Error('INVALID_RESPONSE')
 return data
}
