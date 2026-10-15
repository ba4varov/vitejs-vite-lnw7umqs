import {createOperatorHandler} from '../supabase/functions/_shared/push-operator.mjs'
import {preparePush,validVapid} from '../supabase/functions/_shared/push-test.mjs'
import {isFcmEndpoint,prepareNodeAttempt} from './push-node-transport.js'

const rpcNames=new Set(['push_operator_access','prepare_push_operator','inspect_push_operator','arm_push_operator','claim_push_test','authorize_push_test','finish_push_test','close_push_operator','cancel_push_operator'])
const cleanupNames=new Set(['finish_push_test','close_push_operator','cancel_push_operator'])
const booleanNames=new Set(['push_operator_access','arm_push_operator','authorize_push_test','close_push_operator','cancel_push_operator'])
const reply=(status,error)=>new Response(JSON.stringify({error,deliveryEnabled:false}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
const token=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(value)

function configuration(env){
 // VERCEL_ENV is platform metadata, never NODE_ENV, headers, branch names or request input.
 if(env.VERCEL!=='1'||env.VERCEL_ENV!=='production'||env.PUSH_NODE_OPERATOR_ENABLED!=='true'||process.versions.node.split('.')[0]!=='24')return {disabled:true}
 const base=typeof env.SUPABASE_URL==='string'?env.SUPABASE_URL.replace(/\/$/,''):''
 const key=env.SUPABASE_SERVICE_ROLE_KEY
 if(!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(base)||typeof key!=='string'||!/^[A-Za-z0-9_.-]{20,8192}$/.test(key)||!token(env.PUSH_TEST_OPERATOR_TOKEN))return null
 const vapid={publicKey:env.PUSH_VAPID_PUBLIC_KEY,privateKey:env.PUSH_NODE_VAPID_PRIVATE_KEY,subject:env.PUSH_VAPID_SUBJECT}
 if(!validVapid(vapid.publicKey,vapid.privateKey,vapid.subject))return null
 return {base,key,vapid,operatorToken:env.PUSH_TEST_OPERATOR_TOKEN}
}

async function jsonWithin(response,signal,limit){
 const reader=response.body?.getReader();if(!reader)throw Error('CONTROL_RESPONSE_FAILED')
 let chunks=[],size=0,rejectAbort
 const aborted=new Promise((_,reject)=>{rejectAbort=()=>reject(Error('CONTROL_ABORTED'));signal.addEventListener('abort',rejectAbort,{once:true})})
 try{
  if(signal.aborted)throw Error('CONTROL_ABORTED')
  while(true){
   const item=await Promise.race([reader.read(),aborted]);if(item.done)break
   size+=item.value.length;if(size>limit)throw Error('CONTROL_RESPONSE_LIMIT')
   chunks.push(Buffer.from(item.value))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
 }finally{signal.removeEventListener('abort',rejectAbort);chunks=[];void reader.cancel().catch(()=>{})}
}

function controlClient(config,fetcher,requestSignal){
 async function call(path,payload,jwt,cleanup=false){
  const signal=cleanup?AbortSignal.timeout(5000):AbortSignal.any([requestSignal,AbortSignal.timeout(5000)])
  if(signal.aborted)throw Error('CONTROL_ABORTED')
  const response=await fetcher(config.base+path,{method:payload===undefined?'GET':'POST',redirect:'error',signal,
   headers:{apikey:config.key,Authorization:`Bearer ${jwt??config.key}`,...(payload===undefined?{}:{'Content-Type':'application/json'})},
   ...(payload===undefined?{}:{body:JSON.stringify(payload)}),
  })
  if(!response.ok){void response.body?.cancel().catch(()=>{});throw Error('CONTROL_FAILED')}
  if(path==='/rest/v1/rpc/finish_push_test'){void response.body?.cancel().catch(()=>{});return null}
  return jsonWithin(response,signal,path==='/auth/v1/user'?32768:8192)
 }
 return {
  getUser:async jwt=>{const user=await call('/auth/v1/user',undefined,jwt);return {id:user?.id}},
  rpc:async(name,args)=>{
   if(!rpcNames.has(name))throw Error('UNSUPPORTED_CONTROL_OPERATION')
   const result=await call(`/rest/v1/rpc/${name}`,args,undefined,cleanupNames.has(name))
   if(booleanNames.has(name)&&typeof result!=='boolean')throw Error('CONTROL_RESPONSE_FAILED')
   if(name==='inspect_push_operator'&&!isFcmEndpoint(result?.endpoint))throw Error('INVALID_FCM_SUBSCRIPTION')
   return result
  },
 }
}

// Dependency injection is server/test construction only. The API never reads it from HTTP input.
export function createNodeOperatorHandler({env=process.env,fetcher=fetch,resolver,prepareTransport=prepareNodeAttempt,diagnose=()=>{}}={}){
 return async request=>{
  const config=configuration(env)
  if(config?.disabled)return reply(503,'PUSH_NODE_DISABLED')
  if(!config)return reply(503,'PUSH_NODE_UNCONFIGURED')
  if(request.signal.aborted)return reply(503,'PUSH_TEST_UNCERTAIN')
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)])
  const {getUser,rpc}=controlClient(config,fetcher,signal)
  // Explicitly supply the Node sender. The shared handler's legacy default is unreachable.
  const handler=createOperatorHandler({
   env:{PUSH_TEST_DELIVERY_ENABLED:'true',PUSH_TEST_OPERATOR_TOKEN:config.operatorToken,
    PUSH_VAPID_PUBLIC_KEY:config.vapid.publicKey,PUSH_VAPID_PRIVATE_KEY:config.vapid.privateKey,PUSH_VAPID_SUBJECT:config.vapid.subject},
   getUser,rpc,diagnose,...(resolver?{resolver}:{}),
   prepare:(device,vapid,eventId)=>{
    if(!isFcmEndpoint(device.endpoint))throw Error('INVALID_FCM_SUBSCRIPTION')
    return preparePush(device,vapid,eventId)
   },
   send:async(details,cachedResolver)=>{
    // cachedResolver contains the pre-authorize DNS snapshot, not a second network lookup.
    const once=await prepareTransport(details,cachedResolver,signal)
    return once()
   },
  })
  try{return await handler(request)}catch{return reply(503,'PUSH_TEST_UNCERTAIN')}
 }
}

// Node-only Web Standard handler, supported by Vercel's Node runtime.
export const handleNodeOperator=createNodeOperatorHandler()
