дimport { useState, useEffect, useRef } from 'react'
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
  
  // States за изскачащите прозорци (дни и часове)
  const [selectedDay, setSelectedDay] = useState(null)
  const [selectedHour, setSelectedHour] = useState(null)
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 })
  const [detailTab, setDetailTab] = useState('main')
  
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
      const res = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(query) + '&count=10&language=' + lang + '&format=json')
      const data = await res.json()
      setSuggestions(data.results || [])
    } catch (e) { setSuggestions([]) }
  }

  const handleSearchInput = (val) => {
    setSearchInput(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => searchCities(val), 300)
  }

  const selectCity = (result) => {
    const name = result.name + (result.country ? ', ' + result.country : '')
    setCity(name)
    setCoords({ lat: result.latitude, lon: result.longitude })
    setSearchInput('')
    setSuggestions([])
    setSelectedDay(null)
    setSelectedHour(null)
  }

  const fetchWeather = async (lat, lon) => {
    setLoading(true)
    setError(null)
    try {
      const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + 
        '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature,visibility,surface_pressure,uv_index' + 
        '&hourly=temperature_2m,weather_code,precipitation,wind_speed_10m,surface_pressure,relative_humidity_2m,visibility,dew_point_2m,cloud_cover,apparent_temperature' + 
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,uv_index_max,apparent_temperature_max' + 
        '&timezone=auto&forecast_days=15';

      const marineUrl = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + lat + '&longitude=' + lon + 
        '&current=sea_surface_temperature&hourly=sea_surface_temperature&timezone=auto&forecast_days=15';

      const [weatherRes, marineRes] = await Promise.allSettled([
        fetch(weatherUrl),
        fetch(marineUrl)
      ])
      
      if (weatherRes.status !== 'fulfilled' || !weatherRes.value.ok) throw new Error()
      const data = await weatherRes.value.json()

      let seaTemp = null
      let hourlySeaTemp = []
      if (marineRes.status === 'fulfilled' && marineRes.value.ok) {
        try {
          const marineData = await marineRes.value.json()
          if (marineData.current && marineData.current.sea_surface_temperature != null) {
            seaTemp = Math.round(marineData.current.sea_surface_temperature)
          }
          if (marineData.hourly && marineData.hourly.sea_surface_temperature) {
            hourlySeaTemp = marineData.hourly.sea_surface_temperature
          }
        } catch (e) {}
      }

      const cur = decodeWeatherCode(data.current.weather_code)
      setWeather({
        temp: Math.round(data.current.temperature_2m),
        humidity: data.current.relative_humidity_2m,
        windSpeed: Math.round(data.current.wind_speed_10m),
        feelsLike: Math.round(data.current.apparent_temperature),
        visibility: Math.round((data.current.visibility || 0) / 1000),
        pressure: Math.round(data.current.surface_pressure),
        uvIndex: Math.round(data.current.uv_index),
        seaTemp: seaTemp,
        description: cur.desc,
        icon: cur.icon
      })

      const now = new Date()
      const localISO = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + 'T' +
        String(now.getHours()).padStart(2, '0')
      let startIdx = data.hourly.time.findIndex((time) => time.slice(0, 13) === localISO)
      if (startIdx === -1) startIdx = 0

      const hr = []
      for (let i = 0; i < 24; i++) {
        const idx = startIdx + i
        if (idx >= data.hourly.time.length) break
        const code = decodeWeatherCode(data.hourly.weather_code[idx])
        const sst = hourlySeaTemp.length > idx ? hourlySeaTemp[idx] : null
        
        hr.push({
          hour: data.hourly.time[idx].slice(11, 16),
          temp: Math.round(data.hourly.temperature_2m[idx]),
          feelsLike: Math.round(data.hourly.apparent_temperature[idx]),
          rain: (data.hourly.precipitation[idx] <= 0 ? 0 : data.hourly.precipitation[idx]),
          wind: Math.round(data.hourly.wind_speed_10m[idx]),
          pressure: Math.round(data.hourly.surface_pressure[idx]),
          humidity: Math.round(data.hourly.relative_humidity_2m[idx]),
          visibility: Math.round((data.hourly.visibility[idx] || 0) / 1000),
          dewPoint: Math.round(data.hourly.dew_point_2m[idx]),
          cloudCover: Math.round(data.hourly.cloud_cover[idx]),
          seaTemp: sst != null ? Math.round(sst) : null,
          icon: code.icon
        })
      }
      setHourly(hr)

      const days = []
      for (let i = 1; i < Math.min(15, data.daily.time.length); i++) {
        const d = new Date(data.daily.time[i])
        const code = decodeWeatherCode(data.daily.weather_code[i])
        
        let sumHum = 0, sumPress = 0, sumVis = 0, sumDew = 0, sumCloud = 0, sumSea = 0;
        let count = 0, seaCount = 0;
        const startH = i * 24;
        
        for(let h = startH; h < startH + 24; h++) {
          if (data.hourly && h < data.hourly.time.length) {
            sumHum += data.hourly.relative_humidity_2m[h] || 0;
            sumPress += data.hourly.surface_pressure[h] || 0;
            sumVis += data.hourly.visibility[h] || 0;
            sumDew += data.hourly.dew_point_2m[h] || 0;
            sumCloud += data.hourly.cloud_cover[h] || 0;
            count++;
            
            if (hourlySeaTemp.length > h && hourlySeaTemp[h] !== null) {
               sumSea += hourlySeaTemp[h];
               seaCount++;
            }
          }
        }

        days.push({
          dateStr: data.daily.time[i],
          dayName: t.weekDays[d.getDay()],
          dateFormatted: `${d.getDate()} ${t.months[d.getMonth()]}`,
          max: Math.round(data.daily.temperature_2m_max[i]),
          min: Math.round(data.daily.temperature_2m_min[i]),
          feelsLikeMax: Math.round(data.daily.apparent_temperature_max[i] || data.daily.temperature_2m_max[i]),
          icon: code.icon,
          rain: Math.max(0, data.daily.precipitation_sum[i] || 0).toFixed(1),
          wind: Math.round(data.daily.wind_speed_10m_max[i] || 0),
          uv: Math.round(data.daily.uv_index_max[i] || 0),
          humidity: count > 0 ? Math.round(sumHum / count) : 0,
          pressure: count > 0 ? Math.round(sumPress / count) : 0,
          visibility: count > 0 ? Math.round((sumVis / count) / 1000) : 0,
          dewPoint: count > 0 ? Math.round(sumDew / count) : 0,
          cloudCover: count > 0 ? Math.round(sumCloud / count) : 0,
          seaTemp: seaCount > 0 ? Math.round(sumSea / seaCount) : null
        })
      }
      setForecast(days)
      setLoading(false)
    } catch (e) {
      setError(t.error)
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWeather(coords.lat, coords.lon)
    const interval = setInterval(() => fetchWeather(coords.lat, coords.lon), 15 * 60 * 1000)
    return () => clearInterval(interval)
  }, [coords, lang])

  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude, lon = pos.coords.longitude
        setCoords({ lat, lon })
        try {
          const res = await fetch('https://nominatim.openstreetmap.org/reverse?lat=' + lat + '&lon=' + lon + '&format=json&accept-language=' + lang)
          const data = await res.json()
          setCity(data.address.city || data.address.town || data.address.village || data.address.county || t.myLocation)
        } catch (e) { setCity(t.myLocation) }
      }, () => {}, { timeout: 5000 })
    }
  }, [])

  return (
    <div className={darkMode ? 'weather-app dark' : 'weather-app'}>
      <div className="header-row">
        <div className="header-title-wrapper" style={{ display: 'flex', flexDirection: 'column' }}>
          <h1>{t.title}</h1>
          <p className="subtitle" style={{ fontSize: '0.9rem', opacity: 0.8, marginTop: '-4px', fontWeight: 'normal' }}>{t.subtitle}</p>
        </div>
        <div className="header-btns">
          <button className="lang-btn" onClick={() => setLang(lang === 'bg' ? 'en' : 'bg')}>
            {lang === 'bg' ? '🇬🇧 EN' : '🇧🇬 БГ'}
          </button>
          <button className="icon-btn" onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? '☀️' : '🌙'}
          </button>
        </div>
      </div>

      <div className="search-wrapper">
        <div className="search-row">
          <input type="text" placeholder={t.search} value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setSuggestions([])}
            autoComplete="off" />
        </div>
        {suggestions.length > 0 && (
          <div className="suggestions">
            {suggestions.map((s, i) => (
              <div key={i} className="suggestion-item" onClick={() => selectCity(s)}>
                <span className="sug-name">{s.name}</span>
                <span className="sug-country">{s.admin1 ? s.admin1 + ', ' : ''}{s.country}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="info-line">{t.info}</div>

      <div className="city-row">
        {t.quickCities.map((c) => (
          <button key={c.name}
            onClick={() => { setCity(c.name); setCoords({ lat: c.lat, lon: c.lon }) }}
            className={city === c.name ? 'city-btn active' : 'city-btn'}>
            {c.name}
          </button>
        ))}
      </div>

      {loading && <div className="card center-text"><p style={{ fontSize: '1.5rem' }}>{t.loading}</p></div>}

      {error && !loading && (
        <div className="card center-text">
          <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>⚠️ {error}</p>
          <button className="search-btn" onClick={() => fetchWeather(coords.lat, coords.lon)}>{t.tryAgain}</button>
        </div>
      )}

      {!loading && !error && weather && (
        <div>
          <div className="card main-card" style={{ background: getTempGradient(weather.temp) }}>
            <div className="main-top">
              <div>
                <h2>📍 {city}</h2>
                <p className="desc">{weather.description}</p>
              </div>
              <div className="big-icon"><AnimatedIcon icon={weather.icon} size="5rem" /></div>
            </div>
            <div className="big-temp">{weather.temp}°C</div>
            <div className="stats-grid">
              <div className="stat-box"><p>💧</p><p className="label">{t.humidity}</p><p className="value">{weather.humidity}%</p></div>
              <div className="stat-box"><p>💨</p><p className="label">{t.wind}</p><p className="value">{weather.windSpeed} {t.windUnit}</p></div>
              <div className="stat-box"><p>🌡️</p><p className="label">{t.feelsLike}</p><p className="value">{weather.feelsLike}°C</p></div>
              <div className="stat-box"><p>👁️</p><p className="label">{t.visibility}</p><p className="value">{weather.visibility} {t.km}</p></div>
              <div className="stat-box"><p>🔵</p><p className="label">{t.pressure}</p><p className="value">{weather.pressure} {t.hpa}</p></div>
              <div className="stat-box"><p>☀️</p><p className="label">{t.uvIndex}</p><p className="value">{weather.uvIndex}</p></div>
              {weather.seaTemp !== null && (
                <div className="stat-box sea-temp-box"><p>🌊</p><p className="label">{t.seaTemp}</p><p className="value">{weather.seaTemp}°C</p></div>
              )}
            </div>
          </div>

          <div className="card">
            <h3>{t.hours24}</h3>
            <div className="hourly-row">
              {hourly.map((h, i) => (
                <div key={i} className="hour-box"
                  onClick={(e) => { 
                    const rect = e.currentTarget.getBoundingClientRect();
                    const popupW = 320;
                    const popupH = 360;
                    
                    let x = rect.left + (rect.width / 2) - (popupW / 2);
                    let y = rect.top - popupH - 15;
                    
                    if (x < 10) x = 10;
                    if (x + popupW > window.innerWidth - 10) x = window.innerWidth - popupW - 10;
                    
                    if (y < 10) {
                      y = rect.bottom + 15;
                    }
                    
                    setPopupPos({ x, y });
                    setSelectedHour(h); 
                    setDetailTab('main'); 
                  }}
                  style={{ 
                    cursor: 'pointer', 
                    boxShadow: selectedHour?.hour === h.hour ? '0 0 0 3px rgba(255,255,255,0.7)' : 'none',
                    transform: selectedHour?.hour === h.hour ? 'scale(1.05)' : 'none',
                    transition: 'all 0.2s',
                    position: 'relative'
                  }}
                >
                  <p className="hour-time">{h.hour}</p>
                  <p className="hour-icon"><AnimatedIcon icon={h.icon} size="1.5rem" /></p>
                  <p className="hour-temp">{h.temp}°C</p>
                  <p className="hour-wind">💨 {h.wind} {t.windUnit}</p>
                  {h.seaTemp !== null && <p className="hour-sea">🌊 {h.seaTemp}°C</p>}
                </div>
              ))}
            </div>
          </div>

          <Chart hourly={hourly} darkMode={darkMode} t={t} />

          <div className="card">
            <h3>{t.days14}</h3>
            <div className="daily-grid" style={{ rowGap: '16px' }}>
              {forecast.map((day, i) => (
                <div key={i} className="day-box" 
                  onClick={(e) => { 
                    const rect = e.currentTarget.getBoundingClientRect();
                    const popupW = 320;
                    const popupH = 360;
                    
                    let x = rect.left + (rect.width / 2) - (popupW / 2);
                    let y = rect.top - popupH - 15;
                    
                    if (x < 10) x = 10;
                    if (x + popupW > window.innerWidth - 10) x = window.innerWidth - popupW - 10;
                    
                    if (y < 10) {
                      y = rect.bottom + 15;
                    }
                    
                    setPopupPos({ x, y });
                    setSelectedDay(day); 
                    setDetailTab('main'); 
                  }}
                  style={{ 
                    cursor: 'pointer', 
                    boxShadow: selectedDay?.dateStr === day.dateStr ? '0 0 0 3px rgba(255,255,255,0.7)' : 'none',
                    transform: selectedDay?.dateStr === day.dateStr ? 'scale(1.05)' : 'none',
                    transition: 'all 0.2s',
                    position: 'relative'
                  }}
                >
                  <p className="day-name" style={{ marginBottom: '2px' }}>{day.dayName}</p>
                  <p style={{ fontSize: '0.7rem', opacity: 0.8, marginBottom: '8px', fontWeight: 'normal' }}>{day.dateFormatted}</p>
                  <p className="day-icon"><AnimatedIcon icon={day.icon} size="2rem" /></p>
                  <p className="day-temp">
                    <span className="max">{day.max}°</span><br />
                    <span className="min">{day.min}°</span>
                  </p>
                  <p className="day-rain">🌧 {day.rain}{t.mm}</p>
                  <p className="day-wind">💨 {day.wind}{t.windUnit}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Изскачащ прозорец (Popover) за ДЕН */}
      {selectedDay && (
        <div 
          style={{ 
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
            zIndex: 9998, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(3px)' 
          }} 
          onClick={() => setSelectedDay(null)}
        >
          <div 
            className="card"
            style={{
              position: 'fixed',
              top: popupPos.y,
              left: popupPos.x,
              width: '320px',
              margin: 0,
              padding: '24px',
              background: darkMode ? 'rgba(31, 41, 55, 0.95)' : 'rgba(37, 99, 235, 0.95)',
              color: 'white',
              boxShadow: '0 15px 50px rgba(0,0,0,0.6)',
              border: '1px solid rgba(255,255,255,0.2)',
              zIndex: 9999,
              cursor: 'default'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h4 style={{ fontSize: '1.2rem', margin: 0 }}>{t.detailsFor} {selectedDay.dayName}</h4>
              <button className="icon-btn" style={{ fontSize: '1rem', padding: '4px 8px', background: 'rgba(255,255,255,0.2)' }} onClick={() => setSelectedDay(null)}>❌</button>
            </div>
            
            <div className="chart-tabs" style={{ marginBottom: '20px' }}>
              <button className={'chart-tab ' + (detailTab === 'main' ? 'active-temp' : '')} onClick={() => setDetailTab('main')}>{t.tabMain}</button>
              <button className={'chart-tab ' + (detailTab === 'atmosphere' ? 'active-temp' : '')} onClick={() => setDetailTab('atmosphere')}>{t.tabAtmosphere}</button>
              <button className={'chart-tab ' + (detailTab === 'water' ? 'active-temp' : '')} onClick={() => setDetailTab('water')}>{t.tabWaterWind}</button>
            </div>
            
            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {detailTab === 'main' && <>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>🌡️</p><p className="label" style={{color: 'white'}}>{t.temp}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedDay.min}° / {selectedDay.max}°</p></div>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>🤔</p><p className="label" style={{color: 'white'}}>{t.feelsLike}</p><p className="value" style={{ fontSize: '1.1rem' }}>до {selectedDay.feelsLikeMax}°</p></div>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>💧</p><p className="label" style={{color: 'white'}}>{t.humidity}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedDay.humidity}%</p></div>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>☀️</p><p className="label" style={{color: 'white'}}>{t.uvIndex}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedDay.uv}</p></div>
              </>}
              {detailTab === 'atmosphere' && <>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>🔵</p><p className="label" style={{color: 'white'}}>{t.pressure}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedDay.pressure} {t.hpa}</p></div>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>👁️</p><p className="label" style={{color: 'white'}}>{t.visibility}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedDay.visibility} {t.km}</p></div>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>☁️</p><p className="label" style={{color: 'white'}}>{t.cloudCover}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedDay.cloudCover}%</p></div>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>🌿</p><p className="label" style={{color: 'white'}}>{t.dewPoint}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedDay.dewPoint}°C</p></div>
              </>}
              {detailTab === 'water' && <>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>💨</p><p className="label" style={{color: 'white'}}>{t.wind}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedDay.wind} {t.windUnit}</p></div>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>🌧️</p><p className="label" style={{color: 'white'}}>{t.rain}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedDay.rain} {t.mm}</p></div>
                {selectedDay.seaTemp !== null ? (
                  <div className="stat-box sea-temp-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>🌊</p><p className="label" style={{color: 'white'}}>{t.seaTemp}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedDay.seaTemp}°C</p></div>
                ) : (
                  <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>🌊</p><p className="label" style={{color: 'white'}}>{t.seaTemp}</p><p className="value" style={{ fontSize: '1.1rem' }}>{t.noSeaData}</p></div>
                )}
              </>}
            </div>
          </div>
        </div>
      )}

      {/* Изскачащ прозорец (Popover) за ЧАС */}
      {selectedHour && (
        <div 
          style={{ 
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
            zIndex: 9998, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(3px)' 
          }} 
          onClick={() => setSelectedHour(null)}
        >
          <div 
            className="card"
            style={{
              position: 'fixed',
              top: popupPos.y,
              left: popupPos.x,
              width: '320px',
              margin: 0,
              padding: '24px',
              background: darkMode ? 'rgba(31, 41, 55, 0.95)' : 'rgba(37, 99, 235, 0.95)',
              color: 'white',
              boxShadow: '0 15px 50px rgba(0,0,0,0.6)',
              border: '1px solid rgba(255,255,255,0.2)',
              zIndex: 9999,
              cursor: 'default'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h4 style={{ fontSize: '1.2rem', margin: 0 }}>{t.detailsFor} {selectedHour.hour} ч.</h4>
              <button className="icon-btn" style={{ fontSize: '1rem', padding: '4px 8px', background: 'rgba(255,255,255,0.2)' }} onClick={() => setSelectedHour(null)}>❌</button>
            </div>
            
            <div className="chart-tabs" style={{ marginBottom: '20px' }}>
              <button className={'chart-tab ' + (detailTab === 'main' ? 'active-temp' : '')} onClick={() => setDetailTab('main')}>{t.tabMain}</button>
              <button className={'chart-tab ' + (detailTab === 'atmosphere' ? 'active-temp' : '')} onClick={() => setDetailTab('atmosphere')}>{t.tabAtmosphere}</button>
              <button className={'chart-tab ' + (detailTab === 'water' ? 'active-temp' : '')} onClick={() => setDetailTab('water')}>{t.tabWaterWind}</button>
            </div>
            
            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {detailTab === 'main' && <>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>🌡️</p><p className="label" style={{color: 'white'}}>{t.temp}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedHour.temp}°C</p></div>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>🤔</p><p className="label" style={{color: 'white'}}>{t.feelsLike}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedHour.feelsLike}°C</p></div>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>💧</p><p className="label" style={{color: 'white'}}>{t.humidity}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedHour.humidity}%</p></div>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>☁️</p><p className="label" style={{color: 'white'}}>Време</p><p className="value" style={{ fontSize: '1.1rem' }}><AnimatedIcon icon={selectedHour.icon} size="1.2rem" /></p></div>
              </>}
              {detailTab === 'atmosphere' && <>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>🔵</p><p className="label" style={{color: 'white'}}>{t.pressure}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedHour.pressure} {t.hpa}</p></div>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>👁️</p><p className="label" style={{color: 'white'}}>{t.visibility}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedHour.visibility} {t.km}</p></div>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>☁️</p><p className="label" style={{color: 'white'}}>{t.cloudCover}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedHour.cloudCover}%</p></div>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>🌿</p><p className="label" style={{color: 'white'}}>{t.dewPoint}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedHour.dewPoint}°C</p></div>
              </>}
              {detailTab === 'water' && <>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>💨</p><p className="label" style={{color: 'white'}}>{t.wind}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedHour.wind} {t.windUnit}</p></div>
                <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>🌧️</p><p className="label" style={{color: 'white'}}>{t.rain}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedHour.rain} {t.mm}</p></div>
                {selectedHour.seaTemp !== null ? (
                  <div className="stat-box sea-temp-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>🌊</p><p className="label" style={{color: 'white'}}>{t.seaTemp}</p><p className="value" style={{ fontSize: '1.1rem' }}>{selectedHour.seaTemp}°C</p></div>
                ) : (
                  <div className="stat-box" style={{ padding: '12px', background: 'rgba(255,255,255,0.1)' }}><p>🌊</p><p className="label" style={{color: 'white'}}>{t.seaTemp}</p><p className="value" style={{ fontSize: '1.1rem' }}>{t.noSeaData}</p></div>
                )}
              </>}
            </div>
          </div>
        </div>
      )}

      <div className="footer" style={{ textAlign: 'center', marginTop: '2rem', padding: '1rem', fontSize: '0.9rem', opacity: 0.8 }}>
        <p style={{ marginBottom: '0.5rem' }}>Данните за времето се предоставят от <a href="https://open-meteo.com" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Open-Meteo API</a></p>
        <p>© 2026 Доброто време с Боби. Всички права запазени.</p>
      </div>
    </div>
  )
}

export default WeatherApp
