import {authenticate} from './profile-core.js'
import {exactObject,validPushSubscription,validPushPreferences} from './push-validation.js'
export async function handlePush(req,res,env=process.env,fetcher=fetch) {
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization')
 if(!['GET','POST','PATCH','DELETE'].includes(req.method))return res.status(405).json({error:'METHOD_NOT_ALLOWED'})
 const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_ANON_KEY
 if(!base||!key)return res.status(503).json({error:'PUSH_UNAVAILABLE'})
 try {
  const limited=(url,options)=>fetcher(url,{...options,signal:AbortSignal.timeout(5000),redirect:'error'})
  if(!await authenticate(base,key,req.headers.authorization,limited))return res.status(401).json({error:'INVALID_SESSION'})
  if(Object.keys(req.query||{}).length)return res.status(400).json({error:'INVALID_QUERY'})
  if(JSON.stringify(req.body||{}).length>10000||Number(req.headers['content-length']||0)>10000)return res.status(413).json({error:'BODY_TOO_LARGE'})
  let payload={operation:'load'}
  if(req.method==='POST') {
   if(env.PUSH_REGISTRATION_ENABLED!=='true'||!(/^[A-Za-z0-9_-]{87}$/.test(env.PUSH_VAPID_PUBLIC_KEY||''))||Buffer.from(env.PUSH_VAPID_PUBLIC_KEY,'base64url')[0]!==4)return res.status(503).json({error:'PUSH_REGISTRATION_DISABLED'})
   if(!exactObject(req.body,['subscription','label'])||!validPushSubscription(req.body.subscription)||typeof req.body.label!=='string'||!req.body.label.trim()||req.body.label.length>80)return res.status(400).json({error:'INVALID_BODY'})
   payload={operation:'register',...req.body}
  }
  if(req.method==='PATCH') {
   if(!validPushPreferences(req.body))return res.status(400).json({error:'INVALID_BODY'})
   payload={operation:'settings',...req.body}
  }
  if(req.method==='DELETE') {
   if(!exactObject(req.body,['id'])||typeof req.body.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(req.body.id))return res.status(400).json({error:'INVALID_BODY'})
   payload={operation:'delete',id:req.body.id}
  }
  const response=await limited(`${base}/rest/v1/rpc/my_push`,{method:'POST',headers:{apikey:key,Authorization:req.headers.authorization,'Content-Type':'application/json'},body:JSON.stringify({payload})})
  if(!response.ok) {
   const error=await response.json().catch(()=>({}))
   const status=error.message==='PUSH_RATE_LIMITED'?429:response.status===403?403:503
   if(status===429)res.setHeader('Retry-After','3')
   return res.status(status).json({error:status===429?'PUSH_RATE_LIMITED':status===403?'PUSH_FORBIDDEN':'PUSH_UNAVAILABLE'})
  }
  const data=await response.json()
  if(data.contractVersion!==1)return res.status(503).json({error:'PUSH_MIGRATION_REQUIRED'})
  const publicKey=env.PUSH_VAPID_PUBLIC_KEY||''
  const registrationEnabled=env.PUSH_REGISTRATION_ENABLED==='true' && /^[A-Za-z0-9_-]{87}$/.test(publicKey) && Buffer.from(publicKey,'base64url')[0]===4
  return res.status(200).json({...data,registrationEnabled,publicKey:registrationEnabled?publicKey:null,deliveryEnabled:false})
 }catch{return res.status(503).json({error:'PUSH_UNAVAILABLE'})}
}
