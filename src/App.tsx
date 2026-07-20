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
    favorite: 'Любим град',
    humidity: 'Влажност',
    wind: 'Вятър',
    windUnit: 'км/ч',
    updated: 'Обновено',
    feelsLike: 'Усеща се като',
    visibility: 'Видимост',
    pressure: 'Налягане',
    uvIndex: 'UV индекс',
    seaTemp: 'Темп. на водата',
    sunrise: 'Изгрев',
    sunset: 'Залез',
    noSeaData: 'няма данни',
    km: 'км',
    hpa: 'hPa',
    hours24: '⏰ Следващите 24 часа',
    days14: '📅 Прогноза за 14 дни',
    myLocation: 'Моето местоположение',
    error: 'Неуспешно зареждане. Моля, опитайте отново.',
    chart: '📊 Графики за 24 часа',
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
    minMaxTemp: 'Мин / Макс Темп.',
    precipProb: 'Вероятност валеж',
    precipSum: 'Общо валежи',
    maxWind: 'Макс. вятър',
    airQuality: 'Качество на въздуха (AQI)',
    aqi: 'AQI Индекс',
    pm10: 'ФПЧ 10 (PM10)',
    pm25: 'ФПЧ 2.5 (PM2.5)',
    aqiChart: 'AQI Индекс (24 часа)',
    weekDays: ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
    months: ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'],
    highTemp: 'Опасно високи температури! (Над 35°C)',
    lowTemp: 'Опасно ниски температури! Опасност от измръзване.',
    highWind: 'Предупреждение за силен ураганен вятър!',
    highUv: 'Екстремен UV индекс! Пазете се от слънцето.',
    storm: 'Опасност: Приближава гръмотевична буря!',
    heavySnow: 'Предупреждение за обилен снеговалеж!',
    heavyRain: 'Опасност от проливни дъждове и наводнения!',
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
    favorite: 'Favorite City',
    humidity: 'Humidity',
    wind: 'Wind',
    windUnit: 'km/h',
    updated: 'Updated',
    feelsLike: 'Feels Like',
    visibility: 'Visibility',
    pressure: 'Pressure',
    uvIndex: 'UV Index',
    seaTemp: 'Water Temp',
    sunrise: 'Sunrise',
    sunset: 'Sunset',
    noSeaData: 'n/a',
    km: 'km',
    hpa: 'hPa',
    hours24: '⏰ Next 24 Hours',
    days14: '📅 14-Day Forecast',
    myLocation: 'My Location',
    error: 'Failed to load weather data. Please try again.',
    chart: '📊 24-Hour Charts',
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
    minMaxTemp: 'Min / Max Temp',
    precipProb: 'Precip Chance',
    precipSum: 'Total Precip',
    maxWind: 'Max Wind',
    airQuality: 'Air Quality (AQI)',
    aqi: 'AQI Index',
    pm10: 'PM10',
    pm25: 'PM2.5',
    aqiChart: 'AQI (24 Hours)',
    weekDays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    highTemp: 'Extreme high temperatures! (Above 35°C)',
    lowTemp: 'Extreme low temperatures! Frost warning.',
    highWind: 'Severe gale/hurricane wind warning!',
    highUv: 'Extreme UV index! Avoid sun exposure.',
    storm: 'Danger: Thunderstorm approaching!',
    heavySnow: 'Heavy snowfall warning!',
    heavyRain: 'Heavy rainfall and flooding risk!',
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

const getDynamicBackground = (temp: number, imgUrl: string) => {
  let rgbDark, rgbLight;
  if (temp <= 0) {
    rgbDark = '15, 23, 42'; 
    rgbLight = '56, 189, 248'; 
  } else if (temp <= 15) {
    rgbDark = '6, 78, 59'; 
    rgbLight = '52, 211, 153'; 
  } else if (temp <= 29) {
    rgbDark = '120, 53, 15'; 
    rgbLight = '251, 191, 36'; 
  } else {
    rgbDark = '127, 29, 29'; 
    rgbLight = '248, 113, 113'; 
  }
  return `linear-gradient(to right, rgba(${rgbDark}, 0.95) 0%, rgba(${rgbDark}, 0.6) 50%, rgba(${rgbLight}, 0.1) 100%), url('${imgUrl}') center / cover no-repeat`;
}

