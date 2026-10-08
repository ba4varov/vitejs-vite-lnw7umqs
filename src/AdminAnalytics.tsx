import { useState } from 'react'
type Item = { label: string; count: number }
export function AdminMetricChart({ title, items, t }: { title: string; items: Item[]; t: any }) {
  const [selected, setSelected] = useState<Item | null>(null)
  const maximum = Math.max(1, ...items.map(item => item.count))
  return <section className="admin-card"><h3>{title}</h3>
    {!items.length ? <p>{t.emptyChart}</p> : <div className="admin-metric-chart" role="group" aria-label={title}>{items.map(item => <button key={item.label} aria-label={`${item.label}: ${item.count}`} aria-pressed={selected?.label === item.label} onClick={() => setSelected(item)}><span>{item.label}</span><span className="admin-metric-track"><span style={{width:`${item.count / maximum * 100}%`}} /></span><strong>{item.count}</strong></button>)}</div>}
    <p role="status">{selected ? `${selected.label}: ${selected.count}` : '\u00a0'}</p>
  </section>
}
export function AdminAnalytics({ data, t }: any) {
  return <><div className="admin-stats">{['total','last7','last30','login7','login30','noLogin30','favorites','uniqueCities'].map(key => <section className="admin-card" key={key}><p>{t[key]}</p><strong>{data[key]}</strong></section>)}</div>
    <p>{t.loginNote}</p><p>{t.snapshot}</p>
    <div className="admin-analytics-grid">
      <AdminMetricChart key={`registrations-${data.period}`} title={t.registrationSeries} items={data.buckets.map((b: any) => ({label:b.date,count:b.registrations}))} t={t} />
      <AdminMetricChart key={`logins-${data.period}`} title={t.loginSeries} items={data.buckets.map((b: any) => ({label:b.date,count:b.last_logins}))} t={t} />
      <AdminMetricChart title={t.plans} items={['free','pro','unknownPlan'].map(key => ({label:t[key],count:data[key]}))} t={t} />
      <AdminMetricChart title={t.cities} items={data.cities.map((c: any) => ({label:[c.name,c.region,c.country,`${c.latitude_key}, ${c.longitude_key}`].filter(Boolean).join(' · '),count:c.count}))} t={t} />
    </div><section className="admin-card"><h3>{t.future}</h3><p>{t.futureNote}</p></section></>
}
export function AdminAudit({ data, t, page, setPage }: any) {
  return <section className="admin-card"><p>{data.total} · {t.page} {page}</p>
    {!data.entries.length ? <p>{t.auditEmpty}</p> : <div className="admin-table admin-audit-table"><table><thead><tr>{[t.utc,t.actor,t.action,t.object,t.outcome].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.entries.map((entry: any) => <tr key={entry.id}><td data-label={t.utc}>{new Date(entry.occurred_at).toISOString()}</td><td data-label={t.actor}><code>{entry.admin_id}</code></td><td data-label={t.action}>{t[entry.action]}</td><td data-label={t.object}><code>{entry.object_id}</code></td><td data-label={t.outcome}>{t[entry.outcome]}</td></tr>)}</tbody></table></div>}
    <div className="admin-pagination"><button disabled={page === 1} onClick={() => setPage(page-1)}>{t.previous}</button><button disabled={page * data.pageSize >= data.total} onClick={() => setPage(page+1)}>{t.next}</button></div>
  </section>
}
