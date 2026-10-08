import { useEffect, useState } from 'react'
import { adminRequest, AdminError } from './admin-client'
import type { AuthSession } from './auth-client'
export function AdminUserDetails({ user, session, t, fields, onDenied }: any) {
  const [favorites, setFavorites] = useState<any[] | null>(null)
  const [details, setDetails] = useState<any>(null)
  const [failed, setFailed] = useState(false)
  const [copy, setCopy] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setDetails(null); setFavorites(null); setFailed(false); setCopy('')
    void (async () => {
      const result = await adminRequest(session as AuthSession, 'users', { id: user.id }, controller.signal)
      if (!result.users?.[0]) throw new Error('USER_NOT_FOUND')
      if (!controller.signal.aborted) setDetails(result.users[0])
      return adminRequest(session as AuthSession, 'favorites', { id: user.id }, controller.signal)
    })().then(value => {
      if (!controller.signal.aborted) { if (!Array.isArray(value)) throw new Error(); setFavorites(value) }
    }).catch(error => { if (!controller.signal.aborted) { setFailed(true); if (error instanceof AdminError && [401,403].includes(error.status)) onDenied(error.status) } })
    return () => controller.abort()
  }, [user.id, session, onDenied])
  return <section className="admin-detail" aria-label={t.details}><h3>{t.details}</h3>{!details && <p role="status">{failed ? t.error : t.loading}</p>}<dl className="admin-detail-grid">{(details ? fields(details) : []).map(([label, value]: any) => <div key={label}><dt>{label}</dt><dd>{value || t.unavailable}</dd></div>)}<div><dt>UUID</dt><dd><details><summary>{user.id.slice(0,8)}…{user.id.slice(-4)}</summary><code>{user.id}</code></details><button onClick={async () => { try { await navigator.clipboard.writeText(user.id); setCopy(t.copied) } catch { setCopy(t.copyFailed) } }}>{t.copy}</button><span role="status">{copy}</span></dd></div></dl><h4>{t.favorites}</h4><p>{t.favoritesLimit}</p>{failed ? <p role="alert">{t.favoritesError}</p> : favorites === null ? <p role="status">{t.loading}</p> : favorites.length ? <ul>{favorites.map(place => <li key={place.id}><strong>{place.name}</strong>{[place.region, place.country].filter(Boolean).length > 0 && <span> · {[place.region, place.country].filter(Boolean).join(', ')}</span>}</li>)}</ul> : <p>{t.noFavorites}</p>}</section>
}
