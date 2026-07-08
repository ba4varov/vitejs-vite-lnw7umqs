import { useState, useEffect, useRef } from 'react'
import './App.css'

const translations = {
  bg: {
    title: '🌤️ Доброто време с Боби',
    subtitle: 'Твоят метео гид',
    search: 'Търси град...',
    info: '📡 Данни от Open-Meteo · Обновява се на всеки 15 мин',
    loading: '⏳ Зареждане...',
    tryAgain: 'Опитай отново',
    humidity: 'Влажност',
    wind: 'Вятър',
    windUnit: 'км/ч',
    feelsLike: 'Усеща се',
    visibility: 'Видимост',
    pressure: 'Налягане',
    uvIndex: 'UV индекс',
    seaTemp: 'Вода',
    noSeaData: 'няма',
    km: 'км',
    hpa: 'hPa',
    hours24: '⏰ Следващите 24 часа',
    days14: '📅 Прогноза за 14 дни',
    detailsFor: 'Подробности за',
    tabMain: 'Основни',
    tabAtmosphere: 'Атмосфера',
    tabWaterWind: 'Вода/Вятър',
    weekDays: ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
    months: ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'],
    error: 'Грешка при зареждане.'
  },
  en: {
    title: '🌤️ Great Weather with Bobby',
    subtitle: 'Your meteo guide',
    search: 'Search city...',
    info: '📡 Live data from Open-Meteo',
    loading: '⏳ Loading...',
    tryAgain: 'Try Again',
    humidity: 'Humidity',
    wind: 'Wind',
    windUnit: 'km/h',
    feelsLike: 'Feels like',
    visibility: 'Visibility',
    pressure: 'Pressure',
    uvIndex: 'UV Index',
    seaTemp: 'Water',
    noSeaData: 'n/a',
    km: 'km',
    hpa: 'hPa',
    hours24: '⏰ Next 24h',
    days14: '📅 14-Day',
    detailsFor: 'Details for',
    tabMain: 'Main',
    tabAtmosphere: 'Atmosphere',
    tabWaterWind: 'Water/Wind',
    weekDays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    error: 'Error loading data.'
  }
}

const WeatherApp = () => {
  const [lang, setLang] = useState('bg')
  const [weather, setWeather] = useState<any>(null)
  const [hourly, setHourly] = useState<any[]>([])
  const [forecast, setForecast] = useState<any[]>([])
  const [selectedDay, setSelectedDay] = useState<any>(null)
  const [selectedHour, setSelectedHour] = useState<any>(null)
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 })
  const t = translations[lang as keyof typeof translations]

  const fetchWeather = async () => {
    try {
      const lat = 43.2141, lon = 27.9147 // Варна
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m&hourly=temperature_2m,precipitation&daily=temperature_2m_max,temperature_2m_min&forecast_days=14`
      const res = await fetch(url)
      const data = await res.json()
      
      setWeather({ temp: Math.round(data.current.temperature_2m), humidity: data.current.relative_humidity_2m })
      
      const hr = data.hourly.time.slice(0, 24).map((time: string, i: number) => ({
        hour: time.slice(11, 16),
        temp: data.hourly.temperature_2m[i],
        rain: data.hourly.precipitation[i]
      }))
      setHourly(hr)

      const days = data.daily.time.map((time: string, i: number) => ({
        date: time,
        dayName: t.weekDays[new Date(time).getDay()],
        max: data.daily.temperature_2m_max[i],
        min: data.daily.temperature_2m_min[i]
      }))
      setForecast(days)
    } catch (e) { console.error(e) }
  }

  useEffect(() => { fetchWeather() }, [])

  return (
    <div className="weather-app">
      <div className="header-row">
        <h1>{t.title}</h1>
        <button className="lang-btn" onClick={() => setLang(lang === 'bg' ? 'en' : 'bg')}>{lang === 'bg' ? 'EN' : 'БГ'}</button>
      </div>

      {weather && (
        <div className="card main-card">
          <h2>📍 Варна</h2>
          <p className="big-temp">{weather.temp}°C</p>
        </div>
      )}

      <div className="card">
        <h3>{t.hours24}</h3>
        <div className="hourly-row">
          {hourly.map((h, i) => (
            <div key={i} className="hour-box" onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setPopupPos({ x: rect.left, y: rect.top - 150 });
              setSelectedHour(h);
            }}>
              <p>{h.hour}</p>
              <p>{h.temp}°C</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>{t.days14}</h3>
        <div className="daily-grid">
          {forecast.map((day, i) => (
            <div key={i} className="day-box" onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setPopupPos({ x: rect.left, y: rect.top - 150 });
              setSelectedDay(day);
            }}>
              <p>{day.dayName}</p>
              <p>{day.max}°</p>
            </div>
          ))}
        </div>
      </div>

      {(selectedDay || selectedHour) && (
        <div className="popup" style={{ top: popupPos.y, left: popupPos.x }}>
          <h4>{t.detailsFor}</h4>
          <button onClick={() => { setSelectedDay(null); setSelectedHour(null); }}>X</button>
        </div>
      )}
    </div>
  )
}

export default WeatherApp
