import { useState, useEffect, useRef } from 'react'
import './App.css'

const WeatherApp = () => {
  const [city, setCity] = useState('Varna')
  const [coords, setCoords] = useState({ lat: 43.2141, lon: 27.9147 })
  const [searchInput, setSearchInput] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [darkMode, setDarkMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [weather, setWeather] = useState(null)
  const [hourly, setHourly] = useState([])
  const [forecast, setForecast] = useState([])
  const searchTimer = useRef(null)

  const quickCities = [
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

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const decodeWeatherCode = (code) => {
    const map = {
      0: { icon: '☀️', desc: 'Clear sky' },
      1: { icon: '🌤️', desc: 'Mainly clear' },
      2: { icon: '⛅', desc: 'Partly cloudy' },
      3: { icon: '☁️', desc: 'Overcast' },
      45: { icon: '🌫️', desc: 'Fog' },
      48: { icon: '🌫️', desc: 'Freezing fog' },
      51: { icon: '🌦️', desc: 'Light drizzle' },
      53: { icon: '🌦️', desc: 'Moderate drizzle' },
      55: { icon: '🌧️', desc: 'Heavy drizzle' },
      61: { icon: '🌧️', desc: 'Light rain' },
      63: { icon: '🌧️', desc: 'Moderate rain' },
      65: { icon: '🌧️', desc: 'Heavy rain' },
      71: { icon: '🌨️', desc: 'Light snow' },
      73: { icon: '🌨️', desc: 'Moderate snow' },
      75: { icon: '❄️', desc: 'Heavy snow' },
      80: { icon: '🌦️', desc: 'Rain showers' },
      81: { icon: '🌧️', desc: 'Moderate showers' },
      82: { icon: '⛈️', desc: 'Violent showers' },
      95: { icon: '⛈️', desc: 'Thunderstorm' },
      96: { icon: '⛈️', desc: 'Thunderstorm with hail' },
      99: { icon: '⛈️', desc: 'Heavy thunderstorm' }
    }
    return map[code] || { icon: '🌡️', desc: 'Unknown' }
  }

  const searchCities = async (query) => {
    if (query.length < 2) { setSuggestions([]); return }
    try {
      const res = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(query) + '&count=6&language=en&format=json')
      const data = await res.json()
      setSuggestions(data.results || [])
    } catch (e) {
      setSuggestions([])
    }
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
  }

  const fetchWeather = async (lat, lon) => {
    setLoading(true)
    setError(null)
    try {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=8'
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
      let startIdx = data.hourly.time.findIndex((t) => t.slice(0, 13) === nowISO)
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
    } catch (e) {
      setError('Failed to load weather data. Please try again.')
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
      navigator.geolocation.getCurrentPosition((pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setCity('My Location')
      }, () => {}, { timeout: 5000 })
    }
  }, [])

  return (
    <div className={darkMode ? 'weather-app dark' : 'weather-app'}>
      <div className="header-row">
        <h1>🌍 Weather Forecast</h1>
        <button className="icon-btn" onClick={() => setDarkMode(!darkMode)}>
          {darkMode ? '☀️' : '🌙'}
        </button>
      </div>

      <div className="search-wrapper">
        <div className="search-row">
          <input
            type="text"
            placeholder="Search any city in the world..."
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setSuggestions([])}
            autoComplete="off"
          />
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

      <div className="info-line">
        📡 Live data from Open-Meteo · Auto-refresh every 15 min
      </div>

      <div className="city-row">
        {quickCities.map((c) => (
          <button
            key={c.name}
            onClick={() => { setCity(c.name); setCoords({ lat: c.lat, lon: c.lon }) }}
            className={city === c.name ? 'city-btn active' : 'city-btn'}
          >
            {c.name}
          </button>
        ))}
      </div>

      {loading && (
        <div className="card center-text">
          <p style={{ fontSize: '1.5rem' }}>⏳ Loading...</p>
        </div>
      )}

      {error && !loading && (
        <div className="card center-text">
          <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>⚠️ {error}</p>
          <button className="search-btn" onClick={() => fetchWeather(coords.lat, coords.lon)}>Try Again</button>
        </div>
      )}

      {!loading && !error && weather && (
        <div>
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
                <p className="label">Humidity</p>
                <p className="value">{weather.humidity}%</p>
              </div>
              <div className="stat-box">
                <p>💨</p>
                <p className="label">Wind</p>
                <p className="value">{weather.windSpeed} km/h</p>
              </div>
              <div className="stat-box">
                <p>🕐</p>
                <p className="label">Updated</p>
                <p className="value">{new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>
          </div>

          <div className="card">
            <h3>⏰ Next 24 Hours</h3>
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
            <h3>📅 7-Day Forecast</h3>
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
        </div>
      )}
    </div>
  )
}

export default WeatherApp
