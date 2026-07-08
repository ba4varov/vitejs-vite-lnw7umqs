import { useState, useEffect, useRef } from 'react'
import './App.css'

const translations = {
  bg: {
    title: '🌤️ Доброто време с Боби',
    subtitle: 'Твоят метео гид',
    search: 'Търси град...',
    info: '📡 Данни от Open-Meteo',
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
    hours24: '⏰ 24 часа',
    days14: '📅 14 дни',
    error: 'Грешка.',
    chart: '📊 Графика',
    temp: 'Темп.',
    rain: 'Дъжд',
    windChart: 'Вятър',
    pressureChart: 'Налягане',
    mm: 'мм',
    cloudCover: 'Облаци',
    dewPoint: 'Точ. оросяване',
    detailsFor: 'Подробности за',
    tabMain: 'Основни',
    tabAtmosphere: 'Атмосфера',
    tabWaterWind: 'Вода/Вятър',
    weekDays: ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
    months: ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'],
    weather: { 0: 'Ясно', 1: 'Ясно', 2: 'Облачно', 3: 'Облачно', 45: 'Мъгла', 61: 'Дъжд', 95: 'Буря' }
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
    error: 'Error.',
    chart: '📊 Chart',
    temp: 'Temp',
    rain: 'Rain',
    windChart: 'Wind',
    pressureChart: 'Pressure',
    mm: 'mm',
    cloudCover: 'Clouds',
    dewPoint: 'Dew Point',
    detailsFor: 'Details for',
    tabMain: 'Main',
    tabAtmosphere: 'Atmosphere',
    tabWaterWind: 'Water/Wind',
    weekDays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    weather: { 0: 'Clear', 1: 'Clear', 2: 'Cloudy', 3: 'Cloudy', 45: 'Fog', 61: 'Rain', 95: 'Storm' }
  }
}

const WeatherApp = () => {
  const [lang, setLang] = useState('bg')
  const [city, setCity] = useState('Варна')
  const [weather, setWeather] = useState<any>(null)
  const [hourly, setHourly] = useState<any[]>([])
  const [forecast, setForecast] = useState<any[]>([])
  const [selectedDay, setSelectedDay] = useState<any>(null)
  const [selectedHour, setSelectedHour] = useState<any>(null)
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 })
  const t = translations[lang as keyof typeof translations]

  const fetchWeather = async () => {
    // В реална ситуация тук добавяш fetch логиката
    setWeather({ temp: 25, humidity: 60, windSpeed: 10, feelsLike: 26, visibility: 10, pressure: 1015, uvIndex: 5, seaTemp: 22, description: 'Слънчево', icon: '☀️' })
  }

  useEffect(() => { fetchWeather() }, [])

  return (
    <div className="weather-app">
      <div className="header-row">
        <h1>{t.title}</h1>
        <button className="lang-btn" onClick={() => setLang(lang === 'bg' ? 'en' : 'bg')}>
          {lang === 'bg' ? 'EN' : 'БГ'}
        </button>
      </div>

      {weather && (
        <div className="card main-card">
          <h2>📍 {city}</h2>
          <p className="big-temp">{weather.temp}°C</p>
        </div>
      )}

      <div className="card">
        <h3>{t.days14}</h3>
        <div className="daily-grid">
           {/* Тук визуализираш дните */}
           <div className="day-box" onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setPopupPos({ x: rect.left, y: rect.top - 300 });
              setSelectedDay({ dayName: 'Пн', min: 20, max: 30 });
           }}>Пн</div>
        </div>
      </div>

      {selectedDay && (
        <div className="popup" style={{ top: popupPos.y, left: popupPos.x }}>
          <h4>{t.detailsFor} {selectedDay.dayName}</h4>
          <button onClick={() => setSelectedDay(null)}>Затвори</button>
        </div>
      )}
    </div>
  )
}

export default WeatherApp
