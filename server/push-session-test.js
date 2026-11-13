import {createNodeDiagnosticBridge} from './push-node-diagnostics.js'
import {randomBytes} from 'node:crypto'
import {controlClient} from './push-node-operator.js'
import {createOperatorHandler,bodyOf} from '../supabase/functions/_shared/push-operator.mjs'
import {preparePush,validVapid} from '../supabase/functions/_shared/push-test.mjs'
import {isFcmEndpoint,prepareNodeAttempt} from './push-node-transport.js'

const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v)
const reply=(status,code,extra={})=>Response.json({code,deliveryEnabled:false,phoneDelivery:'unconfirmed',...extra},{status,headers:{'Cache-Control':'private, no-store','Vary':'Authorization'}})

// Dependencies are construction-time fixtures, never selectable through request input.
export function createSessionPushHandler({env=process.env,fetcher=fetch,resolver,prepareTransport=prepareNodeAttempt}={}){
 return async request=>{
  // Preview can exercise mocks only. No real control/provider traffic from Preview.
  if(env.VERCEL!=='1'||env.VERCEL_ENV!=='production'||env.PUSH_SESSION_TEST_ENABLED!=='true'||process.versions.node.split('.')[0]!=='24')return reply(503,'configuration:disabled')
  if(request.method!=='POST')return reply(405,'request:method')
  const url=new URL(request.url)
  if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'||url.search)return reply(403,'rights:origin')
  const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_SERVICE_ROLE_KEY
  if(!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(base||'')||!key)return reply(503,'configuration:missing')
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)])
  const client=controlClient({base,key},fetcher,signal)
  const authorization=request.headers.get('authorization')||''
  if(authorization.length>8192||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization))return reply(401,'session:missing')
  let actor
  try{actor=await client.getUser(authorization.slice(7));if(!uuid(actor?.id))throw Error()}catch{return reply(401,'session:rejected')}
  try{if(await client.rpc('push_operator_access',{actor_id:actor.id})!==true)return reply(403,'rights:denied')}catch{return reply(503,'database:access-unavailable')}
  let body
  try{body=await bodyOf(request)}catch{return reply(400,'request:input')}
  const exact=keys=>Object.keys(body).length===keys.length&&Object.keys(body).every(k=>keys.includes(k))
  let target
  try{target=await client.rpc('push_session_target',{actor_id:actor.id})}catch{return reply(503,'database:target-unavailable')}
  const targetId=uuid(target?.deviceId)&&target.userId===actor.id?target.deviceId:null
  if(body.operation==='access'&&exact(['operation']))return reply(200,'rights:allowed',{allowed:true,target:targetId?{deviceId:targetId,label:typeof target.label==='string'?target.label.slice(0,80):''}:null})
  if(!targetId&&body.operation!=='cancel')return reply(409,'device:not-authorized')
  if(body.operation==='prepare'){
   if(!exact(['operation','category','requestId'])||!uuid(body.requestId)||!['rain','storm','wind','cold','heat','walk','garden','sport'].includes(body.category))return reply(400,'request:input')
   body={...body,userId:actor.id,deviceId:targetId}
  }else if(!['send','cancel'].includes(body.operation)||!uuid(body.permitId)||!exact(body.operation==='send'?['operation','permitId','confirmation']:['operation','permitId']))return reply(400,'request:input')
  const vapid={publicKey:env.PUSH_VAPID_PUBLIC_KEY,privateKey:env.PUSH_NODE_VAPID_PRIVATE_KEY,subject:env.PUSH_VAPID_SUBJECT}
  if(!validVapid(vapid.publicKey,vapid.privateKey,vapid.subject))return reply(503,'vapid:configuration')
  // Ephemeral internal adapter credential: never configured, persisted or returned to a browser.
  const internal=randomBytes(32).toString('base64url')
  const rpc=async(name,args)=>{
   if(name==='prepare_push_operator')return client.rpc('prepare_push_session',{actor_id:actor.id,test_category:args.test_category,request_id:args.request_id})
   // Server independently checks that this permit belongs to the current DB target.
   if(name==='arm_push_operator'&&await client.rpc('push_session_scope',{actor_id:actor.id,permit_id:args.permit_id,target_device:targetId})!==true)return false
   if(['arm_push_operator','cancel_push_operator'].includes(name))return client.rpc('push_session_permit',{action:name==='arm_push_operator'?'arm':'cancel',actor_id:actor.id,permit_id:args.permit_id,confirmation:args.confirmation??null})
   return client.rpc(name,args)
  }
  const diagnostics=createNodeDiagnosticBridge()
  const handler=createOperatorHandler({env:{PUSH_TEST_DELIVERY_ENABLED:'true',PUSH_TEST_OPERATOR_TOKEN:internal,PUSH_VAPID_PUBLIC_KEY:vapid.publicKey,PUSH_VAPID_PRIVATE_KEY:vapid.privateKey,PUSH_VAPID_SUBJECT:vapid.subject},
   getUser:async()=>actor,rpc,...(resolver?{resolver}:{}),
   prepare:(device,config,id)=>{if(!isFcmEndpoint(device.endpoint))throw Error('INVALID_DEVICE');return preparePush(device,config,id)},
   send:async(details,dns)=>diagnostics.capture(await (await prepareTransport(details,dns,signal))()),
  })
  try{
   const response=await handler(new Request(url,{method:'POST',signal,headers:{authorization:`Bearer ${internal}.${authorization.slice(7)}`},body:JSON.stringify(body)}))
   const result=diagnostics.enrich(await response.json())
   const codes={PUSH_TEST_READY:'device:ready',PUSH_TEST_CLOSED:'device:closed',PUSH_TEST_NOT_READY:'device:registration-or-consent',PUSH_TEST_NOT_ALLOWED:'rights:permit-refused',INVALID_SUBSCRIPTION:'vapid:subscription-invalid',PUSH_TEST_ACCEPTED:'fcm:accepted',PUSH_TEST_NOT_CONFIRMED:'fcm:rejected',PUSH_TEST_UNCERTAIN:'attempt:unknown'}
   // Shared sender validates legacy fields; the request-local Node bridge adds only fixed categories.
   return reply(response.status,codes[result.error]||'attempt:refused',{
    ...(result.permitId?{permitId:result.permitId,expiresAt:result.expiresAt}:{}),
    ...(result.diagnostic?{diagnostic:result.diagnostic}:{}),
   })
  }catch{return reply(503,'attempt:unknown')}
 }
}
export const handleSessionPush=createSessionPushHandler()
