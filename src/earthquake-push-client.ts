import {accountSession,type AuthSession} from './auth-client'

export type EarthquakePushConsentSnapshot={
  contractVersion:1;enabled:boolean;
  city:{name:string;latitude:number;longitude:number;zone:string}|null;
  optedInAt:string|null;radiusKm:300;minMagnitude:3;
  deviceCount:number;deliveryEnabled:false
}

export async function earthquakeConsentRequest(
  session:AuthSession,method:'GET'|'PUT'='GET',
  change?:{enabled:false}|{enabled:true;cityIndex:number},
  isCurrent:()=>boolean=()=>true
):Promise<EarthquakePushConsentSnapshot> {
  const active=await accountSession(session.user.id)
  if(!active||active.user.id!==session.user.id||!isCurrent())
    throw Error('SESSION_CHANGED')
  const response=await fetch('/api/push?channel=earthquakes',{
    method,
    headers:{
      Authorization:`Bearer ${active.access_token}`,
      'Content-Type':'application/json'
    },
    ...(method==='PUT'?{body:JSON.stringify(change)}:{}),
    cache:'no-store',signal:AbortSignal.timeout(11_000)
  })
  if(!isCurrent())throw Error('SESSION_CHANGED')
  if(!response.ok)throw Error(response.status===401?'SESSION_CHANGED':
    'EARTHQUAKE_CONSENT_UNAVAILABLE')
  const data=await response.json() as EarthquakePushConsentSnapshot
  if(data.contractVersion!==1||data.deliveryEnabled!==false||
    typeof data.enabled!=='boolean'||data.radiusKm!==300||
    data.minMagnitude!==3||!Number.isInteger(data.deviceCount)||
    data.deviceCount<0||data.deviceCount>10||
    (data.enabled?(!data.city||typeof data.city.name!=='string'||typeof data.optedInAt!=='string'):
      (data.city!==null||data.optedInAt!==null)))throw Error('INVALID_CONSENT_RESPONSE')
  if(!isCurrent())throw Error('SESSION_CHANGED')
  return data
}
