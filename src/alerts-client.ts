import {restoreSession,type AuthSession} from './auth-client'
export async function alertsRequest(session:AuthSession,method='GET',body?:object,signal?:AbortSignal) {
 const active=await restoreSession()
 if(!active || active.user.id!==session.user.id)throw Error('SESSION_CHANGED')
 const response=await fetch('/api/alerts',{method,headers:{Authorization:`Bearer ${active.access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),cache:'no-store'})
 if(!response.ok)throw Error(String(response.status))
 const data=await response.json()
 if(typeof data?.pro!=='boolean'||!Array.isArray(data.enabled)||!Array.isArray(data.alerts))throw Error('INVALID_RESPONSE')
 return data
}
export const alertNames:any={bg:{rain:'Силни валежи',storm:'Гръмотевични условия',wind:'Силен вятър',cold:'Много ниска усещана температура',heat:'Екстремна усещана температура',walk:'Време за разходка',garden:'Време за градинарство',sport:'Време за спорт'},en:{rain:'Heavy precipitation',storm:'Thunderstorm conditions',wind:'Strong wind',cold:'Very low feels-like temperature',heat:'Extreme feels-like temperature',walk:'Time for a walk',garden:'Time for gardening',sport:'Time for outdoor sport'}}
