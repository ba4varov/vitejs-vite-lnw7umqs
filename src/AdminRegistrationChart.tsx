import { useState } from 'react'

type Registration = { date: string; count: number }
export function AdminRegistrationChart({ registrations, title, details, scrollHint, emptyLabel }: {
  registrations: Registration[]; title: string; details: string; scrollHint: string; emptyLabel: string
}) {
  const [selected, setSelected] = useState<Registration | null>(null)
  if (!Array.isArray(registrations) || !registrations.length) return <section className="admin-card"><h3>{title}</h3><p>{emptyLabel}</p></section>
  const maximum = Math.max(1, ...registrations.map(day => day.count))
  return <section className="admin-card">
    <h3>{title}</h3>
    <p className="admin-chart-hint">{scrollHint}</p>
    <div className="admin-chart-scroll" tabIndex={0} role="region" aria-label={title}>
      <div className="admin-chart">
        {registrations.map(day => <button className="admin-chart-day" key={day.date}
          title={`${day.date}: ${day.count}`} aria-label={`${day.date}: ${day.count}`}
          aria-pressed={selected?.date === day.date} onClick={() => setSelected(day)}>
          <span className="admin-chart-bar-area"><span className="admin-chart-bar" style={{ height: `${day.count / maximum * 160}px` }} /></span>
          <span className="admin-chart-date">{day.date.slice(8)}.{day.date.slice(5, 7)}</span>
        </button>)}
      </div>
    </div>
    <p className="admin-chart-value" role="status">{selected ? `${selected.date}: ${selected.count}` : '\u00a0'}</p>
    <details><summary>{details}</summary><ul>{registrations.map(day => <li key={day.date}>{day.date}: {day.count}</li>)}</ul></details>
  </section>
}
