import {sendPinned} from '../_shared/push-test.mjs'
import {createOperatorHandler} from '../_shared/push-operator.mjs'
import {denoConnector} from '../_shared/push-deno.ts'

// No client SDK, user JWT sender or CORS. Log only bounded diagnostic fields.
const env=Object.fromEntries(['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','PUSH_TEST_DELIVERY_ENABLED','PUSH_TEST_OPERATOR_TOKEN','PUSH_VAPID_PUBLIC_KEY','PUSH_VAPID_PRIVATE_KEY','PUSH_VAPID_SUBJECT'].map(name=>[name,Deno.env.get(name)]))
async function rpc(name:string,payload:unknown) {
 const base=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY
 if(!base || !key)throw Error('RPC_UNCONFIGURED')
 const response=await fetch(`${base}/rest/v1/rpc/${name}`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
  headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload),
 })
 if(!response.ok)throw Error('RPC_FAILED') // Never log response/error objects containing subscriptions.
 if(name==='finish_push_test')return null // PostgreSQL void may be HTTP 204 with no JSON body.
 return response.json()
}
async function getUser(jwt:string) {
 const base=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY
 if(!base||!key)throw Error('AUTH_UNCONFIGURED')
 const response=await fetch(`${base}/auth/v1/user`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(5000),headers:{apikey:key,Authorization:`Bearer ${jwt}`}})
 if(!response.ok)throw Error('INVALID_SESSION')
 const user=await response.json()
 return {id:user.id} // Never trust decoded/unverified claims, client actor IDs or metadata roles.
}
Deno.serve(createOperatorHandler({env,rpc,getUser,diagnose:(diagnostic:Record<string,string|number>)=>console.info(JSON.stringify({event:'push_test_result',...diagnostic})),send:(details:Parameters<typeof sendPinned>[0],resolver:Parameters<typeof sendPinned>[1])=>sendPinned(details,resolver,denoConnector())}))
