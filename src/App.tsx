import { useState, useEffect, useRef } from 'react'
import './App.css'

const WeatherApp = () => {
  const [city, setCity] = useState('Варна')
  const [coords, setCoords] = useState({ lat: 43.2141, lon: 27.9147 })
  const [searchInput, setSearchInput] = useState('')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [darkMode, setDarkMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [weather, setWeather] = useState<any>(null)
  const [hourly, setHourly] = useState<any[]>([])
  const [forecast, setForecast] = useState<any[]>([])
  const searchTimer = useRef<any>(null)

  const quickCities = [
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

  const weekDays = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

  const decodeWeatherCode = (code: number) => {
    const map: Record<number, { icon: string; desc: string }> = {
      0: { icon: '☀️', desc: 'Ясно небе' },
      1: { icon: '🌤️', desc: 'Предимно ясно' },
      2: { icon: '⛅', desc: 'Частично облачно' },
      3: { icon: '☁️', desc: 'Облачно' },
      45: { icon: '🌫️', desc: 'Мъгла' },
      48: { icon: '🌫️', desc: 'Замръзваща мъгла' },
      51: { icon: '🌦️', desc: 'Лек ръмеж' },
      53: { icon: '🌦️', desc: 'Умерен ръмеж' },
      55: { icon: '🌧️', desc: 'Силен ръмеж' },
      61: { icon: '🌧️', desc: 'Слаб дъжд' },
      63: { icon: '🌧️', desc: 'Умерен дъжд' },
      65: { icon: '🌧️', desc: 'Силен дъжд' },
      71: { icon: '🌨️', desc: 'Слаб снеговалеж' },
      73: { icon: '🌨️', desc: 'Умерен снеговалеж' },
      75: { icon: '❄️', desc: 'Силен снеговалеж' },
      80: { icon: '🌦️', desc: 'Краткотрайни превалявания' },
      81: { icon: '🌧️', desc: 'Умерени превалявания' },
      82: { icon: '⛈️', desc: 'Силни превалявания' },
      95: { icon: '⛈️', desc: 'Гръмотевична буря' },
      96: { icon: '⛈️', desc: 'Буря с градушка' },
      99: { icon: '⛈️', desc: 'Силна буря с градушка' }
    }
    return map[code] || { icon: '🌡️', desc: 'Няма данни' }
  }

  const searchCities = async (query: string) => {
    if (query.length < 2) { setSuggestions([]); return }
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=bg&format=json`)
      const data = await res.json()
      setSuggestions(data.results || [])
    } catch {
      setSuggestions([])
    }
  }

  const handleSearchInput = (val: string) => {
    setSearchInput(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => searchCities(val), 300)
  }

  const selectCity = (result: any) => {
    const name = result.name + (result.country ? `, ${result.country}` : '')
    setCity(name)
    setCoords({ lat: result.latitude, lon: result.longitude })
    setSearchInput('')
    setSuggestions([])
  }

  const fetchWeather = async (lat: number, lon: number) => {
    setLoading(true)
    setError(null)
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=8`
      const res = await fetch(url)
      if (!res.ok) throw new Error()
      const data = await res.json()

      const cur = decodeWeatherCode(data.current.weather_code)
      setWeather({
        temp: Math.round(data.current.temperature_2m),
        humidity: data.current.relative_humidity_2m,
        windSpeed: Math.round(data.current.wind_speed_10m),
        description: cur.desc,
        icon: cur.icon
      })

      const now = new Date()
      const nowISO = now.toISOString().slice(0, 13)
      let startIdx = data.hourly.time.findIndex((t: string) => t.slice(0, 13) === nowISO)
      if (startIdx === -1) startIdx = 0
      const hr = []
      for (let i = 0; i < 24; i++) {
        const idx = startIdx + i
        if (idx >= data.hourly.time.length) break
        const code = decodeWeatherCode(data.hourly.weather_code[idx])
        hr.push({ hour: data.hourly.time[idx].slice(11, 16), temp: Math.round(data.hourly.temperature_2m[idx]), icon: code.icon })
      }
      setHourly(hr)

      const days = []
      for (let i = 1; i < Math.min(8, data.daily.time.length); i++) {
        const d = new Date(data.daily.time[i])
        const code = decodeWeatherCode(data.daily.weather_code[i])
        days.push({ day: weekDays[d.getDay()], max: Math.round(data.daily.temperature_2m_max[i]), min: Math.round(data.daily.temperature_2m_min[i]), icon: code.icon })
      }
      setForecast(days)
      setLoading(false)
    } catch {
      setError('Неуспешно зареждане. Моля, опитайте отново.')
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWeather(coords.lat, coords.lon)
    const interval = setInterval(() => fetchWeather(coords.lat, coords.lon), 15 * 60 * 1000)
    return () => clearInterval(interval)
  }, [coords])

  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(pos => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setCity('Моето местоположение')
      }, () => {}, { timeout: 5000 })
    }
  }, [])

  const bg = darkMode ? 'weather-app dark' : 'weather-app'

  return (
    <div className={bg}>
      <div className="header-row">
        <h1>🌍 Прогноза на времето</h1>
        <button className="icon-btn" onClick={() => setDarkMode(!darkMode)}>
          {darkMode ? '☀️' : '🌙'}
        </button>
      </div>

      <div className="search-wrapper">
        <div className="search-row">
          <input
            type="text"
            placeholder="Търси град по целия свят..."
            value={searchInput}
            onChange={e => handleSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && setSuggestions([])}
            autoComplete="off"
          />
        </div>
        {suggestions.length > 0 && (
          <div className="suggestions">
            {suggestions.map((s, i) => (
              <div key={i} className="suggestion-item" onClick={() => selectCity(s)}>
                <span className="sug-name">{s.name}</span>
                <span className="sug-country">{s.admin1 ? `${s.admin1}, ` : ''}{s.country}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="info-line">
        📡 Реални данни от Open-Meteo · Обновява се на всеки 15 мин
      </div>

      <div className="city-row">
        {quickCities.map(c => (
          <button
            key={c.name}
            onClick={() => { setCity(c.name); setCoords({ lat: c.lat, lon: c.lon }) }}
            className={`city-btn ${city === c.name ? 'active' : ''}`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {loading && (
        <div className="card center-text">
          <p style={{ fontSize: '1.5rem' }}>⏳ Зареждане...</p>
        </div>
      )}

      {error && !loading && (
        <div className="card center-text">
          <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>⚠️ {error}</p>
          <button className="search-btn" onClick={() => fetchWeather(coords.lat, coords.lon)}>Опитай отново</button>
        </div>
      )}

      {!loading && !error && weather && (
        <>
          <div className="card main-card">
            <div className="main-top">
              <div>
                <h2>📍 {city}</h2>
                <p className="desc">{weather.description}</p>
              </div>
              <div className="big-icon">{weather.icon}</div>
            </div>
            <div className="big-temp">{weather.temp}°C</div>
            <div className="stats-grid">
              <div className="stat-box">
                <p>💧</p>
                <p className="label">Влажност</p>
                <p className="value">{weather.humidity}%</p>
              </div>
              <div className="stat-box">
                <p>💨</p>
                <p className="label">Вятър</p>
                <p className="value">{weather.windSpeed} км/ч</p>
              </div>
              <div className="stat-box">
                <p>🕐</p>
                <p className="label">Обновено</p>
                <p className="value">{new Date().toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>
          </div>

          <div className="card">
            <h3>⏰ Следващите 24 часа</h3>
            <div className="hourly-row">
              {hourly.map((h, i) => (
                <div key={i} className="hour-box">
                  <p className="hour-time">{h.hour}</p>
                  <p className="hour-icon">{h.icon}</p>
                  <p className="hour-temp">{h.temp}°</p>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>📅 Прогноза за 7 дни</h3>
            <div className="daily-grid">
              {forecast.map((day, i) => (
                <div key={i} className="day-box">
                  <p className="day-name">{day.day}</p>
                  <p className="day-icon">{day.icon}</p>
                  <p className="day-temp">
                    <span className="max">{day.max}°</span><br />
                    <span className="min">{day.min}°</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default WeatherApp
