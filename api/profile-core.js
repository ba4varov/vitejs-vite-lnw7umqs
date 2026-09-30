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
