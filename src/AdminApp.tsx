import { useEffect, useState } from 'react'
import { restoreSession, signOut, subscribeSession, type AuthSession } from './auth-client'
import { adminRequest, AdminError } from './admin-client'
import { AuthPanel } from './AuthPanel'
import { loadLanguage, saveLanguage } from './language-storage.js'
import { adminText } from './admin-i18n.js'
import './AdminApp.css'

export default function AdminApp() {
  const [lang, setLang] = useState<'bg' | 'en'>(() => loadLanguage())
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('meteo-admin-theme') === 'dark' } catch { return false } })
  const [session, setSession] = useState<AuthSession | null>(null)
  const [ready, setReady] = useState(false)
  const [section, setSection] = useState('dashboard')
  const [status, setStatus] = useState('loading')
  const [identity, setIdentity] = useState<any>(null)
  const [data, setData] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<any>(null)
  const [retry, setRetry] = useState(0)
  const t = adminText[lang]
  useEffect(() => {
    let live = true
    const unsubscribe = subscribeSession(value => { setSession(value); setData(null); setIdentity(null); setSelected(null); setStatus(value ? 'loading' : 'login') })
    void restoreSession().finally(() => { if (live) setReady(true) })
    return () => { live = false; unsubscribe() }
  }, [])
  useEffect(() => {
    if (!session) return
    const controller = new AbortController()
    setStatus('loading'); setData(null); setSelected(null)
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const access = await adminRequest(session, 'access', {}, controller.signal)
          const result = section === 'profile' ? access : await adminRequest(session,
            section === 'dashboard' ? 'stats' : section === 'users' ? 'users' : 'system',
            section === 'users' ? { search, page: String(page) } : {}, controller.signal)
          if (!controller.signal.aborted) { setIdentity(access); setData(result); setStatus('ok') }
        } catch (error) {
          if (!controller.signal.aborted) setStatus(error instanceof AdminError && error.status === 403 ? 'forbidden' : error instanceof AdminError && error.status === 401 ? 'expired' : 'error')
        }
      })()
    }, section === 'users' ? 250 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [session, section, search, page, retry])
  const date = (value: string) => value ? new Date(value).toLocaleString(lang === 'bg' ? 'bg-BG' : 'en-GB') : t.unavailable
  const fields = (user: any) => [ [t.email, user.email], [t.name, user.display_name], ['UUID', user.id], [t.created, date(user.created_at)], [t.lastLogin, date(user.last_sign_in_at)], [t.provider, user.providers?.join(', ')], [t.plan, user.plan] ]
  const permitted = status === 'ok' && identity && session
  return <div className={`admin-app${dark ? ' admin-dark' : ''}`}>
    <aside><a className="admin-brand" href="/">☀ Meteo Puls</a><p>{t.readonly}</p><nav aria-label={t.title}>
      {['dashboard', 'users', 'system', 'profile'].map(key => <button key={key} aria-current={section === key ? 'page' : undefined} onClick={() => setSection(key)}>{t[key]}</button>)}
    </nav><a href="/">← {t.back}</a>{session && <button onClick={() => void signOut(session)}>{t.logout}</button>}</aside>
    <main><header><h1>{t.title}</h1><div><button onClick={() => { const next = lang === 'bg' ? 'en' : 'bg'; setLang(next); saveLanguage(next) }}>{lang === 'bg' ? 'EN' : 'БГ'}</button><button aria-label={t.theme} onClick={() => { setDark(!dark); try { localStorage.setItem('meteo-admin-theme', dark ? 'light' : 'dark') } catch { /* optional storage */ } }}>{dark ? '☀' : '☾'}</button></div></header>
      {(!ready || status === 'loading') && <p role="status">{t.loading}</p>}
      {ready && ['login', 'expired'].includes(status) && <section className="admin-card"><p>{status === 'expired' ? t.expired : t.login}</p><AuthPanel lang={lang} /></section>}
      {status === 'forbidden' && <p role="alert">{t.forbidden}</p>}
      {status === 'error' && <section role="alert"><p>{t.error}</p><button onClick={() => setRetry(retry + 1)}>{t.retry}</button></section>}
      {session && identity && section === 'users' && <label>{t.search}<input type="search" value={search} maxLength={254} onChange={event => { setSearch(event.target.value); setPage(1) }} /></label>}
      {permitted && <><h2>{t[section]}</h2>
        {section === 'dashboard' && <><div className="admin-stats">{['total', 'last7', 'last30', 'favorites', 'free', 'pro'].map(key => <section className="admin-card" key={key}><p>{t[key]}</p><strong>{data[key] ?? t.unavailable}</strong></section>)}</div><section className="admin-card"><h3>{t.chart}</h3><div className="admin-chart" role="img" aria-label={t.chart}>{data.registrations.map((item: any) => <div key={item.date} title={`${item.date}: ${item.count}`}><span style={{ height: `${item.count / Math.max(1, ...data.registrations.map((day: any) => day.count)) * 160}px` }} /><small>{item.date.slice(8)}</small></div>)}</div><details><summary>{t.details}</summary><ul>{data.registrations.map((item: any) => <li key={item.date}>{item.date}: {item.count}</li>)}</ul></details></section><p>Supabase: {t.connected}</p></>}
        {section === 'users' && <section className="admin-card"><p>{data.total} · {t.page} {page}</p><div className="admin-table"><table><thead><tr>{[t.email, t.created, t.lastLogin, t.provider, t.plan].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.users.map((user: any) => <tr key={user.id}><td><button onClick={() => setSelected(user)}>{user.email || t.unavailable}</button></td><td>{date(user.created_at)}</td><td>{date(user.last_sign_in_at)}</td><td>{user.providers?.join(', ') || t.unavailable}</td><td>{user.plan || t.unavailable}</td></tr>)}</tbody></table></div>{!data.users.length && <p>{t.empty}</p>}<div className="admin-pagination"><button disabled={page === 1} onClick={() => setPage(page - 1)}>{t.previous}</button><button disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>{t.next}</button></div>{selected && <section className="admin-detail" aria-label={t.details}><h3>{t.details}</h3><dl>{fields(selected).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || t.unavailable}</dd></div>)}</dl><button onClick={() => setSelected(null)}>{t.close}</button></section>}</section>}
        {section === 'system' && <section className="admin-card"><p>Supabase: {t.connected}</p><p>{t.checked}: {date(data.checkedAt)}</p><p>{t.readonly}</p></section>}
        {section === 'profile' && <section className="admin-card"><p>{t.email}: {identity.email}</p><p>UUID: {identity.id}</p><p>{t.readonly}</p></section>}
      </>}
    </main>
  </div>
}
