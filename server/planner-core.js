import { authenticate } from './profile-core.js'
import { validatePlannerInput, calculatePlanner } from './planner-logic.js'

export async function handlePlanner(req, res, env=process.env, fetcher=fetch, now=Date.now()) {
  res.setHeader('Cache-Control','private, no-store')
  res.setHeader('Vary','Authorization')
  if(req.method!=='POST') return res.status(405).json({error:'METHOD_NOT_ALLOWED'})
  if(typeof req.headers.authorization!=='string' || !req.headers.authorization.startsWith('Bearer ')) return res.status(401).json({error:'INVALID_SESSION'})
  const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_ANON_KEY
  if(!base || !key) return res.status(503).json({error:'PLANNER_UNAVAILABLE'})
  try {
    const limitedFetch=(url,options)=>fetcher(url,{...options,signal:AbortSignal.timeout(5000)})
    const user=await authenticate(base,key,req.headers.authorization,limitedFetch)
    if(!user?.id) return res.status(401).json({error:'INVALID_SESSION'})
    const response=await limitedFetch(`${base}/rest/v1/rpc/get_my_entitlements`,{method:'POST',headers:{apikey:key,Authorization:req.headers.authorization,'Content-Type':'application/json'},body:'{}'})
    if(!response.ok) return res.status(response.status===401?401:503).json({error:'PLANNER_UNAVAILABLE'})
    const data=await response.json(), entitlement=Array.isArray(data)?data[0]:data
    if(entitlement?.plan!=='pro' || !Array.isArray(entitlement.permissions) || !entitlement.permissions.includes('planner:advanced')) return res.status(403).json({error:'PRO_REQUIRED'})
    const declared=req.headers['content-length']
    if(declared!==undefined && (!/^\d+$/.test(String(declared)) || Number(declared)>24000)) return res.status(413).json({error:'BODY_TOO_LARGE'})
    if(JSON.stringify(req.body)?.length>24000) return res.status(413).json({error:'BODY_TOO_LARGE'})
    if(!validatePlannerInput(req.body)) return res.status(400).json({error:'INVALID_BODY'})
    return res.status(200).json(calculatePlanner(req.body,now))
  } catch { return res.status(503).json({error:'PLANNER_UNAVAILABLE'}) }
}
