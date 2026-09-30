export const publicProfile = (user, profile, entitlement) => ({
  id: user.id,
  email: user.email,
  name: profile?.display_name || '',
  plan: entitlement?.plan || 'free',
  permissions: entitlement?.permissions || [],
})

export const validDisplayName = value => typeof value === 'string' && value.trim().length <= 80

export async function authenticate(baseUrl, anonKey, authorization, fetcher = fetch) {
  if (!authorization?.startsWith('Bearer ')) return null
  const response = await fetcher(`${baseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authorization } })
  return response.ok ? response.json() : null
}

export async function handleProfile(req, res, env = process.env, fetcher = fetch) {
  const baseUrl = env.SUPABASE_URL
  const anonKey = env.SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!baseUrl || !anonKey || !serviceKey) return res.status(503).json({ error: 'Authentication service is not configured.' })
  const user = await authenticate(baseUrl, anonKey, req.headers.authorization, fetcher)
  if (!user) return res.status(401).json({ error: 'Invalid or expired session.' })
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }
  const userHeaders = { apikey: anonKey, Authorization: req.headers.authorization, 'Content-Type': 'application/json' }
  const ownProfileUrl = `${baseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}`
  if (req.method === 'PATCH') {
    if (!validDisplayName(req.body?.name)) return res.status(400).json({ error: 'Invalid name.' })
    const update = await fetcher(ownProfileUrl, { method: 'PATCH', headers: { ...serviceHeaders, Prefer: 'return=minimal' }, body: JSON.stringify({ display_name: req.body.name.trim() || null }) })
    if (!update.ok) return res.status(500).json({ error: 'Profile update failed.' })
  } else if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' })
  const [profileResponse, entitlementResponse] = await Promise.all([
    fetcher(`${ownProfileUrl}&select=display_name`, { headers: serviceHeaders }),
    fetcher(`${baseUrl}/rest/v1/rpc/get_my_entitlements`, { method: 'POST', headers: userHeaders, body: '{}' }),
  ])
  if (!profileResponse.ok || !entitlementResponse.ok) return res.status(500).json({ error: 'Profile load failed.' })
  const [profiles, entitlement] = await Promise.all([profileResponse.json(), entitlementResponse.json()])
  return res.status(200).json(publicProfile(user, profiles[0], Array.isArray(entitlement) ? entitlement[0] : entitlement))
}