const getIconAnimation = (icon: string) => {
  if (icon === '☀️') return 'spin-slow'
  if (icon === '🌤️' || icon === '⛅') return 'float'
  if (icon === '🌧️' || icon === '🌦️') return 'bounce-rain'
  if (icon === '⛈️') return 'flash'
  if (icon === '❄️' || icon === '🌨️') return 'fall'
  if (icon === '🌫️') return 'drift'
  return 'float'
}

const AnimatedIcon = ({ icon, size }: { icon: string, size?: string }) => {
  const sz = size || '1.5rem'
  return (
    <span className={'animated-icon ' + getIconAnimation(icon)} style={{ fontSize: sz, display: 'inline-block' }}>
      {icon}
    </span>
  )
}

const SingleChart = ({ hourly, darkMode, type, label, unit, color }: any) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current || !hourly.length) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    const padL = 40, padR = 15, padT = 30, padB = 60 
    const chartW = W - padL - padR, chartH = H - padT - padB
    ctx.clearRect(0, 0, W, H)

    const data = hourly.map((h: any) =>
      type === 'temp' ? h.temp :
      type === 'rain' ? (h.rain <= 0 ? 0 : h.rain) :
      type === 'pressure' ? h.pressure :
      type === 'aqi' ? h.aqi :
      h.wind
    )
    const labels = hourly.map((h: any) => h.hour)

    let minVal = type === 'rain' || type === 'aqi' ? 0 : Math.min(...data)
    let maxVal = type === 'rain' ? Math.max(1, Math.max(...data)) : Math.max(...data)
    if (minVal === maxVal) { maxVal += 1; minVal -= 1; }
    const range = maxVal - minVal

    const xStep = chartW / (data.length - 1)
    const yScale = (val: number) => padT + chartH - ((val - minVal) / range) * chartH
    const xScale = (i: number) => padL + i * xStep

    const textColor = darkMode ? '#e2e8f0' : '#1e293b'
    const gridColor = darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

    ctx.strokeStyle = gridColor
    ctx.lineWidth = 1
    
    for (let i = 0; i <= 4; i++) {
      const y = padT + (chartH / 4) * i
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke()
      
      ctx.fillStyle = textColor; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'right'
      ctx.fillText(Math.round(maxVal - (range / 4) * i).toString(), padL - 8, y + 4)
    }
    
    ctx.fillStyle = textColor; 
    ctx.font = 'bold 12px Arial'; 
    ctx.textAlign = 'right'; 
    ctx.textBaseline = 'middle'; 

    data.forEach((_: any, i: number) => { 
      const x = xScale(i);
      const y = padT + chartH + 18; 
      
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 4);
      ctx.fillText(labels[i], 0, 0);
      ctx.restore();
    })

    const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH)
    grad.addColorStop(0, color + '55'); grad.addColorStop(1, color + '00')
    
    ctx.beginPath(); ctx.moveTo(xScale(0), yScale(data[0]))
    data.forEach((val: number, i: number) => {
      if (i === 0) return
      const cpx = (xScale(i - 1) + xScale(i)) / 2
      ctx.bezierCurveTo(cpx, yScale(data[i - 1]), cpx, yScale(val), xScale(i), yScale(val))
    })
    ctx.lineTo(xScale(data.length - 1), padT + chartH); ctx.lineTo(xScale(0), padT + chartH)
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill()
    
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2.5
    data.forEach((val: number, i: number) => {
      if (i === 0) { ctx.moveTo(xScale(0), yScale(val)); return }
      const cpx = (xScale(i - 1) + xScale(i)) / 2
      ctx.bezierCurveTo(cpx, yScale(data[i - 1]), cpx, yScale(val), xScale(i), yScale(val))
    })
    ctx.stroke()
    
    data.forEach((val: number, i: number) => {
      ctx.beginPath(); ctx.arc(xScale(i), yScale(val), 3, 0, Math.PI * 2)
      ctx.fillStyle = color; ctx.fill()
      ctx.strokeStyle = darkMode ? '#1e293b' : 'white'; ctx.lineWidth = 1.5; ctx.stroke()
    })
  }, [hourly, type, darkMode, color])

  return (
    <div className="mini-chart">
      <h4 style={{ color: color, marginBottom: '16px', textAlign: 'center', fontSize: '1.1rem' }}>
        {label} <span style={{ opacity: 0.7, fontSize: '0.8em' }}>({unit})</span>
      </h4>
      <canvas ref={canvasRef} width={800} height={400} style={{ width: '100%', height: 'auto', display: 'block' }} />
    </div>
  )
}

