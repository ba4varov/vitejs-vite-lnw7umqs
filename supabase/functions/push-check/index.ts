import {createWeatherHandler} from '../_shared/push-weather.mjs'
import {sendPinned} from '../_shared/push-test.mjs'
import {denoConnector} from '../_shared/push-deno.ts'
const env=Object.fromEntries(['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','PUSH_WEATHER_DELIVERY_ENABLED','PUSH_WEATHER_OPERATOR_TOKEN','PUSH_VAPID_PUBLIC_KEY','PUSH_VAPID_PRIVATE_KEY','PUSH_VAPID_SUBJECT'].map(name=>[name,Deno.env.get(name)]))
async function rpc(name:string,payload:unknown) {
 const base=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY
 if(!base||!key)throw Error('RPC_UNCONFIGURED')
 const response=await fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload)})
 if(!response.ok)throw Error('RPC_FAILED')
 if(['finish_weather_push','end_weather_push'].includes(name))return null
 return response.json()
}
Deno.serve(createWeatherHandler({env,rpc,send:(details,resolver)=>sendPinned(details,resolver,denoConnector())}))
