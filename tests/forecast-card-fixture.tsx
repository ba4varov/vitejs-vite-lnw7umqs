import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ForecastPeriodCard } from '../src/ForecastPeriodCard'
import '../src/index.css'
import '../src/App.css'

function Fixture() {
  const params = new URLSearchParams(location.search)
  const language = params.get('lang') === 'en' ? 'en' : 'bg'
  const missing = params.get('missing') === 'true'
  const [selected, select] = useState('')
  const description = language === 'bg'
    ? 'Силни гръмотевични бури с продължителни превалявания и необичайно дълго описание на метеорологичните условия'
    : 'Heavy thunderstorms with prolonged precipitation and an unusually long description of the weather conditions'
  const item = { description, temp: missing ? null : -123456789.123456, max: missing ? null : 123456789.123456, rain: missing ? null : 123456789.123456, wind: missing ? null : 123456789.123456, rainProbability: 99 }
  return <div className={`weather-app ${params.get('dark') === 'true' ? 'dark' : ''}`}>
    <main className="forecast-dashboard">
      {(['hour', 'day'] as const).map(period => <section className={`card ${period === 'hour' ? 'hourly-section' : 'forecast-section'}`} key={period}>
        <div className={period === 'hour' ? 'hourly-row' : 'daily-grid'}>
          {[0, 1, 2].map(index => <ForecastPeriodCard key={index} period={period} item={item} language={language}
            label={period === 'hour' ? '23:00' : language === 'bg' ? 'Понеделник' : 'Wednesday'}
            date={language === 'bg' ? '30 септември' : '30 September'} icon="⛈️"
            selected={selected === `${period}-${index}`} onClick={() => select(`${period}-${index}`)} />)}
        </div>
      </section>)}
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
