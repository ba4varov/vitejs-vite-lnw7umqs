import { authenticate } from './profile-core.js'

export async function handleAdmin(req, res, env = process.env, fetcher = fetch) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Vary', 'Authorization')
  if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })
  const base = env.SUPABASE_URL?.replace(/\/$/, '')
  const key = env.SUPABASE_ANON_KEY
  if (!base || !key) return res.status(503).json({ error: 'NOT_CONFIGURED' })
  try {
    const authorization = req.headers.authorization
    const user = await authenticate(base, key, authorization, (url, options) => fetcher(url, { ...options, signal: AbortSignal.timeout(10000) }))
    if (!user?.id) return res.status(401).json({ error: 'INVALID_SESSION' })
    const rpc = async (name, body = {}) => {
      const response = await fetcher(`${base}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: key, Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        const error = new Error('RPC_FAILED')
        error.configurationMissing = payload.code === 'PGRST202'
        error.status = response.status
        throw error
      }
      return response.json()
    }
    if (await rpc('is_meteo_admin') !== true) return res.status(403).json({ error: 'FORBIDDEN' })
    const action = req.query?.action || 'access'
    if (action === 'access') return res.status(200).json({ authorized: true, email: user.email, id: user.id })
    if (action === 'analytics' || action === 'audit') {
      const period = req.query?.period || '30'
      const selectedAction = req.query?.filter || ''
      const page = Number(req.query?.page || 1)
      if (!['7','30','90','12m'].includes(period) || typeof selectedAction !== 'string' ||
          !['','user_details_view','user_management_view','user_favorites_view','manual_pro_grant','free_restore','account_block','account_restore'].includes(selectedAction) || (req.query?.page != null && typeof req.query.page !== 'string') || !Number.isInteger(page) || page < 1 || page > 1000000)
        return res.status(400).json({ error: 'INVALID_QUERY' })
      return res.status(200).json(await rpc(action === 'analytics' ? 'admin_advanced_statistics' : 'admin_audit_entries',
        action === 'analytics' ? { period } : { period, selected_action: selectedAction, page_number: page }))
    }
    if (action === 'activity') {
      const period = req.query?.period || '30'
      if (typeof period !== 'string' || !['7','30','90'].includes(period)) return res.status(400).json({ error: 'INVALID_QUERY' })
      return res.status(200).json(await rpc('admin_user_activity', { period: Number(period) }))
    }
    if (action === 'management-summary') return res.status(200).json(await rpc('admin_management_summary'))
    if (action === 'management-account') {
      const id = req.query?.id
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return res.status(400).json({ error: 'INVALID_QUERY' })
      return res.status(200).json(await rpc('admin_management_account', { selected_id: id }))
    }
    if (action === 'management-users') {
      const q = req.query || {}, page = Number(q.page || '1')
      const validDate = value => value == null || value === '' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value)
      if (typeof (q.search || '') !== 'string' || (q.search || '').length > 254 || (q.page != null && typeof q.page !== 'string') || !Number.isInteger(page) || page < 1 || page > 1000000 ||
          !['','active','blocked'].includes(q.status || '') || !['','free','pro'].includes(q.plan || '') || !validDate(q.from) || !validDate(q.to) || (q.from && q.to && q.from > q.to))
        return res.status(400).json({ error: 'INVALID_QUERY' })
      return res.status(200).json(await rpc('admin_management_users', { search_text: q.search || '', page_number: page, access_status: q.status || '', selected_plan: q.plan || '', registered_from: q.from || null, registered_to: q.to || null }))
    }
    if (action === 'stats') return res.status(200).json(await rpc('admin_statistics'))
    if (action === 'system') {
      const probe = async (service, check) => {
        const start = performance.now()
        try {
          await check()
          return { service, available: true, responseMs: Math.round(performance.now() - start), checkedAt: new Date().toISOString(), problem: null }
        } catch (error) {
          if (error.status === 401 || error.status === 403) throw error
          return { service, available: false, responseMs: Math.round(performance.now() - start), checkedAt: new Date().toISOString(), problem: 'CHECK_FAILED' }
        }
      }
      const checks = await Promise.all([
        probe('supabase', async () => { if (await rpc('is_meteo_admin') !== true) { const error = new Error('FORBIDDEN'); error.status = 403; throw error } }),
        probe('admin', async () => { const result = await rpc('admin_users', { search_email: user.email || user.id, page_number: 1, selected_id: null }); if (!Array.isArray(result.users)) throw new Error('INVALID_RESPONSE') }),
        probe('openMeteo', async () => {
          const response = await fetcher('https://api.open-meteo.com/v1/forecast?latitude=42.7&longitude=23.3&current=temperature_2m', { signal: AbortSignal.timeout(8000) })
          if (!response.ok || !Number.isFinite((await response.json()).current?.temperature_2m)) throw new Error('INVALID_RESPONSE')
        }),
      ])
      return res.status(200).json({ checks })
    }
    if (action === 'favorites') {
      const id = req.query?.id
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return res.status(400).json({ error: 'INVALID_QUERY' })
      return res.status(200).json(await rpc('admin_user_favorites', { selected_id: id }))
    }
    if (action === 'users') {
      const search = req.query?.search || ''
      const page = Number(req.query?.page || 1)
      const id = req.query?.id || null
      if (typeof search !== 'string' || search.length > 254 || !Number.isInteger(page) || page < 1 || page > 1000000 ||
          (id !== null && (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))))
        return res.status(400).json({ error: 'INVALID_QUERY' })
      return res.status(200).json(await rpc('admin_users', { search_email: search, page_number: page, selected_id: id }))
    }
    return res.status(400).json({ error: 'INVALID_ACTION' })
  } catch (error) {
    if (error.configurationMissing) return res.status(503).json({ error: 'ADMIN_CONFIGURATION_MISSING' })
    return res.status(error.status === 401 ? 401 : error.status === 403 ? 403 : 503).json({ error: 'ADMIN_UNAVAILABLE' })
  }
}
