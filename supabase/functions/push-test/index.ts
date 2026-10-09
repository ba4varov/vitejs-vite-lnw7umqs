import {createTestHandler,sendPinned} from '../_shared/push-test.mjs'
import {denoConnector} from '../_shared/push-deno.ts'

// No client SDK, user JWT sender, CORS or logs. Supabase secrets only.
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
Deno.serve(createTestHandler({env,rpc,send:(details,resolver)=>sendPinned(details,resolver,denoConnector())}))
