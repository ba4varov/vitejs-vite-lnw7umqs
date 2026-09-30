import { authenticate, publicProfile, validDisplayName } from './profile-core.js'

export default async function handler(req: any, res: any) {
  const baseUrl = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!baseUrl || !anonKey || !serviceKey) return res.status(503).json({ error: 'Authentication service is not configured.' })
  const user = await authenticate(baseUrl, anonKey, req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Invalid or expired session.' })
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }
  if (req.method === 'PATCH') {
    if (!validDisplayName(req.body?.name)) return res.status(400).json({ error: 'Invalid name.' })
    const update = await fetch(`${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ display_name: req.body.name.trim() || null }) })
    if (!update.ok) return res.status(500).json({ error: 'Profile update failed.' })
  } else if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' })
  const [profileResponse, entitlementResponse] = await Promise.all([
    fetch(`${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=display_name`, { headers }),
    fetch(`${baseUrl}/rest/v1/rpc/get_my_entitlements`, { method: 'POST', headers, body: JSON.stringify({ requested_user_id: user.id }) }),
  ])
  if (!profileResponse.ok || !entitlementResponse.ok) return res.status(500).json({ error: 'Profile load failed.' })
  const [profiles, entitlement] = await Promise.all([profileResponse.json(), entitlementResponse.json()])
  return res.status(200).json(publicProfile(user, profiles[0], Array.isArray(entitlement) ? entitlement[0] : entitlement))
}
