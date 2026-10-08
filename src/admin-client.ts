import { restoreSession, type AuthSession } from './auth-client'
export class AdminError extends Error { status: number; constructor(status: number) { super('ADMIN_REQUEST_FAILED'); this.status = status } }
export async function adminRequest(session: AuthSession, action = 'access', params: Record<string, string> = {}, signal?: AbortSignal) {
  const active = await restoreSession()
  if (!active || active.user.id !== session.user.id) throw new AdminError(401)
  const response = await fetch(`/api/admin?${new URLSearchParams({ action, ...params })}`, {
    headers: { Authorization: `Bearer ${active.access_token}` }, cache: 'no-store', signal,
  })
  if (!response.ok) throw new AdminError(response.status)
  return response.json()
}
