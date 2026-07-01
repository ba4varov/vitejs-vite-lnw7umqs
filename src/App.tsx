import, { useState, useEffect } from 'react';
import './App.css';

const WeatherApp = () => {
  const [city, setCity] = useState('Варна');
  const [searchInput, setSearchInput] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weather, setWeather] = useState<any>(null);
  const [hourly, setHourly] = useState<any[]>([]);
  const [forecast, setForecast] = useState<any[]>([]);

  const cities: Record<string, { lat: number; lon: number }> = {
    'София': { lat: 42.6977, lon: 23.3219 },
    'Варна': { lat: 43.2141, lon: 27.9147 },
    'Пловдив': { lat: 42.1522, lon: 24.7454 },
    'Бургас': { lat: 42.5048, lon: 27.4732 },
    'Русе': { lat: 43.8356, lon: 25.9657 },
    'Стара Загора': { lat: 42.4258, lon: 25.6345 }
  };

  const weekDays = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

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
    };
    return map[code] || { icon: '🌡️', desc: 'Няма данни' };
  };

  const findNearestCity = (userLat: number, userLon: number) => {
    let nearest = 'Варна';
    let minDistance = Infinity;
    Object.keys(cities).forEach(cityName => {
      const coords = cities[cityName];
      const distance = Math.sqrt(
        Math.pow(userLat - coords.lat, 2) + Math.pow(userLon - coords.lon, 2)
      );
      if (distance < minDistance) {
        minDistance = distance;
        nearest = cityName;
      }
    });
    return nearest;
  };

  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const nearestCity = findNearestCity(position.coords.latitude, position.coords.longitude);
          setCity(nearestCity);
        },
        () => {},
        { timeout: 5000 }
      );
    }
  }, []);

  const fetchWeather = async (cityName: string) => {
    setLoading(true);
    setError(null);
    try {
      const { lat, lon } = cities[cityName];
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=8`;

      const response = await fetch(url);
      if (!response.ok) throw new Error('Грешка при заявката');
      const data = await response.json();

      const currentCode = decodeWeatherCode(data.current.weather_code);
      setWeather({
        temp: Math.round(data.current.temperature_2m),
        humidity: data.current.relative_humidity_2m,
        windSpeed: Math.round(data.current.wind_speed_10m),
        description: currentCode.desc,
        icon: currentCode.icon
      });

      const now = new Date();
      const nowISO = now.toISOString().slice(0, 13);
      let startIdx = data.hourly.time.findIndex((t: string) => t.slice(0, 13) === nowISO);
      if (startIdx === -1) startIdx = 0;

      const hourlyResult = [];
      for (let i = 0; i < 24; i++) {
        const idx = startIdx + i;
        if (idx >= data.hourly.time.length) break;
        const timeStr = data.hourly.time[idx];
        const hourNum = timeStr.slice(11, 16);
        const code = decodeWeatherCode(data.hourly.weather_code[idx]);
        hourlyResult.push({
          hour: hourNum,
          temp: Math.round(data.hourly.temperature_2m[idx]),
          icon: code.icon
        });
      }
      setHourly(hourlyResult);

      const dailyResult = [];
      for (let i = 1; i < Math.min(8, data.daily.time.length); i++) {
        const dateObj = new Date(data.daily.time[i]);
        const code = decodeWeatherCode(data.daily.weather_code[i]);
        dailyResult.push({
          day: weekDays[dateObj.getDay()],
          max: Math.round(data.daily.temperature_2m_max[i]),
          min: Math.round(data.daily.temperature_2m_min[i]),
          icon: code.icon
        });
      }
      setForecast(dailyResult);

      setLoading(false);
    } catch (err) {
      setError('Неуспешно зареждане на реални данни. Моля, опитайте отново.');
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWeather(city);
    const interval = setInterval(() => fetchWeather(city), 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [city]);

  const handleSearch = () => {
    const matched = Object.keys(cities).find(
      c => c.toLowerCase() === searchInput.trim().toLowerCase()
    );
    if (matched) {
      setCity(matched);
      setSearchInput('');
    }
  };

  return (
    <div className={`weather-app ${darkMode ? 'dark' : ''}`}>
      <div className="header-row">
        <h1>Прогноза на времето</h1>
        <button className="icon-btn" onClick={() => setDarkMode(!darkMode)}>
          {darkMode ? '☀️' : '🌙'}
        </button>
      </div>

      <div className="search-row">
        <input
          type="text"
          placeholder="Търси град (София, Варна, Пловдив, Бургас, Русе, Стара Загора)..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button className="search-btn" onClick={handleSearch}>Търси</button>
      </div>

      <div className="info-line">
        📍 Реални данни от Open-Meteo · Обновява се автоматично на всеки 15 мин
      </div>

      <div className="city-row">
        {Object.keys(cities).map(c => (
          <button
            key={c}
            onClick={() => setCity(c)}
            className={`city-btn ${city === c ? 'active' : ''}`}
          >
            {c}
          </button>
        ))}
      </div>

      {loading && (
        <div className="card center-text">
          <p style={{ fontSize: '1.5rem' }}>⏳ Зареждане на реални данни...</p>
        </div>
      )}

      {error && !loading && (
        <div className="card center-text">
          <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>⚠️ {error}</p>
          <button className="search-btn" onClick={() => fetchWeather(city)}>
            Опитай отново
          </button>
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
            <h3>⏰ Прогноза за следващите 24 часа</h3>
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
                    <span className="max">{day.max}°</span>
                    <br />
                    <span className="min">{day.min}°</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default WeatherApp;
