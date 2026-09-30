export type AuthUser = { id: string; email?: string; email_confirmed_at?: string }
export type AuthSession = { access_token: string; refresh_token: string; expires_at?: number; user: AuthUser }

const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
const storageKey = 'meteo-pulse-auth'

export const authConfigured = Boolean(url && key)

async function request(path: string, body?: object, token?: string, method?: string) {
  if (!authConfigured) throw new Error('AUTH_NOT_CONFIGURED')
  const headers = { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  const response = body
    ? await fetch(`${url}/auth/v1${path}`, { method: method || 'POST', headers, body: JSON.stringify(body) })
    : await fetch(`${url}/auth/v1${path}`, { method: method || 'GET', headers })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || 'AUTH_FAILED')
  return data
}

export function saveSession(session: AuthSession | null) {
  try {
    if (session) localStorage.setItem(storageKey, JSON.stringify(session))
    else localStorage.removeItem(storageKey)
  } catch {
    // Authentication still works for the current page when browser storage is blocked.
  }
}

export async function restoreSession(): Promise<AuthSession | null> {
  let stored: AuthSession | null = null
  try { stored = JSON.parse(localStorage.getItem(storageKey) || 'null') } catch { saveSession(null) }
  if (!stored?.refresh_token) return null
  try {
    const data = await request('/token?grant_type=refresh_token', { refresh_token: stored.refresh_token })
    saveSession(data); return data
  } catch { saveSession(null); return null }
}

export async function signUp(email: string, password: string, redirectTo: string) {
  return request(`/signup?redirect_to=${encodeURIComponent(redirectTo)}`, { email, password })
}
export async function signIn(email: string, password: string): Promise<AuthSession> {
  const data = await request('/token?grant_type=password', { email, password }); saveSession(data); return data
}
export async function resendConfirmation(email: string, redirectTo: string) {
  return request('/resend', { type: 'signup', email, options: { emailRedirectTo: redirectTo } })
}
export async function resetPassword(email: string, redirectTo: string) {
  return request(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { email })
}
export async function updatePassword(token: string, password: string) { return request('/user', { password }, token, 'PUT') }
export async function signOut(session: AuthSession) {
  try { await request('/logout', {}, session.access_token) } finally { saveSession(null) }
}

export function consumeAuthHash(): (Partial<AuthSession> & { type?: string }) | null {
  const params = new URLSearchParams(location.hash.slice(1))
  if (!params.get('access_token')) return null
  const expiresIn = Number(params.get('expires_in') || 3600)
  const partial = { access_token: params.get('access_token')!, refresh_token: params.get('refresh_token')!, expires_at: Math.floor(Date.now() / 1000) + expiresIn, type: params.get('type') || undefined }
  history.replaceState({}, '', location.pathname + location.search)
  return partial
}

export async function getUser(token: string): Promise<AuthUser> { return request('/user', undefined, token) }

export async function profileRequest(session: AuthSession, method = 'GET', name?: string) {
  const headers = { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
  const response = method === 'PATCH'
    ? await fetch('/api/profile', { method: 'PATCH', headers, body: JSON.stringify({ name }) })
    : await fetch('/api/profile', { method: 'GET', headers })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'PROFILE_FAILED')
  return data
}
