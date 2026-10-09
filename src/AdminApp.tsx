import { AdminIcon } from './AdminIcon'
import { useCallback, useEffect, useRef, useState } from 'react'
import { restoreSession, signOut, subscribeSession, type AuthSession } from './auth-client'
import { adminRequest, AdminError } from './admin-client'
import { AuthPanel } from './AuthPanel'
import { loadLanguage, saveLanguage } from './language-storage.js'
import { adminText } from './admin-i18n.js'
import './AdminApp.css'
import { CopyUuid, localDate } from './AdminPresentation'
import { AdminManagement, AdminManagementSummary } from './AdminManagement'
import { AdminUserDetails } from './AdminUserDetails'
import { AdminSystemStatus } from './AdminSystemStatus'
import { AdminAnalytics, AdminAudit } from './AdminAnalytics'
import { AdminActivity } from './AdminActivity'
import { AdminRegistrationChart } from './AdminRegistrationChart'

export default function AdminApp() {
  const [lang, setLang] = useState<'bg' | 'en'>(() => loadLanguage())
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('meteo-admin-theme') === 'dark' } catch { return false } })
  const [session, setSession] = useState<AuthSession | null>(null)
  const [ready, setReady] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [section, setSection] = useState('dashboard')
  const [status, setStatus] = useState('loading')
  const [identity, setIdentity] = useState<any>(null)
  const [data, setData] = useState<any>(null)
  const [loadedSection, setLoadedSection] = useState('')
  const [search, setSearch] = useState('')
  const [userFilters, setUserFilters] = useState({ status: '', plan: '', from: '', to: '' })
  const [mutationMessage, setMutationMessage] = useState(false)
  const [managementMissing, setManagementMissing] = useState(false)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<any>(null)
  const [period, setPeriod] = useState('30')
  const [filter, setFilter] = useState('')
  const [retry, setRetry] = useState(0)
  const [lastSuccess, setLastSuccess] = useState<Record<string, string>>({})
  const onDenied = useCallback((code: number) => { setMutationMessage(false); setStatus(code === 401 ? 'expired' : 'forbidden'); setData(null); setSelected(null); setIdentity(null); setLastSuccess({}) }, [])
  const navigation = useRef<HTMLElement>(null)
  const sectionHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (menuOpen) navigation.current?.querySelector('button')?.focus() }, [menuOpen])
  useEffect(() => { sectionHeading.current?.focus() }, [section])
  const sessionUser = useRef<string | null>(null)
  const t = adminText[lang]
  useEffect(() => {
    let live = true
    const unsubscribe = subscribeSession(value => {
      // Token rotation must not trigger background health checks. adminRequest
      // reads the active token itself; account changes and logout still clear data.
      if (value && sessionUser.current === value.user.id) return
      sessionUser.current = value?.user.id || null
      setMutationMessage(false); setSession(value); setLastSuccess({}); setData(null); setIdentity(null)
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
          let result = ['profile','activity'].includes(section) ? access : await adminRequest(session,
            section === 'dashboard' ? 'stats' : section === 'users' ? 'users' : section === 'analytics' ? 'analytics' : section === 'audit' ? 'audit' : 'system',
            section === 'users' ? { search, page: String(page) } : ['analytics','audit'].includes(section) ? { period, filter, page: String(page) } : {}, controller.signal)
          if (section === 'users') {
            try { result = await adminRequest(session, 'management-users', { search, page: String(page), ...userFilters }, controller.signal); if (!Array.isArray(result.users)) throw new Error('INVALID_RESPONSE'); if (!controller.signal.aborted) setManagementMissing(false) }
            catch (error) { if (!(error instanceof AdminError && error.configurationMissing)) throw error; if (!controller.signal.aborted) setManagementMissing(true) }
          }
          if (!controller.signal.aborted) { if (section === 'system') setLastSuccess(previous => ({ ...previous, ...Object.fromEntries((result.checks || []).filter((check: any) => check.available).map((check: any) => [check.service, check.checkedAt])) })); setIdentity(access); setData(result); setLoadedSection(section); setStatus('ok') }
        } catch (error) {
          if (!controller.signal.aborted) setStatus(error instanceof AdminError && error.status === 403 ? 'forbidden' : error instanceof AdminError && error.status === 401 ? 'expired' : error instanceof AdminError && error.configurationMissing ? 'configuration' : 'error')
        }
      })()
    }, section === 'users' ? 250 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [session, section, search, page, retry, period, filter, userFilters])
  const date = (value: string) => localDate(value, t)
  const fields = (user: any) => [ [t.email, user.email], [t.name, user.display_name], [t.created, date(user.created_at)], [t.lastLogin, date(user.last_sign_in_at)], [t.provider, user.providers?.map((value: string) => t[value] || value).join(', ')], [t.plan, t[user.plan] || user.plan] ]
  const permitted = status === 'ok' && identity && session && loadedSection === section
  return <div lang={lang} className={`admin-app${dark ? ' admin-dark' : ''}`}>
    <aside id="admin-navigation" className={menuOpen ? 'admin-nav-open' : ''}><a className="admin-brand" href="/">☀ Meteo Puls</a><p>{t.management}</p><nav ref={navigation} aria-label={t.title}>
      {['dashboard', 'users', 'analytics', 'activity', 'audit', 'system', 'profile'].map(key => <button key={key} aria-current={section === key ? 'page' : undefined} onClick={() => { setMenuOpen(false); setMutationMessage(false); setSection(key); setPage(1) }}><AdminIcon name={key}/>{t[key]}</button>)}
    </nav><a href="/">← {t.back}</a>{session && <button onClick={() => void signOut(session)}>{t.logout}</button>}</aside>
    <main><header><div className="admin-heading"><button className="admin-menu-toggle" aria-controls="admin-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{t.menu}</button><h1>{t.title}</h1></div><div><button onClick={() => { const next = lang === 'bg' ? 'en' : 'bg'; setLang(next); saveLanguage(next) }}>{lang === 'bg' ? 'EN' : 'БГ'}</button><button aria-label={t.theme} onClick={() => { setDark(!dark); try { localStorage.setItem('meteo-admin-theme', dark ? 'light' : 'dark') } catch { /* optional storage */ } }}>{dark ? '☀' : '☾'}</button></div></header>
      {(!ready || status === 'loading') && <p role="status">{t.loading}</p>}
      {ready && ['login', 'expired'].includes(status) && <section className="admin-card"><p>{status === 'expired' ? t.expired : t.login}</p><AuthPanel lang={lang} /></section>}
      {status === 'forbidden' && <p role="alert">{t.forbidden}</p>}
      {status === 'configuration' && <p role="alert">{t.configuration}</p>}
      {status === 'error' && <section role="alert"><p>{t.error}</p><button onClick={() => setRetry(retry + 1)}>{t.retry}</button></section>}
      {mutationMessage && permitted && <p role="status">{t.planSuccess}</p>}
      {session && identity && <div className="admin-section-heading"><h2 ref={sectionHeading} tabIndex={-1}>{t[section]}</h2>{section === 'dashboard' && <p>{t.dashboardIntro}</p>}</div>}
      {session && identity && section === 'users' && <label className="admin-search">{t.search}<input type="search" value={search} maxLength={254} onChange={event => { setSearch(event.target.value); setPage(1) }} /></label>}
      {session && identity && section === 'users' && <>{managementMissing ? <p role="status">{t.stage4Missing}</p> : <div className="admin-filters"><label>{t.accessStatus}<select value={userFilters.status} onChange={e => { setUserFilters({ ...userFilters, status: e.target.value }); setPage(1) }}>{['','active','blocked'].map(value => <option key={value} value={value}>{t[value] || t.allStatuses}</option>)}</select></label><label>{t.plan}<select value={userFilters.plan} onChange={e => { setUserFilters({ ...userFilters, plan: e.target.value }); setPage(1) }}>{['','free','pro'].map(value => <option key={value} value={value}>{t[value] || t.allPlans}</option>)}</select></label>{['from','to'].map(key => <label key={key}>{t[key]}<input type="date" value={userFilters[key as 'from' | 'to']} onChange={e => { setUserFilters({ ...userFilters, [key]: e.target.value }); setPage(1) }} /></label>)}</div>}</>}
      {session && identity && ['analytics','audit'].includes(section) && <div className="admin-filters"><label>{t.period}<select aria-label={t.period} value={period} onChange={e => { setPeriod(e.target.value); setPage(1) }}>{[['7','days7'],['30','days30'],['90','days90'],['12m','months12']].map(([value,label]) => <option key={value} value={value}>{t[label]}</option>)}</select></label>{section === 'audit' && <label>{t.action}<select aria-label={t.action} value={filter} onChange={e => { setFilter(e.target.value); setPage(1) }}>{['','user_details_view','user_management_view','user_favorites_view','manual_pro_grant','free_restore','account_block','account_restore'].map(value => <option key={value} value={value}>{t[value] || t.allActions}</option>)}</select></label>}</div>}
      {permitted && <>
        {section === 'activity' && <AdminActivity session={session} lang={lang} onDenied={onDenied} />}
        {section === 'analytics' && <AdminAnalytics data={data} t={t} />}
        {section === 'audit' && <AdminAudit data={data} t={t} page={page} setPage={setPage} />}
        {section === 'dashboard' && <><div className="admin-stats">{['total', 'last7', 'last30', 'favorites', 'free', 'pro'].map(key => <section className="admin-card" key={key}><span className="admin-stat-icon" aria-hidden="true"><AdminIcon name={key}/></span><p>{t[key]}</p><strong>{data[key] ?? t.unavailable}</strong></section>)}</div><AdminRegistrationChart registrations={data.registrations} title={t.chart} details={t.details} scrollHint={t.chartScroll} emptyLabel={t.emptyChart} /><section className="admin-card admin-system-overview"><h3>{t.systemOverview}</h3><p>Supabase: {t.connected}</p><p>{t.dashboardScope}</p><button onClick={() => setSection('system')}>{t.system}</button></section><AdminActivity session={session} lang={lang} summary onDenied={onDenied} /><AdminManagementSummary session={session} t={t} onDenied={onDenied} /></>}
        {section === 'users' && <section className="admin-card"><p>{data.total} · {t.page} {page}</p><div className="admin-table" tabIndex={0} aria-label={t.users}><table><thead><tr>{[t.email, t.name, t.created, t.lastLogin, t.provider, t.plan, t.accessStatus].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.users.map((user: any) => <tr key={user.id}><td><button onClick={() => setSelected(user)}>{user.email || t.unavailable}</button></td><td>{user.display_name || t.unavailable}</td><td>{date(user.created_at)}</td><td>{date(user.last_sign_in_at)}</td><td>{user.providers?.map((value: string) => t[value] || value).join(', ') || t.unavailable}</td><td><span className={`admin-badge admin-plan-${user.plan}`}>{t[user.plan] || user.plan || t.unavailable}</span></td><td>{typeof user.blocked === 'boolean' ? user.blocked ? t.blocked : t.active : t.unavailable}</td></tr>)}</tbody></table></div>{!data.users.length && <p>{t.empty}</p>}<div className="admin-pagination"><button disabled={page === 1} onClick={() => setPage(page - 1)}>{t.previous}</button><button disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>{t.next}</button></div>{selected && <><AdminUserDetails key={selected.id} user={selected} session={session} t={t} fields={fields} onDenied={onDenied} /><AdminManagement key={`management-${selected.id}`} user={selected} session={session} t={t} onDenied={onDenied} onChanged={() => { setMutationMessage(true); setRetry(value => value + 1) }} /><button onClick={() => setSelected(null)}>{t.close}</button></>}</section>}
        {section === 'system' && <AdminSystemStatus data={data} t={t} date={date} lastSuccess={lastSuccess} onRetry={() => setRetry(retry + 1)} />}
        {section === 'profile' && <section className="admin-card"><p>{t.email}: {identity.email}</p><details><summary>UUID · {identity.id.slice(0,8)}…</summary><CopyUuid value={identity.id} t={t}/></details><p>{t.management}</p></section>}
      </>}
    </main>
  </div>
}
