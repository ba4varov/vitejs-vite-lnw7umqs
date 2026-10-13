import {timingSafeEqual} from 'node:crypto'
import {Buffer} from 'node:buffer'
import {createTestHandler,validVapid,validateDevice} from './push-test.mjs'
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v)
const reply=(status,error,fields={})=>new Response(JSON.stringify({error,deliveryEnabled:false,...fields}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
async function bodyOf(req){
 const reader=req.body?.getReader();if(!reader)throw Error('INVALID_REQUEST')
 let size=0;const chunks=[];let timer
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('BODY_TIMEOUT')),2000)})
 try{
  while(true){const part=await Promise.race([reader.read(),timeout]);if(part.done)break
   size+=part.value.length;if(size>1024)throw Error('BODY_LIMIT');chunks.push(Buffer.from(part.value))}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('INVALID_REQUEST')
  return body
 }finally{clearTimeout(timer);void reader.cancel().catch(()=>{})}
}
// Public entrypoint: operator possession + live Auth session + selected DB membership.
export function createOperatorHandler(deps){
 const {env,rpc,getUser}=deps,deliver=createTestHandler(deps)
 return async req=>{
  if(env.PUSH_TEST_DELIVERY_ENABLED!=='true')return reply(503,'PUSH_TEST_DISABLED')
  if(req.method!=='POST')return reply(405,'METHOD_NOT_ALLOWED')
  if(req.headers.has('origin')||new URL(req.url).search)return reply(400,'INVALID_REQUEST')
  const token=env.PUSH_TEST_OPERATOR_TOKEN||'',authorization=req.headers.get('authorization')||''
  if(!/^[A-Za-z0-9_-]{43,128}$/.test(token))return reply(503,'PUSH_TEST_UNCONFIGURED')
  // Both credentials stay in the standard redacted Authorization header, never body/logs.
  const match=authorization.length<=10000&&/^Bearer ([A-Za-z0-9_-]{43,128})\.([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization)
  if(!match||match[1].length!==token.length||!timingSafeEqual(Buffer.from(match[1]),Buffer.from(token)))return reply(401,'UNAUTHORIZED')
  let actor,body
  try{actor=await getUser(match[2]);if(!uuid(actor?.id))return reply(401,'INVALID_SESSION')}
  catch{return reply(401,'INVALID_SESSION')}
  try{if(await rpc('push_operator_access',{actor_id:actor.id})!==true)return reply(403,'FORBIDDEN')}
  catch{return reply(503,'OPERATOR_UNAVAILABLE')}
  try{body=await bodyOf(req)}catch{return reply(400,'INVALID_REQUEST')}
  const config={publicKey:env.PUSH_VAPID_PUBLIC_KEY,privateKey:env.PUSH_VAPID_PRIVATE_KEY,subject:env.PUSH_VAPID_SUBJECT}
  if(!validVapid(config.publicKey,config.privateKey,config.subject))return reply(503,'PUSH_TEST_UNCONFIGURED')
  const exactly=keys=>Object.keys(body).length===keys.length&&Object.keys(body).every(k=>keys.includes(k))
  if(body.operation==='prepare'){
   if(!exactly(['operation','userId','deviceId','category','requestId'])||![body.userId,body.deviceId,body.requestId].every(uuid)||!['rain','storm','wind','cold','heat','walk','garden','sport'].includes(body.category))return reply(400,'INVALID_REQUEST')
   let prepared
   try{
    prepared=await rpc('prepare_push_operator',{actor_id:actor.id,target_user:body.userId,target_device:body.deviceId,test_category:body.category,request_id:body.requestId})
    if(!uuid(prepared?.permitId)||prepared.userId!==body.userId||prepared.deviceId!==body.deviceId||prepared.category!==body.category)throw Error('NOT_READY')
    const device=await rpc('inspect_push_operator',{actor_id:actor.id,permit_id:prepared.permitId})
    validateDevice(device,config,prepared.permitId)
    return reply(200,'PUSH_TEST_READY',{permitId:prepared.permitId,userId:body.userId,deviceId:body.deviceId,category:body.category,expiresAt:prepared.expiresAt})
   }catch{
    if(uuid(prepared?.permitId))try{await rpc('cancel_push_operator',{actor_id:actor.id,permit_id:prepared.permitId})}catch{/* Revoked preparation expires in DB. */}
    return reply(409,'PUSH_TEST_NOT_READY')
   }
  }
  if(body.operation==='cancel'&&exactly(['operation','permitId'])&&uuid(body.permitId)){
   try{if(await rpc('cancel_push_operator',{actor_id:actor.id,permit_id:body.permitId})!==true)throw Error('CANCEL_FAILED');return reply(200,'PUSH_TEST_CLOSED')}
   catch{return reply(409,'PUSH_TEST_NOT_ALLOWED')}
  }
  if(body.operation!=='send'||!exactly(['operation','permitId','confirmation'])||!uuid(body.permitId)||typeof body.confirmation!=='string'||body.confirmation.length>100)return reply(400,'INVALID_REQUEST')
  try{
   if(await rpc('arm_push_operator',{actor_id:actor.id,permit_id:body.permitId,confirmation:body.confirmation})!==true)return reply(409,'PUSH_TEST_NOT_ALLOWED')
  }catch{
   try{await rpc('cancel_push_operator',{actor_id:actor.id,permit_id:body.permitId})}catch{/* Bounded DB lease fails closed even if arm result was lost. */}
   return reply(409,'PUSH_TEST_NOT_ALLOWED')
  }
  // Only this route reaches the legacy guarded sender, once, after atomic arm.
  return deliver(new Request(req.url,{method:'POST',headers:{authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({permitId:body.permitId})}))
 }
}
