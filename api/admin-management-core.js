import { authenticate } from './profile-core.js'
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
const safeErrors = new Set(['REQUEST_CONFLICT','SUBSCRIPTION_MISSING','EXTERNAL_SUBSCRIPTION_PROTECTED','STALE_PLAN','PLAN_UNCHANGED'])
export async function handleAdminManagement(req, res, env = process.env, fetcher = fetch) {
  res.setHeader('Cache-Control','private, no-store'); res.setHeader('Vary','Authorization')
  if (req.method !== 'POST') return res.status(405).json({error:'METHOD_NOT_ALLOWED'})
  const base = env.SUPABASE_URL?.replace(/\/$/, ''), key = env.SUPABASE_ANON_KEY
  if (!base || !key) return res.status(503).json({error:'NOT_CONFIGURED'})
  try {
    const authorization = req.headers.authorization
    const timedFetch = (url, options) => fetcher(url,{...options,signal:AbortSignal.timeout(10000)})
    const user = await authenticate(base,key,authorization,timedFetch)
    if (!user?.id) return res.status(401).json({error:'INVALID_SESSION'})
    const rpc = (name, body) => timedFetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(body)})
    const access = await rpc('is_meteo_admin',{})
    if (!access.ok || await access.json() !== true) return res.status(access.status===401?401:403).json({error:'FORBIDDEN'})
    if (['block','restore'].includes(req.body?.action)) return res.status(503).json({error:'BLOCKING_UNAVAILABLE'})
    const b = req.body
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k=>!['action','targetId','plan','expectedPlan','requestId','confirmed'].includes(k)) ||
      !uuid(b.targetId) || !uuid(b.requestId) || !['free','pro'].includes(b.plan) || !['free','pro'].includes(b.expectedPlan) || b.confirmed !== true || b.action !== 'plan')
      return res.status(400).json({error:'INVALID_INPUT'})
    const response = await rpc('admin_set_manual_plan',{target_id:b.targetId,desired_plan:b.plan,expected_plan:b.expectedPlan,operation_id:b.requestId})
    const result = await response.json().catch(()=>({}))
    if (!response.ok) return res.status(result.code==='PGRST202'?503:response.status===401?401:response.status===403?403:safeErrors.has(result.message)?409:503)
      .json({error:result.code==='PGRST202'?'ADMIN_CONFIGURATION_MISSING':safeErrors.has(result.message)?result.message:'ADMIN_UNAVAILABLE'})
    if (result.confirmed !== true || result.plan !== b.plan || typeof result.changedAt !== 'string') return res.status(503).json({error:'RESULT_UNCONFIRMED'})
    return res.status(200).json(result)
  } catch { return res.status(503).json({error:'RESULT_UNCONFIRMED'}) }
}
