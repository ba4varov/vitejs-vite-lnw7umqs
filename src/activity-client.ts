import { restoreSession, subscribeSession, type AuthSession } from './auth-client'
import { createActivityTracker } from './activity-tracker.js'
export async function activityRequest(session: AuthSession, method = 'GET', body?: object) {
  const response = await fetch(body && 'onboarding' in body ? '/api/activity?onboarding=1' : '/api/activity', {method,headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},...(method !== 'GET' && body ? {body:JSON.stringify(body)} : {}),cache:'no-store',signal:AbortSignal.timeout(5000)})
  if (!response.ok) throw new Error('ACTIVITY_UNAVAILABLE')
  return response.json()
}
const tracker = createActivityTracker({ request:activityRequest, getSession:restoreSession })
let currentId: string | null = null, version = 0
export async function loadActivityConsent(session: AuthSession) {
  const ticket = ++version
  const value = await activityRequest(session)
  if (ticket === version && currentId === session.user.id) tracker.apply(currentId,value)
  return value
}
subscribeSession(session => {
  const id = session?.user.id || null
  if (id === currentId) return
  currentId = id; version++; tracker.reset(id)
  if (session) void loadActivityConsent(session).catch(() => {})
})
export async function setActivityConsent(session: AuthSession, enabled: boolean, onboarding = false) {
  version++; tracker.invalidate() // Stop immediately, including during an unsuccessful withdrawal.
  const active = await restoreSession()
  if (!active || active.user.id !== session.user.id) throw new Error('INVALID_SESSION')
  const value = await activityRequest(active,'PATCH',{enabled,...(onboarding ? {onboarding:true} : {})})
  if (currentId === active.user.id) tracker.apply(currentId,value)
  try { localStorage.setItem('meteo-activity-consent-changed',crypto.randomUUID()) } catch { /* Server remains authoritative. */ }
  return value
}
window.addEventListener('storage',event => {
  if (event.key !== 'meteo-activity-consent-changed') return
  version++; tracker.invalidate()
  void restoreSession().then(session => session && loadActivityConsent(session)).catch(() => {})
})
export const trackActivity = (action: string) => { void tracker.track(action) }

export async function claimActivityOffer(session: AuthSession) {
  const active = await restoreSession()
  if (!active || active.user.id !== session.user.id) throw new Error('INVALID_SESSION')
  return activityRequest(active,'POST',{onboarding:'offer'})
}
