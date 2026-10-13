import { useState } from 'react'

// The parent keys this presentation by forecast and advice; generation stays in App.
export function WeatherAdvice({ advice, lang }: { advice: string, lang: 'bg' | 'en' }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`weather-advice${expanded ? ' is-expanded' : ''}`} style={{ marginTop: '12px', marginBottom: '12px', padding: '12px 16px', background: 'rgba(255,255,255,0.15)', borderRadius: '8px', fontStyle: 'italic', fontSize: '0.95rem', lineHeight: '1.4' }}>
      🤖 <strong>{lang === 'bg' ? 'Метео съвет:' : 'Meteo advice:'}</strong>{' '}<span id="current-weather-advice" className="weather-advice-text">{advice}</span>
      <button type="button" className="advice-toggle" aria-expanded={expanded} aria-controls="current-weather-advice" onClick={() => setExpanded(value => !value)}>
        {lang === 'bg' ? (expanded ? 'Прибери съвета' : 'Прочети целия съвет') : (expanded ? 'Collapse advice' : 'Read full advice')}
      </button>
    </div>
  )
}
