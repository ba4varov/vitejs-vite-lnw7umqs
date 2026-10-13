import { createRoot } from 'react-dom/client'
import { Chart } from '../src/WeatherCharts'
import '../src/index.css'
import '../src/App.css'

const params = new URLSearchParams(location.search)
const lang = params.get('lang') === 'en' ? 'en' : 'bg'
const t = lang === 'bg'
  ? { chart: 'Графики за 24 часа', temp: 'Температура', rain: 'Валежи', windChart: 'Вятър', pressureChart: 'Налягане', mm: 'мм', windUnit: 'км/ч', hpa: 'hPa' }
  : { chart: '24-hour charts', temp: 'Temperature', rain: 'Precipitation', windChart: 'Wind', pressureChart: 'Pressure', mm: 'mm', windUnit: 'km/h', hpa: 'hPa' }
const hourly = Array.from({ length: 24 }, (_, i) => ({
  hour: `${String(i).padStart(2, '0')}:00`,
  temp: i - 12, rain: params.has('zero') ? 0 : i === 5 ? .2 : 0,
  wind: i + 1, pressure: 1013 + i % 3,
  ...(params.has('missing') || (params.has('gap') && i === 0) ? { temp: null, rain: null, wind: null, pressure: null } : {}),
}))
createRoot(document.getElementById('root')!).render(
  <div className={`weather-app ${params.has('dark') ? 'dark' : ''}`}>
    <main className="forecast-dashboard"><Chart hourly={hourly} darkMode={params.has('dark')} t={t} lang={lang} /></main>
    <div style={{ height: 1200 }} aria-hidden="true" />
  </div>,
)
