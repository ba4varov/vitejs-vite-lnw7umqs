import {authenticate} from './profile-core.js'
import {validatePlannerInput} from './planner-logic.js'
import {forecastRisks,activityAlerts,activityKinds,alertKinds} from './alerts-logic.js'
const exact=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).every(k=>keys.includes(k))
export async function handleAlerts(req,res,env=process.env,fetcher=fetch,now=Date.now()) {
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization')
  if(!['GET','PATCH','POST','DELETE'].includes(req.method)) return res.status(405).json({error:'METHOD_NOT_ALLOWED'})
  const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_ANON_KEY
  if(!base || !key)return res.status(503).json({error:'ALERTS_UNAVAILABLE'})
  try {
    const limited=(url,options)=>fetcher(url,{...options,signal:AbortSignal.timeout(5000)})
    if(!await authenticate(base,key,req.headers.authorization,limited))return res.status(401).json({error:'INVALID_SESSION'})
    if(JSON.stringify(req.body||{}).length>24000 || Number(req.headers['content-length']||0)>24000)return res.status(413).json({error:'BODY_TOO_LARGE'})
    let payload
    if(req.method==='GET') payload={operation:'load'}
    if(req.method==='DELETE')payload={operation:'clear'}
    if(req.method==='PATCH') {
      if(!exact(req.body,['enabled','readKey','hideKey']) || Object.keys(req.body).length!==1)return res.status(400).json({error:'INVALID_BODY'})
      if(req.body.enabled!==undefined) {
        if(!Array.isArray(req.body.enabled)||req.body.enabled.length>8||new Set(req.body.enabled).size!==req.body.enabled.length||!req.body.enabled.every(k=>alertKinds.includes(k)))return res.status(400).json({error:'INVALID_BODY'})
        payload={operation:'settings',enabled:req.body.enabled}
      } else {
        const key=req.body.readKey??req.body.hideKey
        if(typeof key!=='string'||key.length>300)return res.status(400).json({error:'INVALID_BODY'})
        payload={operation:req.body.readKey!==undefined?'read':'hide',key}
      }
    }
    if(req.method==='POST') {
      const b=req.body
      if(!exact(b,['city','locationKey','forecast']) || typeof b.locationKey!=='string'||!/^[-0-9:]{1,32}$/.test(b.locationKey)||typeof b.city!=='string'||!b.city.trim()||b.city.length>100||!validatePlannerInput({...b.forecast,activity:'walk'}))return res.status(400).json({error:'INVALID_BODY'})
      // Fetch current settings and rights; SQL checks them again atomically at insert.
      const snapshot=await limited(`${base}/rest/v1/rpc/my_alerts`,{method:'POST',headers:{apikey:key,Authorization:req.headers.authorization,'Content-Type':'application/json'},body:JSON.stringify({payload:{operation:'load'}})})
      if(!snapshot.ok)return res.status(snapshot.status===401?401:503).json({error:'ALERTS_UNAVAILABLE'})
      const settings=await snapshot.json()
      const activities=settings.pro?activityAlerts(b.forecast,settings.enabled.filter(k=>activityKinds.includes(k)),now):[]
      payload={operation:'generate',city:b.city.trim(),locationKey:b.locationKey,zone:b.forecast.timeZone,events:[...forecastRisks(b.forecast,now),...activities]}
    }
    const response=await limited(`${base}/rest/v1/rpc/my_alerts`,{method:'POST',headers:{apikey:key,Authorization:req.headers.authorization,'Content-Type':'application/json'},body:JSON.stringify({payload})})
    if(!response.ok)return res.status(response.status===401?401:response.status===403?403:503).json({error:'ALERTS_UNAVAILABLE'})
    return res.status(200).json(await response.json())
  }catch{return res.status(503).json({error:'ALERTS_UNAVAILABLE'})}
}
