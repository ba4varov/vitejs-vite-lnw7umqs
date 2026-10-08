import { AdminAuditEntry } from './AdminPresentation'
import { useState, type CSSProperties } from 'react'
const bucketDate = (value: string, t: any) => {
  const date = new Date(value + 'T00:00:00Z')
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(t.locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}
type Item = { label: string; count: number }
export function AdminMetricChart({ title, items, t, temporal = false }: { title: string; items: Item[]; t: any; temporal?: boolean }) {
  const [selected, setSelected] = useState<Item | null>(null)
  const maximum = Math.max(1, ...items.map(item => item.count))
  return <section className="admin-card"><h3>{title}</h3>
    {!items.length ? <p>{t.emptyChart}</p> : <><p className="admin-chart-hint">{temporal && t.seriesScroll}</p><div className={`admin-metric-chart${temporal ? ' admin-metric-time' : ''}`} tabIndex={0} role="group" aria-label={title}>{items.map(item => <button key={item.label} aria-label={`${temporal ? bucketDate(item.label,t) : item.label}: ${item.count}`} aria-pressed={selected?.label === item.label} onClick={() => setSelected(item)} onFocus={() => setSelected(item)} onMouseEnter={() => setSelected(item)}><span>{temporal ? bucketDate(item.label,t) : item.label}</span><span className="admin-metric-track"><span style={{width:`${item.count / maximum * 100}%`, '--bar-height': `${item.count / maximum * 100}%`} as CSSProperties} /></span><strong>{item.count > 0 ? item.count : ''}</strong></button>)}</div></>}
    <p role="status">{selected ? `${temporal ? bucketDate(selected.label,t) : selected.label}: ${selected.count}` : '\u00a0'}</p>
  </section>
}
export function AdminAnalytics({ data, t }: any) {
  return <><div className="admin-stats">{['total','last7','last30','login7','login30','noLogin30','favorites','uniqueCities'].map(key => <section className="admin-card" key={key}><p>{t[key]}</p><strong>{data[key]}</strong></section>)}</div>
    <p>{t.loginNote}</p><p>{t.snapshot}</p>
    <div className="admin-analytics-grid">
      <AdminMetricChart key={`registrations-${data.period}`} temporal title={t.registrationSeries} items={data.buckets.map((b: any) => ({label:b.date,count:b.registrations}))} t={t} />
      <AdminMetricChart key={`logins-${data.period}`} temporal title={t.loginSeries} items={data.buckets.map((b: any) => ({label:b.date,count:b.last_logins}))} t={t} />
      <AdminMetricChart title={t.plans} items={['free','pro','unknownPlan'].map(key => ({label:t[key],count:data[key]}))} t={t} />
      <AdminMetricChart title={t.cities} items={data.cities.map((c: any) => ({label:[c.name,c.region,c.country,`${c.latitude_key}, ${c.longitude_key}`].filter(Boolean).join(' · '),count:c.count}))} t={t} />
    </div><section className="admin-card"><h3>{t.future}</h3><p>{t.futureNote}</p></section></>
}
export function AdminAudit({ data, t, page, setPage }: any) {
  return <section className="admin-card"><p>{data.total} · {t.page} {page}</p>
    {!data.entries.length ? <p>{t.auditEmpty}</p> : <div className="admin-audit-table">{data.entries.map((entry: any) => <AdminAuditEntry key={entry.id} entry={entry} t={t}/>)}</div>}
    <div className="admin-pagination"><button disabled={page === 1} onClick={() => setPage(page-1)}>{t.previous}</button><button disabled={page * data.pageSize >= data.total} onClick={() => setPage(page+1)}>{t.next}</button></div>
  </section>
}
