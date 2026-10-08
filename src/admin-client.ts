import { restoreSession, type AuthSession } from './auth-client'
export class AdminError extends Error { status: number; configurationMissing = false; code = 'ADMIN_REQUEST_FAILED'; constructor(status: number) { super('ADMIN_REQUEST_FAILED'); this.status = status } }
export async function adminRequest(session: AuthSession, action = 'access', params: Record<string, string> = {}, signal?: AbortSignal) {
  const active = await restoreSession()
  if (!active || active.user.id !== session.user.id) throw new AdminError(401)
  const response = await fetch(`/api/admin?${new URLSearchParams({ action, ...params })}`, {
    headers: { Authorization: `Bearer ${active.access_token}` }, cache: 'no-store', signal,
  })
  if (!response.ok) { const error = new AdminError(response.status); error.configurationMissing = (await response.json().catch(() => ({}))).error === 'ADMIN_CONFIGURATION_MISSING'; throw error }
  return response.json()
}

export async function adminMutation(session: AuthSession, body: Record<string, unknown>, signal?: AbortSignal) {
  const active = await restoreSession()
  if (!active || active.user.id !== session.user.id) throw new AdminError(401)
  const response = await fetch('/api/admin-management', { method: 'POST', headers: { Authorization: `Bearer ${active.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || result.confirmed !== true) { const error = new AdminError(response.ok ? 503 : response.status); error.code = result.error || 'RESULT_UNCONFIRMED'; error.configurationMissing = result.error === 'ADMIN_CONFIGURATION_MISSING'; throw error }
  return result
}
