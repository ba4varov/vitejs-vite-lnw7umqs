import {authenticate} from './profile-core.js'
const statuses=['match','mismatch','missing','unavailable']
const unavailable={p256dh:'unavailable',auth:'unavailable'}
export const validKeyDiagnostic=result=>result&&Object.keys(result).length===2&&['p256dh','auth'].every(k=>statuses.includes(result[k]))
export async function handlePushKeyDiagnostics(req,res,env=process.env,fetcher=fetch) {
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization')
 const reply=(status,keys=unavailable)=>res.status(status).json({keys})
 if(req.method!=='POST')return reply(405)
 const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_ANON_KEY
 if(!base||!key)return reply(503)
 const limited=(url,options)=>fetcher(url,{...options,signal:AbortSignal.timeout(5000),redirect:'error'})
 try {
  if(!await authenticate(base,key,req.headers.authorization,limited))return reply(401)
  const b=req.body,fields=['deviceId','fingerprint','nonce','p256dh','auth']
  if(Object.keys(req.query||{}).length||!b||Array.isArray(b)||Object.keys(b).length!==fields.length||Object.keys(b).some(k=>!fields.includes(k))||JSON.stringify(b).length>1024||Number(req.headers['content-length']||0)>1024)return reply(400)
  const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
  const proof=value=>hex(value)||value==='missing'||value==='unavailable'
  if(typeof b.deviceId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(b.deviceId)||!hex(b.fingerprint)||!hex(b.nonce)||!proof(b.p256dh)||!proof(b.auth))return reply(400)
  const response=await limited(`${base}/rest/v1/rpc/check_my_push_keys`,{method:'POST',headers:{apikey:key,Authorization:req.headers.authorization,'Content-Type':'application/json'},body:JSON.stringify({device_id:b.deviceId,endpoint_fingerprint:b.fingerprint,nonce_hex:b.nonce,p256dh_proof:b.p256dh,auth_proof:b.auth})})
  if(!response.ok)return reply(503)
  const result=await response.json()
  // Construct a fresh response; never forward arbitrary RPC fields or errors.
  if(!validKeyDiagnostic(result))return reply(503)
  return reply(200,{p256dh:result.p256dh,auth:result.auth})
 }catch{return reply(503)}
}
