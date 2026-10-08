import { withCaptcha } from './captcha-payload.js'

export type AuthUser = { id: string; email?: string; email_confirmed_at?: string }
export type AuthSession = { access_token: string; refresh_token: string; expires_at?: number; user: AuthUser }

const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
const storageKey = 'meteo-pulse-auth'
let currentSession: AuthSession | null = null
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let refreshPromise: Promise<AuthSession | null> | undefined
let revision = 0
const refreshMargin = 60_000
const retryDelay = 30_000

class AuthRequestError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code }
}

function readSession(): AuthSession | null {
  try {
    const session = JSON.parse(localStorage.getItem(storageKey) || 'null')
    return session?.access_token && session?.refresh_token && session?.user?.id ? session : null
  } catch { return currentSession }
}

function scheduleRefresh(delay?: number) {
  clearTimeout(refreshTimer)
  if (!currentSession?.refresh_token || document.visibilityState === 'hidden') return
  const remaining = (currentSession.expires_at || 0) * 1000 - Date.now() - refreshMargin
  refreshTimer = setTimeout(() => { void refreshSession() }, delay ?? Math.max(0, remaining))
}

function applySession(session: AuthSession | null) {
  revision += 1
  currentSession = session
  scheduleRefresh()
  sessionListeners.forEach(listener => listener(session))
}

// Storage events do not write back, so tabs cannot create notification loops.
window.addEventListener('storage', event => {
  if (event.key === storageKey || event.key === null) applySession(readSession())
})
document.addEventListener('visibilitychange', () => scheduleRefresh())
window.addEventListener('online', () => scheduleRefresh())

async function refreshSession(): Promise<AuthSession | null> {
  if (refreshPromise) return refreshPromise
  const refresh = async () => {
    // Another tab may have rotated the refresh token while this tab waited for the lock.
    const stored = readSession()
    if (stored?.refresh_token !== currentSession?.refresh_token) applySession(stored)
    const session = currentSession
    if (!session) return null
    if ((session.expires_at || 0) * 1000 - Date.now() > refreshMargin) {
      scheduleRefresh(); return session
    }
    const startedAt = revision
    try {
      const data = await request('/token?grant_type=refresh_token', { refresh_token: session.refresh_token })
      if (startedAt === revision && readSession()?.refresh_token === session.refresh_token) saveSession(data)
    } catch (error) {
      if (startedAt !== revision || readSession()?.refresh_token !== session.refresh_token) return currentSession
      // Only an explicit invalid/revoked refresh token ends the local session.
      if (error instanceof AuthRequestError && [400, 401, 403].includes(error.status) &&
          ['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'session_expired', 'invalid_grant'].includes(error.code || '')) {
        saveSession(null)
      } else scheduleRefresh(retryDelay)
    }
    return currentSession
  }
  refreshPromise = (navigator.locks
    ? navigator.locks.request(`${storageKey}-refresh`, refresh)
    : refresh()).finally(() => { refreshPromise = undefined })
  return refreshPromise
}
const sessionListeners = new Set<(session: AuthSession | null) => void>()

export const authConfigured = Boolean(url && key)
export const captchaConfigured = Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY)

async function request(path: string, body?: object, token?: string, method?: string) {
  if (!authConfigured) throw new Error('AUTH_NOT_CONFIGURED')
  const headers = { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  const response = body
    ? await fetch(`${url}/auth/v1${path}`, { method: method || 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
    : await fetch(`${url}/auth/v1${path}`, { method: method || 'GET', headers, signal: AbortSignal.timeout(10_000) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new AuthRequestError(data.msg || data.message || data.error_description || 'AUTH_FAILED', response.status, data.error_code || data.code || data.error)
  return data
}

export function saveSession(session: AuthSession | null) {
  try {
    if (session) localStorage.setItem(storageKey, JSON.stringify(session))
    else localStorage.removeItem(storageKey)
  } catch {
    // Authentication still works for the current page when browser storage is blocked.
  }
  applySession(session)
}

/** The single application-wide session source used by auth and user data. */
export function subscribeSession(listener: (session: AuthSession | null) => void) {
  sessionListeners.add(listener)
  listener(currentSession)
  return () => { sessionListeners.delete(listener) }
}

export async function restoreSession(): Promise<AuthSession | null> {
  if (!currentSession) applySession(readSession())
  if (!currentSession) return null
  return refreshSession()
}

export async function signUp(email: string, password: string, redirectTo: string, captchaToken?: string) {
  return request(`/signup?redirect_to=${encodeURIComponent(redirectTo)}`, withCaptcha({ email, password }, captchaToken))
}
export async function signIn(email: string, password: string, captchaToken?: string): Promise<AuthSession> {
  const data = await request('/token?grant_type=password', withCaptcha({ email, password }, captchaToken)); saveSession(data); return data
}
export async function resendConfirmation(email: string, redirectTo: string, captchaToken?: string) {
  return request('/resend', withCaptcha({ type: 'signup', email, options: { emailRedirectTo: redirectTo } }, captchaToken))
}
export async function resetPassword(email: string, redirectTo: string, captchaToken?: string) {
  return request(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, withCaptcha({ email }, captchaToken))
}
export async function updatePassword(token: string, password: string) { return request('/user', { password }, token, 'PUT') }
export async function signOut(session: AuthSession) {
  saveSession(null)
  // Local logout is immediate even when server-side revocation fails or times out.
  try { await request('/logout', {}, session.access_token) } catch { /* Already signed out locally. */ }
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
