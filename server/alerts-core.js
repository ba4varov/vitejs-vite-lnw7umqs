import {authenticate} from './profile-core.js'
import {validatePlannerInput} from './planner-logic.js'
import {forecastRisks,activityAlerts,activityKinds,alertKinds} from './alerts-logic.js'
const exact=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).every(k=>keys.includes(k))
export function validAlertScope(scope) {
  if(!exact(scope,['locationKey','zone']) || typeof scope.locationKey!=='string' || !/^[-0-9:]{1,32}$/.test(scope.locationKey) || typeof scope.zone!=='string' || scope.zone.length>64) return false
  try {new Intl.DateTimeFormat('en',{timeZone:scope.zone}).format(0);return true}catch{return false}
}
export async function handleAlerts(req,res,env=process.env,fetcher=fetch,now=Date.now()) {
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization')
  if(!['GET','PATCH','POST','DELETE'].includes(req.method)) return res.status(405).json({error:'METHOD_NOT_ALLOWED'})
  const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_ANON_KEY
  if(!base || !key)return res.status(503).json({error:'ALERTS_UNAVAILABLE'})
  try {
    const limited=(url,options)=>fetcher(url,{...options,signal:AbortSignal.timeout(5000)})
    if(!await authenticate(base,key,req.headers.authorization,limited))return res.status(401).json({error:'INVALID_SESSION'})
    if(JSON.stringify(req.body||{}).length>24000 || Number(req.headers['content-length']||0)>24000)return res.status(413).json({error:'BODY_TOO_LARGE'})
    const query=req.query||{}
    if(!exact(query,['locationKey','zone']))return res.status(400).json({error:'INVALID_SCOPE'})
    let scope=Object.keys(query).length?query:null,payload
    if(scope && !validAlertScope(scope))return res.status(400).json({error:'INVALID_SCOPE'})
    if(req.method==='GET')payload={operation:'load'}
    if(req.method==='DELETE') {if(!scope)return res.status(400).json({error:'SCOPE_REQUIRED'});payload={operation:'clear'}}
    if(req.method==='PATCH') {
      if(!exact(req.body,['enabled','readKey','hideKey']) || Object.keys(req.body).length!==1)return res.status(400).json({error:'INVALID_BODY'})
      if(req.body.enabled!==undefined) {
        if(!Array.isArray(req.body.enabled)||req.body.enabled.length>8||new Set(req.body.enabled).size!==req.body.enabled.length||!req.body.enabled.every(k=>alertKinds.includes(k)))return res.status(400).json({error:'INVALID_BODY'})
        payload={operation:'settings',enabled:req.body.enabled}
      } else {
        if(!scope)return res.status(400).json({error:'SCOPE_REQUIRED'})
        const eventKey=req.body.readKey??req.body.hideKey
        if(typeof eventKey!=='string'||eventKey.length>300)return res.status(400).json({error:'INVALID_BODY'})
        payload={operation:req.body.readKey!==undefined?'read':'hide',key:eventKey}
      }
    }
    if(req.method==='POST') {
      const b=req.body
      if(Object.keys(query).length || !exact(b,['city','locationKey','forecast']) || typeof b.city!=='string'||!b.city.trim()||b.city.length>100||!validatePlannerInput({...b.forecast,activity:'walk'}))return res.status(400).json({error:'INVALID_BODY'})
      scope={locationKey:b.locationKey,zone:b.forecast.timeZone}
      if(!validAlertScope(scope))return res.status(400).json({error:'INVALID_SCOPE'})
    }
    const rpc=p=>limited(`${base}/rest/v1/rpc/my_alerts`,{method:'POST',headers:{apikey:key,Authorization:req.headers.authorization,'Content-Type':'application/json'},body:JSON.stringify({payload:p})})
    const respondFailure=async response=>{
      const error=await response.json().catch(()=>({}))
      if(error.message==='ALERTS_RATE_LIMITED'){res.setHeader('Retry-After','3');return res.status(429).json({error:'ALERTS_RATE_LIMITED'})}
      return res.status(response.status===401?401:response.status===403?403:503).json({error:'ALERTS_UNAVAILABLE'})
    }
    // Capability gate prevents a new client from clearing all cities against old SQL.
    const snapshot=await rpc({operation:'load',...scope})
    if(!snapshot.ok)return respondFailure(snapshot)
    const settings=await snapshot.json()
    if(settings.contractVersion!==2)return res.status(503).json({error:'ALERTS_MIGRATION_REQUIRED'})
    if(req.method==='GET')return res.status(200).json(settings)
    if(req.method==='POST') {
      const b=req.body
      const activities=settings.pro?activityAlerts(b.forecast,settings.enabled.filter(k=>activityKinds.includes(k)),now):[]
      payload={operation:'generate',city:b.city.trim(),events:[...forecastRisks(b.forecast,now),...activities]}
    }
    // SQL rechecks current rights and serializes scope generation/mutations.
    const response=await rpc({...payload,...scope})
    if(!response.ok)return respondFailure(response)
    return res.status(200).json(await response.json())
  }catch{return res.status(503).json({error:'ALERTS_UNAVAILABLE'})}
}
