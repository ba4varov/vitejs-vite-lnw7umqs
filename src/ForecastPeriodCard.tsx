import type { MouseEvent, ReactNode } from 'react'
import { forecastOverview } from './weather-utils.js'

type Props = {
  period: 'hour' | 'day'; item: any; language: 'bg' | 'en'; label: string; date: string;
  icon: ReactNode; selected: boolean; onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

// Visual category from WMO weather code; never changes forecast data or alert logic.
export function forecastCardTone(rawCode: unknown): 'fair' | 'clouds' | 'rain' | 'snow' | 'fog' | 'storm' {
  const code = typeof rawCode === 'number' && Number.isFinite(rawCode) ? rawCode : -1
  if ([95, 96, 99].includes(code)) return 'storm'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow'
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain'
  if ([45, 48].includes(code)) return 'fog'
  if ([2, 3].includes(code)) return 'clouds'
  return 'fair'
}

export function ForecastPeriodCard({ period, item, language, label, date, icon, selected, onClick }: Props) {
  const overview = forecastOverview(item, period, language)
  return <button type="button" className={`forecast-period-card ${period === 'hour' ? 'hour-box' : 'day-box'} forecast-tone-${forecastCardTone(item.code)}`}
    aria-pressed={selected} onClick={onClick} title={overview.explanation}>
    <div data-category="period" className="forecast-period"><strong>{label}</strong><small>{date}</small></div>
    <div data-category="icon" className="forecast-icon" aria-hidden="true">{icon}</div>
    <p data-category="description" className="forecast-condition">{item.description}</p>
    <p data-category="temperature" className="forecast-temperature" aria-label={`${overview.temperatureLabel}: ${overview.temperature}`}>{overview.temperature}</p>
    <p data-category="precipitation" className="forecast-secondary" aria-label={`${overview.rainLabel}: ${overview.rain}`}>🌧 {overview.rain}</p>
    <p data-category="wind" className="forecast-secondary" aria-label={`${overview.windLabel}: ${overview.wind}`}>🌬️ {overview.wind}</p>
  </button>
}
