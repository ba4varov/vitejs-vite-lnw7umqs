import {transportStage} from '../src/push-key-stages.js'
const statuses=['match','mismatch','missing','unavailable']
const unavailable={p256dh:'unavailable',auth:'unavailable'}
export const validKeyDiagnostic=result=>result&&Object.keys(result).length===2&&['p256dh','auth'].every(k=>statuses.includes(result[k]))
export async function handlePushKeyDiagnostics(req,res,env=process.env,fetcher=fetch) {
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization')
 const reply=(status,diagnostic,keys=unavailable)=>res.status(status).json({keys,diagnostic})
 let stage='auth'
 if(req.method!=='POST')return reply(405,'api:method')
 const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_ANON_KEY
 if(!base||!key)return reply(503,'api:configuration')
 const limited=(url,options)=>fetcher(url,{...options,signal:AbortSignal.timeout(5000),redirect:'error'})
 try {
  if(!req.headers.authorization?.startsWith('Bearer '))return reply(401,'auth:rejected')
  const auth=await limited(`${base}/auth/v1/user`,{headers:{apikey:key,Authorization:req.headers.authorization}})
  if(!auth.ok)return [401,403].includes(auth.status)?reply(401,'auth:rejected'):reply(503,'auth:http')
  let user
  try{user=await auth.json()}catch{return reply(503,'auth:response')}
  if(typeof user?.id!=='string'||!user.id)return reply(503,'auth:response')
  stage='api'
  const b=req.body,fields=['deviceId','fingerprint','nonce','p256dh','auth']
  if(Object.keys(req.query||{}).length||!b||Array.isArray(b)||Object.keys(b).length!==fields.length||Object.keys(b).some(k=>!fields.includes(k))||JSON.stringify(b).length>1024||Number(req.headers['content-length']||0)>1024)return reply(400,'api:input')
  const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
  const proof=value=>hex(value)||value==='missing'||value==='unavailable'
  if(typeof b.deviceId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(b.deviceId)||!hex(b.fingerprint)||!hex(b.nonce)||!proof(b.p256dh)||!proof(b.auth))return reply(400,'api:input')
  stage='rpc'
  const response=await limited(`${base}/rest/v1/rpc/check_my_push_keys`,{method:'POST',headers:{apikey:key,Authorization:req.headers.authorization,'Content-Type':'application/json'},body:JSON.stringify({device_id:b.deviceId,endpoint_fingerprint:b.fingerprint,nonce_hex:b.nonce,p256dh_proof:b.p256dh,auth_proof:b.auth})})
  if(!response.ok){
   let code
   try{code=(await response.json())?.code}catch{/* Non-JSON gateway response. */}
   const known={PGRST202:'rpc:schema-cache','42501':'rpc:sql-permission','42702':'rpc:sql-ambiguous','42883':'rpc:sql-function'}
   return reply(503,(Object.hasOwn(known,code)?known[code]:null)||({401:'rpc:unauthorized',403:'rpc:forbidden',404:'rpc:not-found'})[response.status]||'rpc:rejected')
  }
  let result
  try{result=await response.json()}catch{return reply(503,'rpc:response')}
  // Construct a fresh response; never forward arbitrary RPC fields or errors.
  if(!validKeyDiagnostic(result))return reply(503,'rpc:response')
  return reply(200,Object.values(result).includes('unavailable')?'rpc:result-unavailable':'rpc:complete',{p256dh:result.p256dh,auth:result.auth})
 }catch(error){return reply(503,stage==='api'?'api:input':transportStage(stage,error))}
}
