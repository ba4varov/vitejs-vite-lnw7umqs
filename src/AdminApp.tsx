import { useCallback, useEffect, useRef, useState } from 'react'
import { restoreSession, signOut, subscribeSession, type AuthSession } from './auth-client'
import { adminRequest, AdminError } from './admin-client'
import { AuthPanel } from './AuthPanel'
import { loadLanguage, saveLanguage } from './language-storage.js'
import { adminText } from './admin-i18n.js'
import './AdminApp.css'
import { AdminUserDetails } from './AdminUserDetails'
import { AdminSystemStatus } from './AdminSystemStatus'
import { AdminAnalytics, AdminAudit } from './AdminAnalytics'
import { AdminRegistrationChart } from './AdminRegistrationChart'

export default function AdminApp() {
  const [lang, setLang] = useState<'bg' | 'en'>(() => loadLanguage())
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('meteo-admin-theme') === 'dark' } catch { return false } })
  const [session, setSession] = useState<AuthSession | null>(null)
  const [ready, setReady] = useState(false)
  const [section, setSection] = useState('dashboard')
  const [status, setStatus] = useState('loading')
  const [identity, setIdentity] = useState<any>(null)
  const [data, setData] = useState<any>(null)
  const [loadedSection, setLoadedSection] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<any>(null)
  const [period, setPeriod] = useState('30')
  const [filter, setFilter] = useState('')
  const [retry, setRetry] = useState(0)
  const [lastSuccess, setLastSuccess] = useState<Record<string, string>>({})
  const onDenied = useCallback((code: number) => { setStatus(code === 401 ? 'expired' : 'forbidden'); setData(null); setSelected(null); setIdentity(null); setLastSuccess({}) }, [])
  const sessionUser = useRef<string | null>(null)
  const t = adminText[lang]
  useEffect(() => {
    let live = true
    const unsubscribe = subscribeSession(value => {
      // Token rotation must not trigger background health checks. adminRequest
      // reads the active token itself; account changes and logout still clear data.
      if (value && sessionUser.current === value.user.id) return
      sessionUser.current = value?.user.id || null
      setSession(value); setLastSuccess({}); setData(null); setIdentity(null)
      setSelected(null); setStatus(value ? 'loading' : 'login')
    })
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
            section === 'dashboard' ? 'stats' : section === 'users' ? 'users' : section === 'analytics' ? 'analytics' : section === 'audit' ? 'audit' : 'system',
            section === 'users' ? { search, page: String(page) } : ['analytics','audit'].includes(section) ? { period, filter, page: String(page) } : {}, controller.signal)
          if (!controller.signal.aborted) { if (section === 'system') setLastSuccess(previous => ({ ...previous, ...Object.fromEntries((result.checks || []).filter((check: any) => check.available).map((check: any) => [check.service, check.checkedAt])) })); setIdentity(access); setData(result); setLoadedSection(section); setStatus('ok') }
        } catch (error) {
          if (!controller.signal.aborted) setStatus(error instanceof AdminError && error.status === 403 ? 'forbidden' : error instanceof AdminError && error.status === 401 ? 'expired' : error instanceof AdminError && error.configurationMissing ? 'configuration' : 'error')
        }
      })()
    }, section === 'users' ? 250 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [session, section, search, page, retry, period, filter])
  const date = (value: string) => value ? new Date(value).toLocaleString(lang === 'bg' ? 'bg-BG' : 'en-GB') : t.unavailable
  const fields = (user: any) => [ [t.email, user.email], [t.name, user.display_name], [t.created, date(user.created_at)], [t.lastLogin, date(user.last_sign_in_at)], [t.provider, user.providers?.map((value: string) => t[value] || value).join(', ')], [t.plan, t[user.plan] || user.plan] ]
  const permitted = status === 'ok' && identity && session && loadedSection === section
  return <div className={`admin-app${dark ? ' admin-dark' : ''}`}>
    <aside><a className="admin-brand" href="/">☀ Meteo Puls</a><p>{t.readonly}</p><nav aria-label={t.title}>
      {['dashboard', 'users', 'analytics', 'audit', 'system', 'profile'].map(key => <button key={key} aria-current={section === key ? 'page' : undefined} onClick={() => { setSection(key); setPage(1) }}>{t[key]}</button>)}
    </nav><a href="/">← {t.back}</a>{session && <button onClick={() => void signOut(session)}>{t.logout}</button>}</aside>
    <main><header><h1>{t.title}</h1><div><button onClick={() => { const next = lang === 'bg' ? 'en' : 'bg'; setLang(next); saveLanguage(next) }}>{lang === 'bg' ? 'EN' : 'БГ'}</button><button aria-label={t.theme} onClick={() => { setDark(!dark); try { localStorage.setItem('meteo-admin-theme', dark ? 'light' : 'dark') } catch { /* optional storage */ } }}>{dark ? '☀' : '☾'}</button></div></header>
      {(!ready || status === 'loading') && <p role="status">{t.loading}</p>}
      {ready && ['login', 'expired'].includes(status) && <section className="admin-card"><p>{status === 'expired' ? t.expired : t.login}</p><AuthPanel lang={lang} /></section>}
      {status === 'forbidden' && <p role="alert">{t.forbidden}</p>}
      {status === 'configuration' && <p role="alert">{t.configuration}</p>}
      {status === 'error' && <section role="alert"><p>{t.error}</p><button onClick={() => setRetry(retry + 1)}>{t.retry}</button></section>}
      {session && identity && <h2>{t[section]}</h2>}
      {session && identity && section === 'users' && <label className="admin-search">{t.search}<input type="search" value={search} maxLength={254} onChange={event => { setSearch(event.target.value); setPage(1) }} /></label>}
      {session && identity && ['analytics','audit'].includes(section) && <div className="admin-filters"><label>{t.period}<select aria-label={t.period} value={period} onChange={e => { setPeriod(e.target.value); setPage(1) }}>{[['7','days7'],['30','days30'],['90','days90'],['12m','months12']].map(([value,label]) => <option key={value} value={value}>{t[label]}</option>)}</select></label>{section === 'audit' && <label>{t.action}<select aria-label={t.action} value={filter} onChange={e => { setFilter(e.target.value); setPage(1) }}>{['','user_details_view','user_favorites_view'].map(value => <option key={value} value={value}>{t[value] || t.allActions}</option>)}</select></label>}</div>}
      {permitted && <>
        {section === 'analytics' && <AdminAnalytics data={data} t={t} />}
        {section === 'audit' && <AdminAudit data={data} t={t} page={page} setPage={setPage} />}
        {section === 'dashboard' && <><div className="admin-stats">{['total', 'last7', 'last30', 'favorites', 'free', 'pro'].map(key => <section className="admin-card" key={key}><p>{t[key]}</p><strong>{data[key] ?? t.unavailable}</strong></section>)}</div><AdminRegistrationChart registrations={data.registrations} title={t.chart} details={t.details} scrollHint={t.chartScroll} /><p>Supabase: {t.connected}</p></>}
        {section === 'users' && <section className="admin-card"><p>{data.total} · {t.page} {page}</p><div className="admin-table"><table><thead><tr>{[t.email, t.created, t.lastLogin, t.provider, t.plan].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.users.map((user: any) => <tr key={user.id}><td><button onClick={() => setSelected(user)}>{user.email || t.unavailable}</button></td><td>{date(user.created_at)}</td><td>{date(user.last_sign_in_at)}</td><td>{user.providers?.map((value: string) => t[value] || value).join(', ') || t.unavailable}</td><td>{t[user.plan] || user.plan || t.unavailable}</td></tr>)}</tbody></table></div>{!data.users.length && <p>{t.empty}</p>}<div className="admin-pagination"><button disabled={page === 1} onClick={() => setPage(page - 1)}>{t.previous}</button><button disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>{t.next}</button></div>{selected && <><AdminUserDetails key={selected.id} user={selected} session={session} t={t} fields={fields} onDenied={onDenied} /><button onClick={() => setSelected(null)}>{t.close}</button></>}</section>}
        {section === 'system' && <AdminSystemStatus data={data} t={t} date={date} lastSuccess={lastSuccess} onRetry={() => setRetry(retry + 1)} />}
        {section === 'profile' && <section className="admin-card"><p>{t.email}: {identity.email}</p><p>UUID: {identity.id}</p><p>{t.readonly}</p></section>}
      </>}
    </main>
  </div>
}
