import { useState } from 'react'
import { AdminIcon } from './AdminIcon'
type Labels = Record<string, string>
type AuditEntry = { id: string | number; occurred_at: string; admin_id: string; action: string; outcome: string; object_id?: string; previous_value?: string; new_value?: string; reason?: string }
export const shortId = (value: string) => value ? `${value.slice(0,8)}…${value.slice(-4)}` : '—'
export function localDate(value: string, t: Labels) {
  if (!value || Number.isNaN(Date.parse(value))) return t.unavailable
  return new Intl.DateTimeFormat(t.locale, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value)) + ` · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`
}
export function CopyUuid({ value, t }: { value: string; t: Labels }) {
  const [message,setMessage] = useState('')
  return <div className="admin-uuid"><code>{value}</code><button onClick={async()=>{try { await navigator.clipboard.writeText(value);setMessage(t.copied) } catch { setMessage(t.copyFailed) }}}>{t.copy}</button><span role="status">{message}</span></div>
}
export function AdminAuditEntry({ entry, t }: { entry: AuditEntry; t: Labels }) {
  return <details className="admin-audit-entry"><summary><span className="admin-event-icon"><AdminIcon name="audit"/></span><span className="admin-event-main"><strong>{t[entry.action] || entry.action}</strong><time dateTime={entry.occurred_at}>{localDate(entry.occurred_at,t)}</time></span><span className={`admin-badge admin-outcome-${entry.outcome}`}>{t[entry.outcome] || entry.outcome}</span>{entry.object_id && <span className="admin-short-id">{shortId(entry.object_id)}</span>}</summary><div className="admin-event-details"><dl><dt>{t.entryId}</dt><dd>{entry.id}</dd><dt>{t.actionCode}</dt><dd><code>{entry.action}</code></dd><dt>{t.utc}</dt><dd>{entry.occurred_at}</dd><dt>{t.actor}</dt><dd><CopyUuid value={entry.admin_id} t={t}/></dd>{entry.object_id && <><dt>{t.object}</dt><dd><CopyUuid value={entry.object_id} t={t}/></dd></>}{entry.previous_value && <><dt>{t.plan}</dt><dd>{t[entry.previous_value] || entry.previous_value} → {t[entry.new_value] || entry.new_value}</dd></>}{entry.reason && <><dt>{t.reason}</dt><dd>{t[entry.reason] || entry.reason}</dd></>}</dl></div></details>
}
