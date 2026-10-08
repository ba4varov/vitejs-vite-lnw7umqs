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
    const user = await authenticate(base, key, authorization, fetcher)
    if (!user?.id) return res.status(401).json({ error: 'INVALID_SESSION' })
    const rpc = async (name, body = {}) => {
      const response = await fetcher(`${base}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: key, Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) {
        const error = new Error('RPC_FAILED')
        error.status = response.status
        throw error
      }
      return response.json()
    }
    if (await rpc('is_meteo_admin') !== true) return res.status(403).json({ error: 'FORBIDDEN' })
    const action = req.query?.action || 'access'
    if (action === 'access') return res.status(200).json({ authorized: true, email: user.email, id: user.id })
    if (action === 'stats') return res.status(200).json(await rpc('admin_statistics'))
    if (action === 'system') {
      await rpc('is_meteo_admin')
      return res.status(200).json({ supabase: 'connected', checkedAt: new Date().toISOString() })
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
    return res.status(error.status === 401 ? 401 : error.status === 403 ? 403 : 503).json({ error: 'ADMIN_UNAVAILABLE' })
  }
}
