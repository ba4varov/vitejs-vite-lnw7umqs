import type { MouseEvent, ReactNode } from 'react'
import { forecastOverview } from './weather-utils.js'

type Props = {
  period: 'hour' | 'day'; item: any; language: 'bg' | 'en'; label: string; date: string;
  icon: ReactNode; selected: boolean; onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function ForecastPeriodCard({ period, item, language, label, date, icon, selected, onClick }: Props) {
  const overview = forecastOverview(item, period, language)
  return <button type="button" className={`forecast-period-card ${period === 'hour' ? 'hour-box' : 'day-box'}`}
    aria-pressed={selected} onClick={onClick} title={overview.explanation}>
    <div data-category="period" className="forecast-period"><strong>{label}</strong><small>{date}</small></div>
    <div data-category="icon" className="forecast-icon" aria-hidden="true">{icon}</div>
    <p data-category="description" className="forecast-condition">{item.description}</p>
    <p data-category="temperature" className="forecast-temperature" aria-label={`${overview.temperatureLabel}: ${overview.temperature}`}>{overview.temperature}</p>
    <p data-category="precipitation" className="forecast-secondary" aria-label={`${overview.rainLabel}: ${overview.rain}`}>🌧 {overview.rain}</p>
    <p data-category="wind" className="forecast-secondary" aria-label={`${overview.windLabel}: ${overview.wind}`}>🌬️ {overview.wind}</p>
  </button>
}
