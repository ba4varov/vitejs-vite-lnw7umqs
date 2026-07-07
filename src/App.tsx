import { useState, useEffect, useRef } from 'react'
import './App.css'

const translations = {
  bg: {
    title: '🌤️ Доброто време с Боби',
    subtitle: 'Твоят метео гид',
    search: 'Търси град по целия свят...',
    info: '📡 Реални данни от Open-Meteo · Обновява се на всеки 15 мин',
    loading: '⏳ Зареждане...',
    tryAgain: 'Опитай отново',
    humidity: 'Влажност',
    wind: 'Вятър',
    windUnit: 'км/ч',
    updated: 'Обновено',
    feelsLike: 'Усеща се като',
    visibility: 'Видимост',
    pressure: 'Налягане',
    uvIndex: 'UV индекс',
    seaTemp: 'Темп. на водата',
    noSeaData: 'няма данни',
    km: 'км',
    hpa: 'hPa',
    hours24: '⏰ Следващите 24 часа',
    days14: '📅 Прогноза за 14 дни',
    myLocation: 'Моето местоположение',
    error: 'Неуспешно зареждане. Моля, опитайте отново.',
    chart: '📊 Графика за 24 часа',
    temp: 'Температура',
    rain: 'Валежи',
    windChart: 'Вятър',
    pressureChart: 'Налягане',
    mm: 'мм',
    cloudCover: 'Облачност',
    dewPoint: 'Точ. оросяване',
    detailsFor: 'Подробности за',
    tabMain: 'Основни',
    tabAtmosphere: 'Атмосфера',
    tabWaterWind: 'Вода и Вятър',
    weekDays: ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
    months: ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'],
    weather: {
      0: 'Ясно небе', 1: 'Предимно ясно', 2: 'Частично облачно', 3: 'Облачно',
      45: 'Мъгла', 48: 'Замръзваща мъгла', 51: 'Лек ръмеж', 53: 'Умерен ръмеж',
      55: 'Силен ръмеж', 61: 'Слаб дъжд', 63: 'Умерен дъжд', 65: 'Силен дъжд',
      71: 'Слаб снеговалеж', 73: 'Умерен снеговалеж', 75: 'Силен снеговалеж',
      80: 'Превалявания', 81: 'Умерени превалявания', 82: 'Силни превалявания',
      95: 'Гръмотевична буря', 96: 'Буря с градушка', 99: 'Силна буря'
    },
    quickCities: [
      { name: 'Варна', lat: 43.2141, lon: 27.9147 },
      { name: 'София', lat: 42.6977, lon: 23.3219 },
      { name: 'Пловдив', lat: 42.1522, lon: 24.7454 },
      { name: 'Бургас', lat: 42.5048, lon: 27.4732 },
      { name: 'Лондон', lat: 51.5074, lon: -0.1278 },
      { name: 'Париж', lat: 48.8566, lon: 2.3522 },
      { name: 'Ню Йорк', lat: 40.7128, lon: -74.006 },
      { name: 'Токио', lat: 35.6762, lon: 139.6503 },
      { name: 'Дубай', lat: 25.2048, lon: 55.2708 },
    ]
  },
  en: {
    title: '🌤️ Great Weather with Bobby',
    subtitle: 'Your meteo guide',
    search: 'Search any city in the world...',
    info: '📡 Live data from Open-Meteo · Auto-refresh every 15 min',
    loading: '⏳ Loading...',
    tryAgain: 'Try Again',
    humidity: 'Humidity',
    wind: 'Wind',
    windUnit: 'km/h',
    updated: 'Updated',
    feelsLike: 'Feels Like',
    visibility: 'Visibility',
    pressure: 'Pressure',
    uvIndex: 'UV Index',
    seaTemp: 'Water Temp',
    noSeaData: 'n/a',
    km: 'km',
    hpa: 'hPa',
    hours24: '⏰ Next 24 Hours',
    days14: '📅 14-Day Forecast',
    myLocation: 'My Location',
    error: 'Failed to load weather data. Please try again.',
    chart: '📊 24-Hour Chart',
    temp: 'Temperature',
    rain: 'Precipitation',
    windChart: 'Wind',
    pressureChart: 'Pressure',
    mm: 'mm',
    cloudCover: 'Cloud Cover',
    dewPoint: 'Dew Point',
    detailsFor: 'Details for',
    tabMain: 'Main',
    tabAtmosphere: 'Atmosphere',
    tabWaterWind: 'Water & Wind',
    weekDays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    weather: {
      0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
      45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Moderate drizzle',
      55: 'Heavy drizzle', 61: 'Light rain', 63: 'Moderate rain', 65: 'Heavy rain',
      71: 'Light snow', 73: 'Moderate snow', 75: 'Heavy snow',
      80: 'Rain showers', 81: 'Moderate showers', 82: 'Violent showers',
      95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Heavy thunderstorm'
    },
    quickCities: [
      { name: 'Varna', lat: 43.2141, lon: 27.9147 },
      { name: 'Sofia', lat: 42.6977, lon: 23.3219 },
      { name: 'Plovdiv', lat: 42.1522, lon: 24.7454 },
      { name: 'Burgas', lat: 42.5048, lon: 27.4732 },
      { name: 'London', lat: 51.5074, lon: -0.1278 },
      { name: 'Paris', lat: 48.8566, lon: 2.3522 },
      { name: 'New York', lat: 40.7128, lon: -74.006 },
      { name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
      { name: 'Dubai', lat: 25.2048, lon: 55.2708 },
    ]
  }
}

const getTempGradient = (temp) => {
  if (temp < 0) return 'linear-gradient(135deg, #6b21a8, #3b82f6)'
  if (temp < 10) return 'linear-gradient(135deg, #1d4ed8, #38bdf8)'
  if (temp < 15) return 'linear-gradient(135deg, #0891b2, #34d399)'
  if (temp < 20) return 'linear-gradient(135deg, #059669, #84cc16)'
  if (temp < 25) return 'linear-gradient(135deg, #ca8a04, #facc15)'
  if (temp < 30) return 'linear-gradient(135deg, #ea580c, #fbbf24)'
  return 'linear-gradient(135deg, #dc2626, #f97316)'
}

const getIconAnimation = (icon) => {
  if (icon === '☀️') return 'spin-slow'
  if (icon === '🌤️' || icon === '⛅') return 'float'
  if (icon === '🌧️' || icon === '🌦️') return 'bounce-rain'
  if (icon === '⛈️') return 'flash'
  if (icon === '❄️' || icon === '🌨️') return 'fall'
  if (icon === '🌫️') return 'drift'
  return 'float'
}

const AnimatedIcon = ({ icon, size }) => {
  const sz = size || '1.5rem'
  return (
    <span className={'animated-icon ' + getIconAnimation(icon)} style={{ fontSize: sz, display: 'inline-block' }}>
      {icon}
    </span>
  )
}

const Chart = ({ hourly, darkMode, t }) => {
  const [activeTab, setActiveTab] = useState('temp')
  const canvasRef = useRef(null)
  const colors = { temp: '#f97316', rain: '#3b82f6', wind: '#10b981', pressure: '#a855f7' }

  useEffect(() => {
    if (!canvasRef.current || !hourly.length) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const padL = 55, padR = 20, padT = 20, padB = 40
    const chartW = W - padL - padR, chartH = H - padT - padB
    ctx.clearRect(0, 0, W, H)
    const data = hourly.map(h =>
      activeTab === 'temp' ? h.temp :
      activeTab === 'rain' ? (h.rain <= 0 ? 0 : h.rain) :
      activeTab === 'pressure' ? h.pressure :
      h.wind
    )
    const labels = hourly.map(h => h.hour)
    const minVal = activeTab === 'rain' ? 0 : Math.min(...data)
    const maxVal = activeTab === 'rain' ? Math.max(1, Math.max(...data)) : Math.max(...data)
    const range = maxVal - minVal || 1
    const xStep = chartW / (data.length - 1)
    const yScale = (val) => padT + chartH - ((val - minVal) / range) * chartH
    const xScale = (i) => padL + i * xStep
    const textColor = darkMode ? '#94a3b8' : '#64748b'
    const gridColor = darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
    ctx.strokeStyle = gridColor
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = padT + (chartH / 4) * i
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke()
      ctx.fillStyle = textColor; ctx.font = '11px Arial'; ctx.textAlign = 'right'
      ctx.fillText(Math.round(maxVal - (range / 4) * i), padL - 5, y + 4)
    }
    ctx.fillStyle = textColor; ctx.font = '11px Arial'; ctx.textAlign = 'center'
    
    // Показваме часовете през един, както се разбрахме (през 2 часа)
    data.forEach((_, i) => { if (i % 2 === 0) ctx.fillText(labels[i], xScale(i), H - 10) })
    
    const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH)
    grad.addColorStop(0, colors[activeTab] + '55'); grad.addColorStop(1, colors[activeTab] + '00')
    ctx.beginPath(); ctx.moveTo(xScale(0), yScale(data[0]))
    data.forEach((val, i) => {
      if (i === 0) return
      const cpx = (xScale(i - 1) + xScale(i)) / 2
      ctx.bezierCurveTo(cpx, yScale(data[i - 1]), cpx, yScale(val), xScale(i), yScale(val))
    })
    ctx.lineTo(xScale(data.length - 1), padT + chartH); ctx.lineTo(xScale(0), padT + chartH)
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill()
    ctx.beginPath(); ctx.strokeStyle = colors[activeTab]; ctx.lineWidth = 2.5
    data.forEach((val, i) => {
      if (i === 0) { ctx.moveTo(xScale(0), yScale(val)); return }
      const cpx = (xScale(i - 1) + xScale(i)) / 2
      ctx.bezierCurveTo(cpx, yScale(data[i - 1]), cpx, yScale(val), xScale(i), yScale(val))
    })
    ctx.stroke()
    data.forEach((val, i) => {
      if (i % 2 === 0) {
        ctx.beginPath(); ctx.arc(xScale(i), yScale(val), 4, 0, Math.PI * 2)
        ctx.fillStyle = colors[activeTab]; ctx.fill()
        ctx.strokeStyle = darkMode ? '#1e293b' : 'white'; ctx.lineWidth = 2; ctx.stroke()
      }
    })
  }, [hourly, activeTab, darkMode])

  const tabs = [
    { key: 'temp', label: t.temp, unit: '°C' },
    { key: 'rain', label: t.rain, unit: t.mm },
    { key: 'wind', label: t.windChart, unit: t.windUnit },
    { key: 'pressure', label: t.pressureChart, unit: t.hpa }
  ]

  return (
    <div className="card">
      <h3>{t.chart}</h3>
      <div className="chart-tabs">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={'chart-tab' + (activeTab === tab.key ? ' active-' + tab.key : '')}>
            {tab.label} ({tab.unit})
          </button>
        ))}
      </div>
      <canvas ref={canvasRef} width={800} height={200} style={{ width: '100%', height: 'auto', display: 'block' }} />
    </div>
  )
}

