import {restoreSession,type AuthSession} from './auth-client'
export type PushCity={name:string;latitude:number;longitude:number;zone:string}
export type PushPreferences={enabled:boolean;cities:PushCity[];categories:string[]}
export type PushDevice={id:string;label:string;fingerprint:string;createdAt:string}
export type PushSnapshot={contractVersion:1;pro:boolean;preferences:PushPreferences;devices:PushDevice[];registrationEnabled:boolean;publicKey:string|null;deliveryEnabled:false}
export async function pushRequest(session:AuthSession,method='GET',body?:object):Promise<PushSnapshot> {
 const active=await restoreSession()
 if(!active||active.user.id!==session.user.id)throw Error('SESSION_CHANGED')
 const response=await fetch('/api/push',{method,headers:{Authorization:`Bearer ${active.access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(10000)})
 if(!response.ok)throw Error(String(response.status))
 const data=await response.json()
 if(data.contractVersion!==1||data.deliveryEnabled!==false||!Array.isArray(data.devices)||!Array.isArray(data.preferences?.cities)||!Array.isArray(data.preferences?.categories)||typeof data.pro!=='boolean')throw Error('INVALID_RESPONSE')
 return data
}
