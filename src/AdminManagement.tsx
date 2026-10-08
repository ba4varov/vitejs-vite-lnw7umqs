import { AdminAuditEntry, localDate } from './AdminPresentation'
import { useEffect, useRef, useState } from 'react'
import { adminMutation, adminRequest, AdminError } from './admin-client'

export function AdminManagement({ user, session, t, onDenied, onChanged }: any) {
  const [expandedHistory, setExpandedHistory] = useState(false)
  const [account, setAccount] = useState<any>(null)
  const [state, setState] = useState('loading')
  const [pending, setPending] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false; abort.current?.abort() } }, [])
  useEffect(() => {
    const controller = new AbortController(); setState('loading'); setAccount(null)
    // Audited plan/access/history read (user_management_view), separate from identity and favorites.
    adminRequest(session, 'management-account', { id: user.id }, controller.signal).then(value => {
      if (value && (!Array.isArray(value.history) || typeof value.canManagePlan !== 'boolean')) throw new Error('INVALID_RESPONSE'); if (!controller.signal.aborted) { setAccount(value); setState(value ? 'ok' : 'error') }
    }).catch(error => { if (!controller.signal.aborted) { setState(error.configurationMissing ? 'missing' : 'error'); if (error instanceof AdminError && [401,403].includes(error.status)) onDenied(error.status) } })
    return () => controller.abort()
  }, [session, user.id, revision, onDenied])
  useEffect(() => { if (pending) dialog.current?.showModal(); else dialog.current?.close() }, [pending])
  const begin = () => {
    setMessage(''); setPending({ action: 'plan', targetId: user.id, plan: account.plan === 'free' ? 'pro' : 'free', expectedPlan: account.plan, requestId: crypto.randomUUID(), confirmed: true })
  }
  const submit = async () => {
    if (inFlight.current || !pending) return
    inFlight.current = true; setBusy(true); setMessage('')
    const controller = new AbortController(); abort.current = controller
    // A timeout may occur after commit. Retrying this same dialog reuses requestId.
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      await adminMutation(session, pending, controller.signal)
      if (!live.current) return
      setPending(null); setMessage(t.planSuccess); setRevision(value => value + 1); onChanged()
    } catch (error) {
      if (!live.current) return
      if (error instanceof AdminError && [401,403].includes(error.status)) { onDenied(error.status); return }
      const code = error instanceof AdminError ? error.code : 'RESULT_UNCONFIRMED'
      setMessage(t[code] || t.RESULT_UNCONFIRMED)
      if (error instanceof AdminError && error.configurationMissing) setState('missing')
    } finally { clearTimeout(timer); inFlight.current = false; if (live.current) setBusy(false) }
  }
  return <section className="admin-management" aria-label={t.management}><h3>{t.management}</h3>
    {state === 'loading' && <p role="status">{t.loading}</p>}
    {state === 'missing' && <p role="status">{t.stage4Missing}</p>}
    {state === 'error' && <p role="alert">{t.error} <button onClick={() => setRevision(value => value + 1)}>{t.retry}</button></p>}
    {state === 'ok' && account && <><dl className="admin-detail-grid"><div><dt>{t.accessStatus}</dt><dd>{account.blocked ? t.blocked : t.active}{account.isAdmin && ` · ${t.adminAccount}`}</dd></div><div><dt>{t.plan}</dt><dd><span className={`admin-badge admin-plan-${account.plan}`}>{t[account.plan] || t.unavailable}</span>{account.manualPro && ` · ${t.manualPro}`}</dd></div><div><dt>{t.subscriptionStatus}</dt><dd>{t[account.subscriptionStatus] || account.subscriptionStatus || t.unavailable}</dd></div></dl>
      {account.bannedUntil && <p>{t.bannedUntil}: {localDate(account.bannedUntil, t)}</p>}
      <p className="admin-note">{t.manualNote}</p><button disabled={!account.canManagePlan || busy} onClick={begin}>{account.plan === 'free' ? t.grantPro : t.restoreFree}</button>
      {!account.canManagePlan && <p>{t.protectedSubscription}</p>}
      <div className="admin-blocking"><button disabled aria-describedby={`blocking-${user.id}`}>{account.blocked ? t.restoreAccess : t.blockAccount}</button><details id={`blocking-${user.id}`}><summary>{t.blockUnavailableTitle}</summary><p>{t.blockUnavailable}</p></details></div>
      <h4>{t.accountHistory}</h4><p>{t.historyLimit}</p>{account.history.length ? <><div className="admin-history" id={`history-${user.id}`}>{(expandedHistory ? account.history : account.history.slice(0,3)).map((entry: any) => <AdminAuditEntry key={entry.id} entry={entry} t={t}/>)}</div>{account.history.length > 3 && <button aria-expanded={expandedHistory} aria-controls={`history-${user.id}`} onClick={() => setExpandedHistory(!expandedHistory)}>{expandedHistory ? t.hideHistory : t.showHistory} ({account.history.length})</button>}</> : <p>{t.auditEmpty}</p>}
    </>}
    {!pending && message && <p role="status">{message}</p>}
    <dialog ref={dialog} aria-labelledby={`confirm-${user.id}`} onCancel={event => { if (busy) event.preventDefault(); else setPending(null) }}>
      <h3 id={`confirm-${user.id}`}>{t.confirmPlan}</h3><p>{user.email}</p><p>{t[pending?.expectedPlan]} → {t[pending?.plan]}</p><p>{t.manualNote}</p>
      {message && <p role="alert">{message}</p>}<div className="admin-pagination"><button autoFocus disabled={busy} onClick={() => setPending(null)}>{t.cancel}</button><button disabled={busy} onClick={() => void submit()}>{busy ? t.executing : t.confirm}</button></div>
    </dialog>
  </section>
}

export function AdminManagementSummary({ session, t, onDenied }: any) {
  const [data, setData] = useState<any>(null)
  const [state, setState] = useState('loading')
  useEffect(() => {
    const controller = new AbortController()
    adminRequest(session, 'management-summary', {}, controller.signal).then(value => { if (!value || !Array.isArray(value.entries) || !value.asOf) throw new Error('INVALID_RESPONSE'); if (!controller.signal.aborted) { setData(value); setState('ok') } })
      .catch(error => { if (!controller.signal.aborted) { setState(error.configurationMissing ? 'missing' : 'error'); if (error instanceof AdminError && [401,403].includes(error.status)) onDenied(error.status) } })
    return () => controller.abort()
  }, [session, onDenied])
  return <section className="admin-card"><h3>{t.managementSnapshot}</h3>{state !== 'ok' ? <p role="status">{state === 'missing' ? t.stage4Missing : state === 'loading' ? t.loading : t.error}</p> : <><p>{t.blockedCount}: <strong>{data.blocked ?? t.unavailable}</strong></p><p>{t.summaryScope}</p><p>{t.checked}: {localDate(data.asOf,t)}</p><h4>{t.recentActions}</h4>{data.entries?.length ? <div className="admin-history">{data.entries.slice(0,5).map((entry: any) => <AdminAuditEntry key={entry.id} entry={entry} t={t}/>)}</div> : <p>{t.auditEmpty}</p>}</>}</section>
}