const Chart = ({ hourly, darkMode, t }: any) => {
  const chartsData = [
    { key: 'temp', label: t.temp, unit: '°C', color: '#f97316' },
    { key: 'rain', label: t.rain, unit: t.mm, color: '#3b82f6' },
    { key: 'wind', label: t.windChart, unit: t.windUnit, color: '#10b981' },
    { key: 'pressure', label: t.pressureChart, unit: t.hpa, color: '#a855f7' }
  ]

  return (
    <div className="card">
      <h3>{t.chart}</h3>
      <div className="charts-grid">
        {chartsData.map(c => (
          <SingleChart key={c.key} hourly={hourly} darkMode={darkMode} type={c.key} label={c.label} unit={c.unit} color={c.color} />
        ))}
      </div>
    </div>
  )
}

const WeatherApp = () => {
  const [lang, setLang] = useState('bg')
  const [city, setCity] = useState('Варна')
  const [coords, setCoords] = useState({ lat: 43.2141, lon: 27.9147 })
  const [exactLocation, setExactLocation] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [darkMode, setDarkMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [weather, setWeather] = useState<any>(null)
  const [hourly, setHourly] = useState<any[]>([])
  const [forecast, setForecast] = useState<any[]>([])
  const [favoriteCity, setFavoriteCity] = useState<{name: string, lat: number, lon: number} | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null) 
  const [bgImageUrl, setBgImageUrl] = useState<string>('')
  
  const [selectedDay, setSelectedDay] = useState<any>(null)
  const [selectedHour, setSelectedHour] = useState<any>(null)
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 })
  const [detailTab, setDetailTab] = useState('main')
  
  const searchTimer = useRef<any>(null)
  const t = translations[lang as keyof typeof translations]

  useEffect(() => {
    const savedFav = localStorage.getItem('bobbyWeatherFav')
    if (savedFav) {
      try {
        setFavoriteCity(JSON.parse(savedFav))
      } catch (e) {}
    }
  }, [])

  const toggleFavorite = () => {
    if (favoriteCity && favoriteCity.name === city) {
      setFavoriteCity(null)
      localStorage.removeItem('bobbyWeatherFav')
    } else {
      const newFav = { name: city, lat: coords.lat, lon: coords.lon }
      setFavoriteCity(newFav)
      localStorage.setItem('bobbyWeatherFav', JSON.stringify(newFav))
    }
  }

  const decodeWeatherCode = (code: number) => {
    const icons: Record<number, string> = {
      0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
      51: '🌦️', 53: '🌦️', 55: '🌧️', 61: '🌧️', 63: '🌧️', 65: '🌧️',
      71: '🌨️', 73: '🌨️', 75: '❄️', 80: '🌦️', 81: '🌧️', 82: '⛈️',
      95: '⛈️', 96: '⛈️', 99: '⛈️'
    }
    return { icon: icons[code] || '🌡️', desc: (t.weather as any)[code] || 'Unknown' }
  }

  const searchCities = async (query: string) => {
    if (query.length < 2) { setSuggestions([]); return }
    try {
      const res = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(query) + '&count=10&language=' + lang + '&format=json')
      const data = await res.json()
      setSuggestions(data.results || [])
    } catch (e) { setSuggestions([]) }
  }

  const handleSearchInput = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => searchCities(val), 300)
  }

  const selectCity = (result: any) => {
    const name = result.name + (result.country ? ', ' + result.country : '')
    setCity(name)
    setCoords({ lat: result.latitude, lon: result.longitude })
    setSearchInput('')
    setSuggestions([])
    setSelectedDay(null)
    setSelectedHour(null)
    setExactLocation(null) 
  }

  const formatTime = (isoString: string) => {
    if (!isoString) return '--:--';
    const date = new Date(isoString);
    return date.toLocaleTimeString(lang === 'bg' ? 'bg-BG' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  }

  const fetchWeather = async (lat: number, lon: number) => {
    setLoading(true)
    setError(null)
    try {
      const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + 
        '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature,visibility,surface_pressure,uv_index,cloud_cover' + 
        '&hourly=temperature_2m,weather_code,precipitation,wind_speed_10m,surface_pressure,relative_humidity_2m,visibility,dew_point_2m,cloud_cover,apparent_temperature' + 
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max,apparent_temperature_max,sunrise,sunset' + 
        '&timezone=auto&forecast_days=15';

      const marineUrl = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + lat + '&longitude=' + lon + 
        '&current=sea_surface_temperature&hourly=sea_surface_temperature&timezone=auto&forecast_days=15';

      const aqiUrl = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + lat + '&longitude=' + lon + 
        '&current=european_aqi,pm10,pm2_5&hourly=european_aqi&timezone=auto&forecast_days=3';

      const [weatherRes, marineRes, aqiRes] = await Promise.allSettled([
        fetch(weatherUrl),
        fetch(marineUrl),
        fetch(aqiUrl)
      ])
      
      if (weatherRes.status !== 'fulfilled' || !weatherRes.value.ok) throw new Error('Моля проверете връзката си с интернет.')
      const data = await weatherRes.value.json()

      let seaTemp = null
      let hourlySeaTemp: any[] = []
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

      let currentAqi = null, currentPm10 = null, currentPm25 = null;
      let hourlyAqi: any[] = [];
      if (aqiRes.status === 'fulfilled' && aqiRes.value.ok) {
        try {
          const aqiData = await aqiRes.value.json();
          if (aqiData.current) {
            currentAqi = Math.round(aqiData.current.european_aqi);
            currentPm10 = aqiData.current.pm10;
            currentPm25 = aqiData.current.pm2_5;
          }
          if (aqiData.hourly && aqiData.hourly.european_aqi) {
            hourlyAqi = aqiData.hourly.european_aqi;
          }
        } catch (e) {}
      }

      const cur = decodeWeatherCode(data.current.weather_code)
      
      setWeather({
        temp: Math.round(data.current.temperature_2m),
        minTemp: Math.round(data.daily.temperature_2m_min[0]),
        maxTemp: Math.round(data.daily.temperature_2m_max[0]),
        precipProb: data.daily.precipitation_probability_max[0] || 0,
        precipSum: (data.daily.precipitation_sum[0] || 0).toFixed(1),
        cloudCover: data.current.cloud_cover || 0,
        maxWindSpeedDaily: Math.round(data.daily.wind_speed_10m_max[0] || 0),
        humidity: data.current.relative_humidity_2m,
        windSpeed: Math.round(data.current.wind_speed_10m),
        feelsLike: Math.round(data.current.apparent_temperature),
        visibility: Math.round((data.current.visibility || 0) / 1000),
        pressure: Math.round(data.current.surface_pressure),
        uvIndex: Math.round(data.current.uv_index),
        sunrise: data.daily.sunrise && data.daily.sunrise[0] ? formatTime(data.daily.sunrise[0]) : '--:--',
        sunset: data.daily.sunset && data.daily.sunset[0] ? formatTime(data.daily.sunset[0]) : '--:--',
        code: data.current.weather_code,
        seaTemp: seaTemp,
        description: cur.desc,
        icon: cur.icon,
        aqi: currentAqi,
        pm10: currentPm10,
        pm25: currentPm25
      })

      const now = new Date()
      const localISO = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + 'T' +
        String(now.getHours()).padStart(2, '0')
      let startIdx = data.hourly.time.findIndex((time: string) => time.slice(0, 13) === localISO)
      if (startIdx === -1) startIdx = 0

      const hr: any[] = []
      for (let i = 0; i < 24; i++) {
        const idx = startIdx + i
        if (idx >= data.hourly.time.length) break
        const code = decodeWeatherCode(data.hourly.weather_code[idx])
        const sst = hourlySeaTemp.length > idx ? hourlySeaTemp[idx] : null
        const aqiVal = hourlyAqi.length > idx ? hourlyAqi[idx] : null
        
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
          aqi: aqiVal !== null ? Math.round(aqiVal) : 0,
          icon: code.icon
        })
      }
      setHourly(hr)

      const days: any[] = []
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
          dayName: (t.weekDays as any)[d.getDay()],
          dateFormatted: `${d.getDate()} ${(t.months as any)[d.getMonth()]}`,
          max: Math.round(data.daily.temperature_2m_max[i]),
          min: Math.round(data.daily.temperature_2m_min[i]),
          feelsLikeMax: Math.round(data.daily.apparent_temperature_max[i] || data.daily.temperature_2m_max[i]),
          icon: code.icon,
          rain: Math.max(0, data.daily.precipitation_sum[i] || 0).toFixed(1),
          wind: Math.round(data.daily.wind_speed_10m_max[i] || 0),
          uv: Math.round(data.daily.uv_index_max[i] || 0),
          sunrise: data.daily.sunrise && data.daily.sunrise[i] ? formatTime(data.daily.sunrise[i]) : '--:--',
          sunset: data.daily.sunset && data.daily.sunset[i] ? formatTime(data.daily.sunset[i]) : '--:--',
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
      setLastUpdated(new Date())

      // ПОДОБРЕН КАТАЛОГ СЪС СНИМКИ ЧРЕЗ POLLINATIONS AI
      const cityNameForImage = city.split(',')[0].trim();
      const timestamp = new Date().getTime();
      const prompt = encodeURIComponent(`${cityNameForImage} beautiful city landmark landscape daytime photography high quality 8k`);
      setBgImageUrl(`https://image.pollinations.ai/prompt/${prompt}?width=1200&height=800&nologo=true&random=${timestamp}`);

    } catch (e: any) {
      console.error(e);
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
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=${lang}&zoom=18`)
          const data = await res.json()
          
          const address = data.address;
          const mainCity = address.city || address.town || address.village || address.county || t.myLocation;
          setCity(mainCity);

          const exactDetails = [];
          const street = address.road || address.pedestrian || address.street;
          
          if (street) {
            exactDetails.push(street);
          }
          if (address.house_number) {
            exactDetails.push(address.house_number);
          }
          
          if (exactDetails.length === 0) {
            const neighborhood = address.suburb || address.neighbourhood || address.city_district;
            if (neighborhood) exactDetails.push(neighborhood);
          }
          
          if (exactDetails.length > 0) {
            setExactLocation(exactDetails.join(' '));
          } else {
            setExactLocation(null);
          }

        } catch (e) { setCity(t.myLocation) }
      }, () => {}, { timeout: 5000 })
    }
  }, [])

  const activeAlerts = [];
  if (weather) {
    if (weather.temp >= 35) activeAlerts.push({ icon: '🔥', text: (t as any).highTemp });
    if (weather.temp <= -5) activeAlerts.push({ icon: '❄️', text: (t as any).lowTemp });
    if (weather.windSpeed >= 65) activeAlerts.push({ icon: '⚠️', text: (t as any).highWind });
    if (weather.uvIndex >= 8) activeAlerts.push({ icon: '☀️', text: (t as any).highUv });
    if ([95, 96, 99].includes(weather.code)) activeAlerts.push({ icon: '⚡', text: (t as any).storm });
    if (weather.code === 75) activeAlerts.push({ icon: '🌨️', text: (t as any).heavySnow });
    if (weather.code === 65 || weather.code === 82) activeAlerts.push({ icon: '🌧️', text: (t as any).heavyRain });
  }

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
        {favoriteCity && (
          <button 
            onClick={() => { setCity(favoriteCity.name); setCoords({ lat: favoriteCity.lat, lon: favoriteCity.lon }); setExactLocation(null); }}
            className={city === favoriteCity.name ? 'city-btn fav-btn active' : 'city-btn fav-btn'}
          >
            ⭐ {favoriteCity.name}
          </button>
        )}
        
        {t.quickCities.map((c: any) => {
          if (favoriteCity && favoriteCity.name === c.name) return null;
          return (
            <button key={c.name}
              onClick={() => { setCity(c.name); setCoords({ lat: c.lat, lon: c.lon }); setExactLocation(null); }}
              className={city === c.name ? 'city-btn active' : 'city-btn'}>
              {c.name}
            </button>
          )
        })}
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
          {activeAlerts.length > 0 && (
            <div className="alerts-container">
              {activeAlerts.map((alert, idx) => (
                <div key={idx} className="alert-item">
                  <span style={{fontSize: '1.8rem'}}>{alert.icon}</span>
                  <span>{alert.text}</span>
                </div>
              ))}
            </div>
          )}

          <div className="card main-card" style={{ 
            background: getDynamicBackground(weather.temp, bgImageUrl)
          }}>
            <div className="main-top">
              <div className="main-info-left">
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  <span>📍 {city}</span>
                  {exactLocation && (
                    <span style={{ fontSize: '1.1rem', opacity: 0.9, fontWeight: 'normal', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{opacity: 0.5, margin: '0 4px'}}>|</span> 🎯 {exactLocation}
                    </span>
                  )}
                  <button onClick={toggleFavorite} className="star-btn" title={t.favorite} style={{ marginLeft: '4px' }}>
                    {favoriteCity?.name === city ? '⭐' : '☆'}
                  </button>
                </h2>
                <p className="desc" style={{ marginBottom: '8px' }}>{weather.description}</p>
                {lastUpdated && (
                  <p style={{ fontSize: '0.85rem', opacity: 0.75, display: 'flex', alignItems: 'center', gap: '5px' }}>
                    🔄 {t.updated} {lastUpdated.toLocaleTimeString(lang === 'bg' ? 'bg-BG' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
                <div className="big-temp">{weather.temp}°C</div>
              </div>
              <div className="big-icon"><AnimatedIcon icon={weather.icon} size="7.5rem" /></div>
            </div>
            
            <div className="stats-grid">
              <div className="stat-box"><p>🌡️↕️</p><p className="label">{t.minMaxTemp}</p><p className="value">{weather.minTemp}° / {weather.maxTemp}°</p></div>
              <div className="stat-box"><p>🌡️</p><p className="label">{t.feelsLike}</p><p className="value">{weather.feelsLike}°C</p></div>
              <div className="stat-box"><p>☔</p><p className="label">{t.precipProb}</p><p className="value">{weather.precipProb}%</p></div>
              <div className="stat-box"><p>🌧️</p><p className="label">{t.precipSum}</p><p className="value">{weather.precipSum} {t.mm}</p></div>
              <div className="stat-box"><p>☁️</p><p className="label">{t.cloudCover}</p><p className="value">{weather.cloudCover}%</p></div>
              <div className="stat-box"><p>💧</p><p className="label">{t.humidity}</p><p className="value">{weather.humidity}%</p></div>
              <div className="stat-box"><p>🌬️</p><p className="label">{t.wind}</p><p className="value">{weather.windSpeed} {t.windUnit}</p></div>
              <div className="stat-box"><p>🌪️</p><p className="label">{t.maxWind}</p><p className="value">{weather.maxWindSpeedDaily} {t.windUnit}</p></div>
              <div className="stat-box"><p>👁️</p><p className="label">{t.visibility}</p><p className="value">{weather.visibility} {t.km}</p></div>
              <div className="stat-box"><p>🔵</p><p className="label">{t.pressure}</p><p className="value">{weather.pressure} {t.hpa}</p></div>
              <div className="stat-box"><p>☀️</p><p className="label">{t.uvIndex}</p><p className="value">{weather.uvIndex}</p></div>
              <div className="stat-box"><p>🌅</p><p className="label">{t.sunrise}</p><p className="value">{weather.sunrise}</p></div>
              <div className="stat-box"><p>🌇</p><p className="label">{t.sunset}</p><p className="value">{weather.sunset}</p></div>
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
                    let x = rect.left + (rect.width / 2) - 150;
                    let y = rect.top - 320;
                    if (x < 10) x = 10;
                    if (x + 300 > window.innerWidth - 10) x = window.innerWidth - 310;
                    if (y < 10) y = rect.bottom + 15;
                    setPopupPos({ x, y });
                    setSelectedHour(h); 
                    setDetailTab('main'); 
                  }}
                  style={{ 
                    cursor: 'pointer', 
                    boxShadow: selectedHour?.hour === h.hour ? '0 0 0 3px rgba(30,41,55,0.2)' : 'none',
                    transform: selectedHour?.hour === h.hour ? 'scale(1.05)' : 'none',
                    transition: 'all 0.2s',
                    position: 'relative'
                  }}
                >
                  <p className="hour-time">{h.hour}</p>
                  <p className="hour-icon"><AnimatedIcon icon={h.icon} size="1.5rem" /></p>
                  <p className="hour-temp">{h.temp}°C</p>
                  <p className="hour-wind">🌬️ {h.wind} {t.windUnit}</p>
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
                    let x = rect.left + (rect.width / 2) - 150;
                    let y = rect.top - 320;
                    if (x < 10) x = 10;
                    if (x + 300 > window.innerWidth - 10) x = window.innerWidth - 310;
                    if (y < 10) y = rect.bottom + 15;
                    setPopupPos({ x, y });
                    setSelectedDay(day); 
                    setDetailTab('main'); 
                  }}
                  style={{ 
                    cursor: 'pointer', 
                    boxShadow: selectedDay?.dateStr === day.dateStr ? '0 0 0 3px rgba(30,41,55,0.2)' : 'none',
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
                  <p className="day-wind">🌬️ {day.wind}{t.windUnit}</p>
                </div>
              ))}
            </div>
          </div>

          {/* НОВ СЕКТОР: Качество на въздуха */}
          {weather.aqi !== null && (
            <div className="card">
              <h3>🍃 {t.airQuality}</h3>
              <div className="stats-grid" style={{ marginBottom: '24px' }}>
                  <div className="stat-box"><p>😷</p><p className="label">{t.aqi}</p><p className="value">{weather.aqi}</p></div>
                  <div className="stat-box"><p>🌫️</p><p className="label">{t.pm10}</p><p className="value">{weather.pm10} µg/m³</p></div>
                  <div className="stat-box"><p>🔬</p><p className="label">{t.pm25}</p><p className="value">{weather.pm25} µg/m³</p></div>
              </div>
              <div className="charts-grid" style={{ gridTemplateColumns: '1fr' }}>
                  <SingleChart hourly={hourly.slice(0, 24)} darkMode={darkMode} type="aqi" label={t.aqiChart} unit="AQI" color="#0ea5e9" />
              </div>
            </div>
          )}

        </div>
      )}

      {selectedDay && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998, background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(2px)' }} onClick={() => setSelectedDay(null)}>
          <div className="card popup-card" style={{ position: 'fixed', top: popupPos.y, left: popupPos.x, margin: 0, background: darkMode ? '#1e293b' : '#ffffff', color: darkMode ? '#ffffff' : '#1e293b', boxShadow: '0 15px 50px rgba(0,0,0,0.15)', border: '1px solid rgba(0,0,0,0.05)', zIndex: 9999, cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h4 style={{ fontSize: '1.1rem', margin: 0 }}>{t.detailsFor} {selectedDay.dayName}</h4>
              <button className="icon-btn" style={{ fontSize: '0.9rem', padding: '4px 8px', background: 'rgba(0,0,0,0.05)' }} onClick={() => setSelectedDay(null)}>❌</button>
            </div>
            <div className="chart-tabs">
              <button className={'chart-tab ' + (detailTab === 'main' ? 'active-temp' : '')} onClick={() => setDetailTab('main')}>{t.tabMain}</button>
              <button className={'chart-tab ' + (detailTab === 'atmosphere' ? 'active-temp' : '')} onClick={() => setDetailTab('atmosphere')}>{t.tabAtmosphere}</button>
              <button className={'chart-tab ' + (detailTab === 'water' ? 'active-temp' : '')} onClick={() => setDetailTab('water')}>{t.tabWaterWind}</button>
            </div>
            <div className="stats-grid popup-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {detailTab === 'main' && <>
                <div className="stat-box"><p>🌡️</p><p className="label">{t.temp}</p><p className="value">{selectedDay.min}° / {selectedDay.max}°</p></div>
                <div className="stat-box"><p>🤔</p><p className="label">{t.feelsLike}</p><p className="value">до {selectedDay.feelsLikeMax}°</p></div>
                <div className="stat-box"><p>🌅</p><p className="label">{t.sunrise}</p><p className="value">{selectedDay.sunrise}</p></div>
                <div className="stat-box"><p>🌇</p><p className="label">{t.sunset}</p><p className="value">{selectedDay.sunset}</p></div>
                <div className="stat-box"><p>💧</p><p className="label">{t.humidity}</p><p className="value">{selectedDay.humidity}%</p></div>
                <div className="stat-box"><p>☀️</p><p className="label">{t.uvIndex}</p><p className="value">{selectedDay.uv}</p></div>
              </>}
              {detailTab === 'atmosphere' && <>
                <div className="stat-box"><p>🔵</p><p className="label">{t.pressure}</p><p className="value">{selectedDay.pressure} {t.hpa}</p></div>
                <div className="stat-box"><p>👁️</p><p className="label">{t.visibility}</p><p className="value">{selectedDay.visibility} {t.km}</p></div>
                <div className="stat-box"><p>☁️</p><p className="label">{t.cloudCover}</p><p className="value">{selectedDay.cloudCover}%</p></div>
                <div className="stat-box"><p>🌿</p><p className="label">{t.dewPoint}</p><p className="value">{selectedDay.dewPoint}°C</p></div>
              </>}
              {detailTab === 'water' && <>
                <div className="stat-box"><p>🌬️</p><p className="label">{t.wind}</p><p className="value">{selectedDay.wind} {t.windUnit}</p></div>
                <div className="stat-box"><p>🌧️</p><p className="label">{t.rain}</p><p className="value">{selectedDay.rain} {t.mm}</p></div>
                {selectedDay.seaTemp !== null ? (
                  <div className="stat-box sea-temp-box"><p>🌊</p><p className="label">{t.seaTemp}</p><p className="value">{selectedDay.seaTemp}°C</p></div>
                ) : (
                  <div className="stat-box"><p>🌊</p><p className="label">{t.seaTemp}</p><p className="value">{t.noSeaData}</p></div>
                )}
              </>}
            </div>
          </div>
        </div>
      )}

      {selectedHour && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998, background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(2px)' }} onClick={() => setSelectedHour(null)}>
          <div className="card popup-card" style={{ position: 'fixed', top: popupPos.y, left: popupPos.x, margin: 0, background: darkMode ? '#1e293b' : '#ffffff', color: darkMode ? '#ffffff' : '#1e293b', boxShadow: '0 15px 50px rgba(0,0,0,0.15)', border: '1px solid rgba(0,0,0,0.05)', zIndex: 9999, cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h4 style={{ fontSize: '1.1rem', margin: 0 }}>{t.detailsFor} {selectedHour.hour} ч.</h4>
              <button className="icon-btn" style={{ fontSize: '0.9rem', padding: '4px 8px', background: 'rgba(0,0,0,0.05)' }} onClick={() => setSelectedHour(null)}>❌</button>
            </div>
            <div className="chart-tabs">
              <button className={'chart-tab ' + (detailTab === 'main' ? 'active-temp' : '')} onClick={() => setDetailTab('main')}>{t.tabMain}</button>
              <button className={'chart-tab ' + (detailTab === 'atmosphere' ? 'active-temp' : '')} onClick={() => setDetailTab('atmosphere')}>{t.tabAtmosphere}</button>
              <button className={'chart-tab ' + (detailTab === 'water' ? 'active-temp' : '')} onClick={() => setDetailTab('water')}>{t.tabWaterWind}</button>
            </div>
            <div className="stats-grid popup-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {detailTab === 'main' && <>
                <div className="stat-box"><p>🌡️</p><p className="label">{t.temp}</p><p className="value">{selectedHour.temp}°C</p></div>
                <div className="stat-box"><p>🤔</p><p className="label">{t.feelsLike}</p><p className="value">{selectedHour.feelsLike}°C</p></div>
                <div className="stat-box"><p>💧</p><p className="label">{t.humidity}</p><p className="value">{selectedHour.humidity}%</p></div>
                <div className="stat-box"><p>☁️</p><p className="label">Време</p><p className="value" style={{ marginTop: '4px' }}><AnimatedIcon icon={selectedHour.icon} size="1.2rem" /></p></div>
              </>}
              {detailTab === 'atmosphere' && <>
                <div className="stat-box"><p>🔵</p><p className="label">{t.pressure}</p><p className="value">{selectedHour.pressure} {t.hpa}</p></div>
                <div className="stat-box"><p>👁️</p><p className="label">{t.visibility}</p><p className="value">{selectedHour.visibility} {t.km}</p></div>
                <div className="stat-box"><p>☁️</p><p className="label">{t.cloudCover}</p><p className="value">{selectedHour.cloudCover}%</p></div>
                <div className="stat-box"><p>🌿</p><p className="label">{t.dewPoint}</p><p className="value">{selectedHour.dewPoint}°C</p></div>
              </>}
              {detailTab === 'water' && <>
                <div className="stat-box"><p>🌬️</p><p className="label">{t.wind}</p><p className="value">{selectedHour.wind} {t.windUnit}</p></div>
                <div className="stat-box"><p>🌧️</p><p className="label">{t.rain}</p><p className="value">{selectedHour.rain} {t.mm}</p></div>
                {selectedHour.seaTemp !== null ? (
                  <div className="stat-box sea-temp-box"><p>🌊</p><p className="label">{t.seaTemp}</p><p className="value">{selectedHour.seaTemp}°C</p></div>
                ) : (
                  <div className="stat-box"><p>🌊</p><p className="label">{t.seaTemp}</p><p className="value">{t.noSeaData}</p></div>
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
