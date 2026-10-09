import { authenticate } from './profile-core.js'
export const activityActions = ['active','forecast_view','search_complete','chat_use','favorite_add','favorite_remove']
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
export async function handleActivity(req, res, env = process.env, fetcher = fetch) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Vary', 'Authorization')
  if (!['GET','POST','PATCH'].includes(req.method)) return res.status(405).json({error:'METHOD_NOT_ALLOWED'})
  const base = env.SUPABASE_URL?.replace(/\/$/, ''), key = env.SUPABASE_ANON_KEY
  if (!base || !key) return res.status(503).json({error:'ACTIVITY_UNAVAILABLE'})
  try {
    const limitedFetch = (url, options) => fetcher(url, {...options, signal:AbortSignal.timeout(5000)})
    const user = await authenticate(base,key,req.headers.authorization,limitedFetch)
    if (!user?.id) return res.status(401).json({error:'INVALID_SESSION'})
    const body = req.body || {}
    let rpc = 'get_activity_consent', payload = {}
    if (req.method === 'PATCH') {
      if (typeof body.enabled !== 'boolean' || Object.keys(body).some(k => k !== 'enabled')) return res.status(400).json({error:'INVALID_BODY'})
      rpc = 'set_activity_consent'; payload = {desired:body.enabled}
    }
    if (req.method === 'POST') {
      if (!activityActions.includes(body.action) || !uuid(body.operationId) || !uuid(body.revision) || Object.keys(body).some(k => !['action','operationId','revision'].includes(k))) return res.status(400).json({error:'INVALID_BODY'})
      rpc = 'record_activity'; payload = {selected_action:body.action,operation_id:body.operationId,consent_revision:body.revision}
    }
    // Forward the verified user's token. Never accept a user ID or use service-role analytics access.
    const response = await limitedFetch(`${base}/rest/v1/rpc/${rpc}`, {method:'POST',headers:{apikey:key,Authorization:req.headers.authorization,'Content-Type':'application/json'},body:JSON.stringify(payload)})
    if (!response.ok) return res.status(response.status === 401 ? 401 : 503).json({error:'ACTIVITY_UNAVAILABLE'})
    return res.status(200).json(await response.json())
  } catch { return res.status(503).json({error:'ACTIVITY_UNAVAILABLE'}) }
}