const WeatherApp = () => {
  const [lang, setLang] = useState('bg')
  const [city, setCity] = useState('Варна')
  const [coords, setCoords] = useState({ lat: 43.2141, lon: 27.9147 })
  const [searchInput, setSearchInput] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [darkMode, setDarkMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [weather, setWeather] = useState(null)
  const [hourly, setHourly] = useState([])
  const [forecast, setForecast] = useState([])
  const [selectedDay, setSelectedDay] = useState(null) // State за избрания ден
  const [detailTab, setDetailTab] = useState('main')   // State за табовете в детайлите
  const searchTimer = useRef(null)
  const t = translations[lang]

  const decodeWeatherCode = (code) => {
    const icons = {
      0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
      51: '🌦️', 53: '🌦️', 55: '🌧️', 61: '🌧️', 63: '🌧️', 65: '🌧️',
      71: '🌨️', 73: '🌨️', 75: '❄️', 80: '🌦️', 81: '🌧️', 82: '⛈️',
      95: '⛈️', 96: '⛈️', 99: '⛈️'
    }
    return { icon: icons[code] || '🌡️', desc: t.weather[code] || 'Unknown' }
  }

  const searchCities = async (query) => {
    if (query.length < 2) { setSuggestions([]); return }
    try {
      const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + 
        '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature,visibility,surface_pressure,uv_index' + 
        '&hourly=temperature_2m,weather_code,precipitation,wind_speed_10m,surface_pressure,relative_humidity_2m,visibility,dew_point_2m,cloud_cover' + 
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,uv_index_max,apparent_temperature_max' + 
        '&timezone=auto&forecast_days=15';

      const marineUrl = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + lat + '&longitude=' + lon + 
        '&current=sea_surface_temperature&hourly=sea_surface_temperature&timezone=auto&forecast_days=15';

      const [weatherRes, marineRes] = await Promise.allSettled([
        fetch(weatherUrl),
        fetch(marineUrl)
      ]);
      
      if (weatherRes.status !== 'fulfilled' || !weatherRes.value.ok) throw new Error();
