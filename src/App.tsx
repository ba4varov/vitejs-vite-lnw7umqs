import type { ConversationContext, PendingClarification } from '../server/weather-chat-core.js'
import { startupTiming, startupLifecycle } from './startup-timing.js'
import { createInitialLocation } from './initial-location.js'
import { createForecastRequests, enrichForecast } from './forecast-sources.js'
import { formatAqiValue } from './aqi-display.js'
import { trackActivity } from './activity-client'
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import './App.css'
import { WeatherAdvice } from './WeatherAdvice'
import { WindyMap } from './WindyMap'
import { ForecastPeriodCard } from './ForecastPeriodCard'
import { Chart, SingleChart } from './WeatherCharts'
import { formatWeatherValue, meanObservation, hourlyNumber, findHourlyStartIndex } from './weather-utils.js'
import { ProjectShowcase } from './ProjectShowcase'
import { AdSlot } from './AdSlot'
import { AuthPanel, type AuthPanelHandle } from './AuthPanel'
import { WeatherNotifications } from './WeatherNotifications'
import { WeatherPlanner } from './WeatherPlanner'
import { AdminLink } from './AdminLink'
import { HeaderNavigation } from './HeaderNavigation'
import { ForecastSectionOrder } from './ForecastSectionOrder'
import { loadLanguage, saveLanguage } from './language-storage.js'
import { subscribeSession, type AuthSession } from './auth-client'
import { addPlace, fetchPlaces, importPlaces, localPlaces, removePlace, saveLocalPlaces, setDefaultPlace, setPlaceIdentity, type Place } from './places-client'
import { placeKey } from './places-core.js'
import { createPlacesSessionGuard } from './places-session-guard.js'
import { localizePlace } from './place-localization'
import { placesErrorText, placesFailure } from './places-sync.js'
import { localizeAccountPlaces } from './account-place-localization.js'
import { createLocalizationGuard } from './place-localization-core.js'
import { localizeCurrentLocation, locationFromReverseGeocode, reverseGeocodeLocation } from './current-location-localization.js'

const translations = {
  bg: {
    title: '🌤️ Метео Пулс',
    subtitle: 'Твоят метео гид',
    search: 'Търси град по целия свят...',
    info: '📡 Реални данни от Open-Meteo · Обновява се на всеки 15 мин',
    loading: '⏳ Зареждане...',
    refreshing: 'Обновяване…',
    loadingForecast: 'Подготвяме прогнозата за',
    tryAgain: 'Опитай отново',
    favorite: 'Любим град',
    allMetrics: 'Всички показатели',
    fewerMetrics: 'По-малко показатели',
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
    interactiveMap: 'Жива метеорологична карта',
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
    aqiNoData: 'Няма данни',
    chatTitle: 'Попитай Боби за времето',
    chatSubtitle: 'Съветите се съобразяват с актуалната прогноза за избраното място.',
    chatPlaceholder: 'Напр. Да взема ли чадър?',
    chatSend: 'Изпрати',
    chatGreeting: 'Здравей! Аз съм Боби. Попитай ме как да се подготвиш за времето.',
    chatSuggestions: ['Да взема ли чадър?', 'Как да се облека?', 'Подходящо ли е за разходка?'],
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
    title: '🌤️ Meteo Pulse',
    subtitle: 'Your meteo guide',
    search: 'Search any city in the world...',
    info: '📡 Live data from Open-Meteo · Auto-refresh every 15 min',
    loading: '⏳ Loading...',
    refreshing: 'Updating…',
    loadingForecast: 'Preparing the forecast for',
    tryAgain: 'Try Again',
    favorite: 'Favorite City',
    allMetrics: 'All metrics',
    fewerMetrics: 'Fewer metrics',
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
    interactiveMap: 'Live Weather Map',
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
    aqiNoData: 'No data',
    chatTitle: 'Ask Bobby about the weather',
    chatSubtitle: 'Advice is based on the live forecast for the selected location.',
    chatPlaceholder: 'E.g. Should I take an umbrella?',
    chatSend: 'Send',
    chatGreeting: 'Hi! I am Bobby. Ask me how to prepare for the weather.',
    chatSuggestions: ['Should I take an umbrella?', 'What should I wear?', 'Is it good for a walk?'],
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

const getDynamicOverlay = (temp: number) => {
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
  return `linear-gradient(to right, rgba(${rgbDark}, 0.95) 0%, rgba(${rgbDark}, 0.6) 50%, rgba(${rgbLight}, 0.1) 100%)`;
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

const tLoading = (lang: 'bg' | 'en') => translations[lang].loading

const WeatherApp = () => {
  const [lang, setLang] = useState<'bg' | 'en'>(() => loadLanguage())
  const [city, setCity] = useState('Варна')
  const [coords, setCoords] = useState({ lat: 43.2141, lon: 27.9147 })
  const [exactLocation, setExactLocation] = useState<string | null>(null)
  const [placeDetails, setPlaceDetails] = useState<{ geonameId?: number, countryCode?: string, admin1Id?: number, region?: string, country?: string }>({})
  startupTiming.mark('react')
  const initialLocationRef = useRef(createInitialLocation({ navigator }))
  const [initialLocationReady, setInitialLocationReady] = useState(false)
  const locationRevisionRef = useRef(0)
  const [gpsLabelGeneration, setGpsLabelGeneration] = useState(0)
  const forecastInFlightRef = useRef<{ key: string, id: number } | null>(null)
  const initialDefaultTicketRef = useRef<any>(null)
  const explicitGpsPendingRef = useRef(false)
  const explicitGpsRef = useRef(0)
  const [gpsBusy, setGpsBusy] = useState(false)
  const [gpsError, setGpsError] = useState(false)
  const backgroundLocationRef = useRef<string | null>(null)
  const [locationSource, setLocationSource] = useState<'default' | 'quick' | 'search' | 'place' | 'geolocation'>('default')
  const [searchInput, setSearchInput] = useState('')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle')
  const [darkMode, setDarkMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [metricsExpanded, setMetricsExpanded] = useState(false)
  const [baseWeather, setWeather] = useState<any>(null)
  const [weatherCoords, setWeatherCoords] = useState<{ lat: number, lon: number } | null>(null)
  const [baseHourly, setHourly] = useState<any[]>([])
  const [notificationForecast,setNotificationForecast]=useState<any>(null)
  const [plannerLocation,setPlannerLocation]=useState<any>(null)
  const [plannerForecast, setPlannerForecast] = useState<any>(null)
  const [baseForecast, setForecast] = useState<any[]>([])
  const locationKey = `${coords.lat},${coords.lon}`
  const locationKeyRef = useRef(locationKey)
  locationKeyRef.current = locationKey
  const requestsRef = useRef(createForecastRequests())
  const [sources, setSources] = useState<any>({ key: locationKey, marine: null, aqi: null, marineStatus: 'loading', aqiStatus: 'loading' })
  const currentSources = sources.key === locationKey ? sources : null
  const { weather, hourly, daily: forecast } = useMemo(() => enrichForecast(baseWeather, baseHourly, baseForecast, currentSources), [baseWeather, baseHourly, baseForecast, currentSources])
  const validLocationRef = useRef(weatherCoords)
  validLocationRef.current = weatherCoords
  const hasCurrentForecast = Boolean(weather && weatherCoords?.lat === coords.lat && weatherCoords?.lon === coords.lon)
  const lifecycleInstanceRef = useRef<number | null>(null)
  const lifecycleViewRef = useRef('')
  useEffect(() => {
    if (!startupLifecycle.enabled) return
    lifecycleInstanceRef.current ??= startupLifecycle.instance()
    startupLifecycle.record('app:setup', { instance: lifecycleInstanceRef.current })
    return () => startupLifecycle.record('app:cleanup', { instance: lifecycleInstanceRef.current })
  }, [])
  useEffect(() => {
    if (!startupLifecycle.enabled) return
    const view = hasCurrentForecast ? 'forecast' : !initialLocationReady ? 'initial-location' : error && !loading ? 'error' : 'forecast-loading'
    const signature = `${view}:${initialLocationReady}:${locationSource}`
    if (signature === lifecycleViewRef.current) return
    lifecycleViewRef.current = signature
    startupLifecycle.record('app:view', { instance: lifecycleInstanceRef.current, view, ready: initialLocationReady, hasForecast: hasCurrentForecast, source: locationSource })
  }, [initialLocationReady, hasCurrentForecast, error, loading, locationSource])
  const marineMissing = currentSources?.marineStatus === 'loading' ? tLoading(lang) : translations[lang].noSeaData
  const aqiMissing = currentSources?.aqiStatus === 'loading' ? tLoading(lang) : translations[lang].aqiNoData
  const [places, setPlaces] = useState<Place[]>([])
  const [localizedPlaces, setLocalizedPlaces] = useState<Place[]>([])
  const [defaultPlaceId, setDefaultPlaceId] = useState<string | null>(null)
  const plannerAuth = useRef<AuthPanelHandle>(null)
  const [session, setSession] = useState<AuthSession | null>(null)
  const [placesError, setPlacesError] = useState<string | null>(null)
  const [placesBusy, setPlacesBusy] = useState(false)
  const [offerImport, setOfferImport] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null) 
  const [bgImageUrl, setBgImageUrl] = useState<string>('')
  
  const [daySelection, setSelectedDay] = useState<any>(null)
  const [hourSelection, setSelectedHour] = useState<any>(null)
  const selectedDay = daySelection && { ...daySelection, ...forecast.find(day => day.dateStr === daySelection.dateStr),
    dayName: translations[lang].weekDays[new Date(`${daySelection.dateStr}T12:00:00Z`).getUTCDay()],
    dateFormatted: `${Number(daySelection.dateStr.slice(8, 10))} ${translations[lang].months[Number(daySelection.dateStr.slice(5, 7)) - 1]}` }
  const selectedHour = hourSelection && (hourly.find(hour => hour.time === hourSelection.time) || hourSelection)
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 })
  const [detailTab, setDetailTab] = useState('main')
  
  const [aiAdvice, setAiAdvice] = useState<string | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'bot', text: string }>>([])
  const [chatLoading, setChatLoading] = useState(false)
  
  const searchTimer = useRef<any>(null)
  const searchRequestIdRef = useRef(0)
  const weatherRequestIdRef = useRef(0)
  const locationChoiceRef = useRef(false)
  const chatMessagesRef = useRef<HTMLDivElement>(null)
  const forecastDashboardRef = useRef<HTMLElement>(null)
  const chatAbortRef = useRef<AbortController | null>(null)
  const chatPendingRef = useRef<PendingClarification | undefined>(undefined)
  const chatContextRef = useRef<ConversationContext | undefined>(undefined)
  const chatRequestIdRef = useRef(0)
  const placesGuardRef = useRef(createPlacesSessionGuard())
  const localizationGuardRef = useRef(createLocalizationGuard())
  const currentLocalizationGuardRef = useRef(createLocalizationGuard())
  const langRef = useRef(lang)
  const t = translations[lang as keyof typeof translations]

  useEffect(() => {
    langRef.current = lang
  }, [lang])

  const toggleLanguage = () => {
    const nextLanguage = lang === 'bg' ? 'en' : 'bg'
    saveLanguage(nextLanguage)
    setLang(nextLanguage)
  }

  const forecastIntent = useRef(0)
  const forecastSeen = useRef(-1)
  const [forecastReady, setForecastReady] = useState(-1)
  useEffect(() => {
    if (loading || !weather || forecastReady !== forecastIntent.current || forecastSeen.current === forecastReady) return
    const element = document.querySelector('.weather-forecast-view')
    if (!element) return
    let visible = false
    const recordView = () => {
      if (!visible || document.visibilityState !== 'visible' || forecastSeen.current === forecastReady) return
      forecastSeen.current = forecastReady
      trackActivity('forecast_view')
    }
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.25)
      recordView()
    }, { threshold: 0.25 })
    observer.observe(element)
    document.addEventListener('visibilitychange', recordView)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', recordView) }
  }, [loading, Boolean(weather), forecastReady])

  const updateCoords = (next: { lat: number, lon: number }) => {
    // Invalidate older async work synchronously, before React's next commit.
    locationKeyRef.current = `${next.lat},${next.lon}`
    setCoords(next)
  }

  const finalizeManualLocation = () => {
    initialLocationRef.current.manual()
    locationRevisionRef.current++
    explicitGpsPendingRef.current = false
    explicitGpsRef.current++
    setGpsBusy(false)
    setGpsError(false)
    setInitialLocationReady(true)
  }

  const choosePlace = (place: Place, manual = true) => {
    finalizeManualLocation()
    if (manual) { forecastIntent.current++; placesGuardRef.current.manualSelection() }
    locationChoiceRef.current = true
    setLocationSource('place')
    setCity(place.name); updateCoords({ lat: place.lat, lon: place.lon }); setExactLocation(null); setPlaceDetails({ geonameId: place.geonameId || undefined, countryCode: place.countryCode || undefined, admin1Id: place.admin1Id || undefined, region: place.region || undefined, country: place.country || undefined })
  }

  useEffect(() => {
    const guard = localizationGuardRef.current
    const ticket = guard.begin()
    Promise.all(places.map(place => localizePlace(place, lang, { signal: ticket.controller.signal }).catch(() => place))).then(next => {
      if (!guard.isCurrent(ticket)) return
      setLocalizedPlaces(next)
      const originalsWithIdentity = places.map((original, index) => ({
        ...original,
        geonameId: next[index].geonameId,
        countryCode: next[index].countryCode,
        admin1Id: next[index].admin1Id
      }))
      const identityChanged = originalsWithIdentity.filter((place, index) => place.geonameId != null &&
        (place.geonameId !== places[index].geonameId || place.countryCode !== places[index].countryCode || place.admin1Id !== places[index].admin1Id))
      if (identityChanged.length) {
        if (!session) saveLocalPlaces(originalsWithIdentity)
        else identityChanged.forEach(place => { if (place.id) void setPlaceIdentity(session, place.id, place).catch(() => {}) })
        setPlaces(originalsWithIdentity)
      }
    })
    return () => guard.invalidate(ticket)
  }, [lang, places, session?.user.id])

  useEffect(() => {
    if (locationSource === 'geolocation') return
    const guard = currentLocalizationGuardRef.current
    const ticket = guard.begin()
    const revision = locationRevisionRef.current
    const key = locationKey
    const current = { name: city, lat: coords.lat, lon: coords.lon, ...placeDetails }
    void localizeCurrentLocation(current, lang, t.quickCities, localizePlace, { signal: ticket.controller.signal }).then(localized => {
      if (!guard.isCurrent(ticket) || revision !== locationRevisionRef.current || key !== locationKeyRef.current || lang !== langRef.current) return
      setCity(localized.name)
      setPlaceDetails(details => ({
        ...details,
        geonameId: localized.geonameId ?? details.geonameId,
        countryCode: localized.countryCode ?? details.countryCode,
        admin1Id: localized.admin1Id ?? details.admin1Id,
        region: localized.region ?? undefined,
        country: localized.country ?? undefined
      }))
    }).catch(() => {})
    return () => guard.invalidate(ticket)
  }, [lang, coords.lat, coords.lon, placeDetails.geonameId, locationSource])

  const placesLoadRef = useRef(0)
  const loadAccountPlaces = async (active: AuthSession, ticket: any) => {
    const initialRestore = !initialLocationRef.current.settled
    if (initialRestore) initialLocationRef.current.waitForDefault()
    const load = ++placesLoadRef.current
    const isCurrent = () => load === placesLoadRef.current && placesGuardRef.current.isCurrent(ticket)
    setPlacesBusy(true)
    try {
      const snapshot = await fetchPlaces(active)
      if (!isCurrent()) return
      // Choose coordinates from the validated snapshot before label lookups.
      // Slow localization must not turn a settled startup into a second forecast.
      if (initialRestore) {
        const preferred = snapshot.places.find(place => place.id === snapshot.defaultPlaceId)
        const eligible = placesGuardRef.current.resolveDefault(ticket)
        if (eligible && preferred) initialDefaultTicketRef.current = ticket
        initialLocationRef.current.defaultResolved(eligible ? preferred : null)
      }
      const localized = await localizeAccountPlaces(snapshot.places, snapshot.defaultPlaceId, () => langRef.current,
        (place, language) => localizePlace(place, language))
      if (!isCurrent()) return
      setPlacesError(null)
      setPlaces(snapshot.places)
      setLocalizedPlaces(localized.localizedPlaces)
      setDefaultPlaceId(snapshot.defaultPlaceId)
      const preferred = localized.preferred
      if (!initialRestore && placesGuardRef.current.resolveDefault(ticket) && preferred) choosePlace(preferred, false)
      setOfferImport(localPlaces().length > 0)
    } catch (error) { if (isCurrent()) { if (initialRestore) initialLocationRef.current.defaultResolved(null); setPlacesError(placesFailure(error)) } }
    finally { if (isCurrent()) setPlacesBusy(false) }
  }

  useEffect(() => { const unsubscribe = subscribeSession(active => {
    const { accountChanged, ticket } = placesGuardRef.current.changeSession(active?.user.id || null)
    startupLifecycle.record('session:observed', { authenticated: Boolean(active), accountChanged })
    setSession(active)
    if (!accountChanged && active) return
    setPlacesError(null); setPlacesBusy(false)
    if (accountChanged) {
      setOfferImport(false); setDefaultPlaceId(null)
      // Clear the prior account immediately; never display it while the next request is pending.
      setPlaces([])
      setLocalizedPlaces([])
    }
    if (active) loadAccountPlaces(active, ticket)
    else { initialLocationRef.current.defaultResolved(null); try { setPlaces(localPlaces()) } catch { setPlaces([]) } }
  }); return () => { unsubscribe() } }, [])

  useEffect(() => {
    chatRequestIdRef.current += 1
    chatAbortRef.current?.abort()
    setChatLoading(false)
    chatContextRef.current = undefined
    chatPendingRef.current = undefined
    setChatMessages([{ role: 'bot', text: t.chatGreeting }])
    return () => chatAbortRef.current?.abort()
  }, [lang, city])

  useEffect(() => {
    const messagesContainer = chatMessagesRef.current
    if (messagesContainer) {
      messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' })
    }
  }, [chatMessages])

  useEffect(() => {
    document.documentElement.lang = lang
    const title = lang === 'bg'
      ? `Времето в ${city} | Метео Пулс`
      : `Weather in ${city} | Meteo Pulse`
    const description = weather
      ? (lang === 'bg'
          ? `Актуално време в ${city}: ${formatWeatherValue(weather.temp, '°C')}, ${weather.description.toLowerCase()}. Почасова и 14-дневна прогноза с персонални метео съвети.`
          : `Current weather in ${city}: ${formatWeatherValue(weather.temp, '°C')}, ${weather.description.toLowerCase()}. Hourly and 14-day forecast with personalized weather advice.`)
      : (lang === 'bg'
          ? `Актуална почасова и 14-дневна прогноза за времето в ${city} с персонални метео съвети.`
          : `Current hourly and 14-day weather forecast for ${city} with personalized weather advice.`)

    document.title = title
    document.querySelector('meta[name="description"]')?.setAttribute('content', description)
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', title)
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description)
    document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', title)
    document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', description)
  }, [city, lang, weather])

  const sendChatMessage = async (message = chatInput, quickAction?: 'umbrella' | 'clothing' | 'walk') => {
    const clean = message.trim()
    if (!clean || chatLoading || clean.length > 400) return
    const requestId = ++chatRequestIdRef.current
    chatAbortRef.current?.abort()
    const controller = new AbortController()
    chatAbortRef.current = controller
    setChatLoading(true)
    setChatInput('')
    setChatMessages(previous => [...previous, { role: 'user', text: clean }])

    try {
      const result = await fetch('/api/weather-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ pendingClarification: chatPendingRef.current, context: chatContextRef.current, message: clean, city, latitude: coords.lat, longitude: coords.lon, lang, ...(quickAction ? { quickAction } : {}) })
      })
      const data = await result.json()
      if (!result.ok || typeof data.answer !== 'string') throw new Error('chat failed')
      if (requestId !== chatRequestIdRef.current || controller.signal.aborted) return
      if (data.context) chatContextRef.current = data.context
      chatPendingRef.current = data.pendingClarification ?? undefined
      trackActivity('chat_use')
      setChatMessages(previous => [...previous, { role: 'bot', text: data.answer }])
    } catch {
      if (controller.signal.aborted || requestId !== chatRequestIdRef.current) return
      setChatInput(clean)
      setChatMessages(previous => [...previous, { role: 'bot', text: lang === 'bg'
        ? 'Не успях да проверя прогнозата. Въпросът ти е запазен — натисни „Изпрати“, за да опиташ отново.'
        : 'I could not check the forecast. Your question is saved—press “Send” to try again.' }])
    } finally {
      if (requestId === chatRequestIdRef.current) setChatLoading(false)
    }
  }

  const currentFavorite = places.find(place => placeKey(place) === placeKey(coords))
  const toggleFavorite = async () => {
    if (placesBusy) return
    const ticket = placesGuardRef.current.ticket()
    setPlacesBusy(true); setPlacesError(null)
    try {
      if (currentFavorite) {
        if (session) await removePlace(session, currentFavorite.id!)
        if (!placesGuardRef.current.isCurrent(ticket)) return
        const next = places.filter(place => placeKey(place) !== placeKey(currentFavorite))
        if (!session) saveLocalPlaces(next)
        setPlaces(next)
        trackActivity('favorite_remove')
        if (currentFavorite.id === defaultPlaceId) setDefaultPlaceId(null)
      } else {
        const nextPlace = { geonameId: placeDetails.geonameId, countryCode: placeDetails.countryCode, admin1Id: placeDetails.admin1Id, name: city.trim().slice(0, 120), region: placeDetails.region, country: placeDetails.country, lat: coords.lat, lon: coords.lon }
        const saved = session ? await addPlace(session, nextPlace) : nextPlace
        if (!placesGuardRef.current.isCurrent(ticket)) return
        trackActivity('favorite_add')
        const next = [...places, saved]
        if (!session) saveLocalPlaces(next)
        setPlaces(next)
      }
    } catch (error) { if (placesGuardRef.current.isCurrent(ticket)) setPlacesError(placesFailure(error)) }
    finally { if (placesGuardRef.current.isCurrent(ticket)) setPlacesBusy(false) }
  }

  const changeDefault = async (place: Place) => {
    if (!session || placesBusy) return
    const ticket = placesGuardRef.current.ticket()
    setPlacesBusy(true); setPlacesError(null)
    try { const next = defaultPlaceId === place.id ? null : place.id!; await setDefaultPlace(session, next); if (placesGuardRef.current.isCurrent(ticket)) setDefaultPlaceId(next) }
    catch (error) { if (placesGuardRef.current.isCurrent(ticket)) setPlacesError(placesFailure(error)) } finally { if (placesGuardRef.current.isCurrent(ticket)) setPlacesBusy(false) }
  }

  const migrateLocalPlaces = async () => {
    if (!session || placesBusy) return
    const ticket = placesGuardRef.current.ticket()
    setPlacesBusy(true); setPlacesError(null)
    try { const snapshot = await importPlaces(session, localPlaces()); if (!placesGuardRef.current.isCurrent(ticket)) return; setPlaces(snapshot.places); setDefaultPlaceId(snapshot.defaultPlaceId); setOfferImport(false) }
    catch (error) { if (placesGuardRef.current.isCurrent(ticket)) setPlacesError(placesFailure(error)) }
    finally { if (placesGuardRef.current.isCurrent(ticket)) setPlacesBusy(false) }
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

  const searchCities = async (query: string, requestId: number, selectFirst = false) => {
    if (query.trim().length < 2) { setSuggestions([]); return }
    setSearchStatus('loading')
    try {
      const res = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(query) + '&count=10&language=' + lang + '&format=json')
      if (!res.ok) throw new Error('Geocoding failed')
      const data = await res.json()
      if (requestId !== searchRequestIdRef.current) return
      const results = Array.isArray(data.results) ? data.results : []
      setSuggestions(results)
      setSearchStatus(results.length ? 'idle' : 'empty')
      if (selectFirst && results.length) selectCity(results[0])
    } catch { if (requestId === searchRequestIdRef.current) { setSuggestions([]); setSearchStatus('error') } }
  }

  const handleSearchInput = (val: string) => {
    setSearchInput(val)
    setSuggestions([])
    setSearchStatus('idle')
    const requestId = ++searchRequestIdRef.current
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (val.trim().length >= 2) searchTimer.current = setTimeout(() => searchCities(val.trim(), requestId), 300)
  }

  const selectCity = (result: any) => {
    finalizeManualLocation()
    forecastIntent.current++
    trackActivity('search_complete')
    placesGuardRef.current.manualSelection()
    locationChoiceRef.current = true
    setLocationSource('search')
    ++searchRequestIdRef.current
    if (searchTimer.current) clearTimeout(searchTimer.current)
    setCity(result.name)
    setPlaceDetails({ geonameId: Number(result.id), countryCode: result.country_code, admin1Id: result.admin1_id == null ? undefined : Number(result.admin1_id), region: result.admin1, country: result.country })
    updateCoords({ lat: result.latitude, lon: result.longitude })
    setSearchInput('')
    setSuggestions([])
    setSearchStatus('idle')
    setSelectedDay(null)
    setSelectedHour(null)
    setExactLocation(null) 
  }

  const formatTime = (isoString: string) => {
    if (!isoString) return '--:--';
    const date = new Date(isoString);
    return date.toLocaleTimeString(lang === 'bg' ? 'bg-BG' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  }

const fetchAiAdvice = async (dataForAi: any, requestId: number) => {
    if (!dataForAi) return

    const fallbackAdvice = () => {
      const temp = Number(dataForAi.temp)
      const rain = Number(dataForAi.rain) || 0
      const wind = Number(dataForAi.wind) || 0
      const isSnow = [71, 73, 75, 77, 85, 86].includes(dataForAi.code)

      if (lang === 'bg') {
        if (isSnow) return `В ${dataForAi.city} небето раздава безплатни снежинки. Облечи се топло и стъпвай внимателно!`
        if (rain > 0) return `Облаците в ${dataForAi.city} днес са на режим „автомивка“. Вземи чадър и запази усмивката суха!`
        if (wind >= 20) return `Вятърът в ${dataForAi.city} предлага безплатна прическа. Закопчай якето и дръж шапката здраво!`
        if (temp >= 28) return `В ${dataForAi.city} слънцето работи извънредно. Вземи вода, сянка и слънцезащита!`
        if (temp <= 10) return `В ${dataForAi.city} времето е включило хладилника. Облечи по-топли дрехи и се стопли с нещо вкусно!`
        return `Времето в ${dataForAi.city} кани на разходка. Вземи доброто настроение — то не тежи в раницата!`
      }

      if (isSnow) return `${dataForAi.city} is handing out free snowflakes today. Dress warmly and watch your step!`
      if (rain > 0) return `The clouds over ${dataForAi.city} are running a free car wash. Take an umbrella and keep your smile dry!`
      if (wind >= 20) return `The wind in ${dataForAi.city} is offering free hairstyles. Zip your jacket and hold onto your hat!`
      if (temp >= 28) return `The sun is working overtime in ${dataForAi.city}. Bring water, shade and sunscreen!`
      if (temp <= 10) return `${dataForAi.city} has switched the fridge on. Dress in layers and warm up with something tasty!`
      return `${dataForAi.city} is inviting you out for a walk. Pack a good mood—it weighs nothing!`
    }

    try {
      const response = await fetch('/api/weather-advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...dataForAi, lang })
      })
      if (!response.ok) throw new Error('AI advice unavailable')
      const data = await response.json()
      if (requestId === weatherRequestIdRef.current) setAiAdvice(data.advice || fallbackAdvice())
    } catch {
      if (requestId === weatherRequestIdRef.current) setAiAdvice(fallbackAdvice())
    }
  }
  const fetchWeather = async (lat: number, lon: number, quiet = false) => {
    const key = `${lat},${lon}`
    if (forecastInFlightRef.current?.key === key) return
    const sameLocation = validLocationRef.current?.lat === lat && validLocationRef.current?.lon === lon
    if (!sameLocation) {
      setPlannerForecast(null)
      setNotificationForecast(null)
    }
    setSources(previous => previous.key === key
      ? { ...previous, marineStatus: previous.marine ? 'ready' : 'loading', aqiStatus: previous.aqi ? 'ready' : 'loading' }
      : { key, marine: null, aqi: null, marineStatus: 'loading', aqiStatus: 'loading' })
    const viewIntent = forecastIntent.current
    const requestId = ++weatherRequestIdRef.current
    forecastInFlightRef.current = { key, id: requestId }
    setLoading(!quiet || !sameLocation)
    setError(null)
    if (!sameLocation) setAiAdvice(null)
    try {
      const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + 
        '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature,visibility,surface_pressure,uv_index,cloud_cover' + 
        '&hourly=temperature_2m,weather_code,precipitation,wind_speed_10m,surface_pressure,relative_humidity_2m,visibility,dew_point_2m,cloud_cover,apparent_temperature,precipitation_probability' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max,apparent_temperature_max,sunrise,sunset' + 
        '&timezone=auto&forecast_days=15';

     const marineUrl = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + lat + '&longitude=' + lon + 
        '&current=sea_surface_temperature&hourly=sea_surface_temperature&timezone=auto&forecast_days=8';

      const aqiUrl = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + lat + '&longitude=' + lon + 
        '&current=european_aqi,pm10,pm2_5&hourly=european_aqi&timezone=auto&forecast_days=3';

      const request = requestsRef.current.start({ weather: weatherUrl, marine: marineUrl, aqi: aqiUrl },
        () => locationKeyRef.current === key,
        (source, data) => setSources(previous => {
          if (previous.key !== key || requestId !== weatherRequestIdRef.current || locationKeyRef.current !== key) return previous
          return { ...previous, [source]: data ?? previous[source], [source + 'Status']: data || previous[source] ? 'ready' : 'unavailable' }
        }))
      const data = await request.main
      if (!request.current() || requestId !== weatherRequestIdRef.current) return

      // Validate the structure before publishing any part of a new snapshot.
      if (!data.current || !Array.isArray(data.hourly?.time) || !Array.isArray(data.daily?.time) ||
          ['weather_code', 'temperature_2m', 'apparent_temperature', 'precipitation', 'wind_speed_10m', 'surface_pressure', 'relative_humidity_2m', 'visibility', 'dew_point_2m', 'cloud_cover'].some(field => !Array.isArray(data.hourly[field])) ||
          ['weather_code', 'temperature_2m_min', 'temperature_2m_max', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'uv_index_max', 'apparent_temperature_max'].some(field => !Array.isArray(data.daily[field]))) throw new Error('Incomplete main forecast')
      const cur = decodeWeatherCode(data.current.weather_code)
      
      const nextWeather = {
        temp: hourlyNumber(data.current.temperature_2m),
        minTemp: hourlyNumber(data.daily.temperature_2m_min[0]),
        maxTemp: hourlyNumber(data.daily.temperature_2m_max[0]),
        precipProb: hourlyNumber(data.daily.precipitation_probability_max[0], false),
        precipSum: hourlyNumber(data.daily.precipitation_sum[0], false)?.toFixed(1) ?? null,
        cloudCover: hourlyNumber(data.current.cloud_cover, false),
        maxWindSpeedDaily: hourlyNumber(data.daily.wind_speed_10m_max[0]),
        humidity: hourlyNumber(data.current.relative_humidity_2m, false),
        windSpeed: hourlyNumber(data.current.wind_speed_10m),
        feelsLike: hourlyNumber(data.current.apparent_temperature),
        visibility: data.current.visibility == null ? null : hourlyNumber(data.current.visibility / 1000),
        pressure: hourlyNumber(data.current.surface_pressure),
        uvIndex: hourlyNumber(data.current.uv_index),
        sunrise: data.daily.sunrise && data.daily.sunrise[0] ? formatTime(data.daily.sunrise[0]) : '--:--',
        sunset: data.daily.sunset && data.daily.sunset[0] ? formatTime(data.daily.sunset[0]) : '--:--',
        code: data.current.weather_code,
        seaTemp: null,
        description: cur.desc,
        icon: cur.icon,
        aqi: null,
        pm10: null,
        pm25: null
      }

      const startIdx = findHourlyStartIndex(data.hourly.time, data.current.time)
      const notificationData = typeof data.timezone === 'string' ? {
        timeZone: data.timezone,
        hours: data.hourly.time.slice(startIdx, startIdx + 72).map((time: string, i: number) => ({
          time, feelsLike: hourlyNumber(data.hourly.apparent_temperature?.[startIdx + i], false),
          rainProbability: hourlyNumber(data.hourly.precipitation_probability?.[startIdx + i], false),
          rain: hourlyNumber(data.hourly.precipitation?.[startIdx + i], false),
          wind: hourlyNumber(data.hourly.wind_speed_10m?.[startIdx + i], false),
          code: data.hourly.weather_code?.[startIdx + i] ?? null,
        })),
      } : null

      const hr: any[] = []
      for (let i = 0; i < 24; i++) {
        const idx = startIdx + i
        if (idx >= data.hourly.time.length) break
        const code = decodeWeatherCode(data.hourly.weather_code[idx])
        
        hr.push({
          time: data.hourly.time[idx],
          hour: data.hourly.time[idx].slice(11, 16),
          temp: hourlyNumber(data.hourly.temperature_2m[idx]),
          feelsLike: hourlyNumber(data.hourly.apparent_temperature[idx]),
          rain: hourlyNumber(data.hourly.precipitation[idx], false),
          rainProbability: hourlyNumber(data.hourly.precipitation_probability?.[idx]),
          description: code.desc,
          wind: hourlyNumber(data.hourly.wind_speed_10m[idx]),
          pressure: hourlyNumber(data.hourly.surface_pressure[idx]),
          humidity: hourlyNumber(data.hourly.relative_humidity_2m[idx]),
          visibility: data.hourly.visibility[idx] == null ? null : hourlyNumber(data.hourly.visibility[idx] / 1000),
          dewPoint: hourlyNumber(data.hourly.dew_point_2m[idx]),
          cloudCover: hourlyNumber(data.hourly.cloud_cover[idx]),
          seaTemp: null,
          aqi: null,
          code: data.hourly.weather_code[idx],
          icon: code.icon
        })
      }

      const days: any[] = []
      for (let i = 1; i < Math.min(15, data.daily.time.length); i++) {
        const d = new Date(`${data.daily.time[i]}T12:00:00Z`)
        const code = decodeWeatherCode(data.daily.weather_code[i])
        
        const startH = i * 24
        const mean = (field: string) => meanObservation((data.hourly?.[field] || []).slice(startH, startH + 24))
        const visibility = mean('visibility')

        days.push({
          dateStr: data.daily.time[i],
          code: data.daily.weather_code[i],
          dayName: (t.weekDays as any)[d.getUTCDay()],
          dateFormatted: `${d.getUTCDate()} ${(t.months as any)[d.getUTCMonth()]}`,
          max: hourlyNumber(data.daily.temperature_2m_max[i]),
          min: hourlyNumber(data.daily.temperature_2m_min[i]),
          feelsLikeMax: hourlyNumber(data.daily.apparent_temperature_max[i]),
          icon: code.icon,
          rain: hourlyNumber(data.daily.precipitation_sum[i], false),
          rainProbability: hourlyNumber(data.daily.precipitation_probability_max?.[i]),
          wind: hourlyNumber(data.daily.wind_speed_10m_max[i]),
          uv: hourlyNumber(data.daily.uv_index_max[i]),
          sunrise: data.daily.sunrise && data.daily.sunrise[i] ? formatTime(data.daily.sunrise[i]) : '--:--',
          sunset: data.daily.sunset && data.daily.sunset[i] ? formatTime(data.daily.sunset[i]) : '--:--',
          humidity: hourlyNumber(mean('relative_humidity_2m')),
          pressure: hourlyNumber(mean('surface_pressure')),
          visibility: visibility == null ? null : hourlyNumber(visibility / 1000),
          dewPoint: hourlyNumber(mean('dew_point_2m')),
          cloudCover: hourlyNumber(mean('cloud_cover')),
          seaTemp: null,
          seaTimes: data.hourly.time.slice(startH, startH + 24),
          description: code.desc
        })
      }
      startupTiming.mark('weather:processed')
      // Coordinates own the snapshot; reverse geocoding can enrich its label later.
      setWeather(nextWeather)
      setHourly(hr)
      setPlannerLocation({lat,lon})
      setNotificationForecast(notificationData)
      setPlannerForecast(notificationData ? {...notificationData,hours:notificationData.hours.map(h=>({...h,feelsLike:hourlyNumber(h.feelsLike),rainProbability:hourlyNumber(h.rainProbability),wind:hourlyNumber(h.wind)}))}:null)
      setForecast(days)
      setWeatherCoords({ lat, lon })
      setLoading(false)
      setForecastReady(viewIntent)
      setLastUpdated(new Date())

      // Извикване на AI функцията с реални данни
      fetchAiAdvice({
        city: city,
        temp: Math.round(data.current.temperature_2m),
        feelsLike: Math.round(data.current.apparent_temperature),
        wind: Math.round(data.current.wind_speed_10m),
        rain: Number(data.daily.precipitation_sum[0] || 0).toFixed(1),
        precipProb: data.daily.precipitation_probability_max[0] || 0,
        uvIndex: Math.round(data.current.uv_index),
        code: data.current.weather_code,
        description: cur.desc
      }, requestId);

      if (backgroundLocationRef.current !== key) {
        backgroundLocationRef.current = key
        const randomId = Math.floor(Math.random() * 1000) + 1;
        setBgImageUrl(`https://picsum.photos/seed/bobbyweather${randomId}/1200/800`);
      }

    } catch {
      if (requestId !== weatherRequestIdRef.current || locationKeyRef.current !== key) return
      // Upstream errors can contain request URLs. Keep coordinates out of logs.
      setError(sameLocation ? (langRef.current === 'bg' ? 'Прогнозата не се обнови. Показваме последните валидни данни.' : 'Forecast update failed. Showing the last valid data.') : t.error)
      setLoading(false)
    } finally {
      if (forecastInFlightRef.current?.id === requestId) forecastInFlightRef.current = null
    }
  }

  useLayoutEffect(() => {
    if (!hasCurrentForecast || !startupTiming.enabled) return
    startupTiming.mark('card:commit')
    // Two animation frames provide an after-paint opportunity for this DOM commit;
    // this is a visible-card proxy, not a GPU/pixel presentation timestamp.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => startupTiming.mark('card:paint')) })
    return () => cancelAnimationFrame(frame)
  }, [hasCurrentForecast])

  useEffect(() => {
    if (!initialLocationReady) return
    // Defer setup by one microtask. StrictMode cleanup cancels its rehearsal
    // before it can issue a duplicate request for the same coordinates.
    let active = true
    let interval: ReturnType<typeof setInterval>
    queueMicrotask(() => {
      if (!active) return
      setSelectedDay(null)
      setSelectedHour(null)
      fetchWeather(coords.lat, coords.lon)
      interval = setInterval(() => fetchWeather(coords.lat, coords.lon, true), 15 * 60 * 1000)
    })
    return () => { active = false; clearInterval(interval); weatherRequestIdRef.current++; forecastInFlightRef.current = null; requestsRef.current.cancel() }
  }, [initialLocationReady, coords.lat, coords.lon])

  useEffect(() => {
    let active = true
    void initialLocationRef.current.start().then(selection => {
      if (!active || (selection.source !== 'manual' && locationChoiceRef.current)) return
      if (selection.source === 'manual' && explicitGpsPendingRef.current) return
      if (selection.source === 'place') {
        if (placesGuardRef.current.isCurrent(initialDefaultTicketRef.current)) choosePlace(selection.place, false)
      }
      else if (selection.source === 'geolocation') {
        setLocationSource('geolocation')
        setCity(selection.name || translations[langRef.current].myLocation)
        setExactLocation(selection.exactLocation || null)
        setPlaceDetails({ region: selection.region, country: selection.country })
        updateCoords({ lat: selection.lat, lon: selection.lon })
      }
      startupLifecycle.record('location:decision', { source: selection.source })
      setInitialLocationReady(true)
    })
    return () => { active = false }
  }, [])

  const useMyLocation = () => {
    if (!navigator.geolocation?.getCurrentPosition) { setGpsError(true); return }
    initialLocationRef.current.manual()
    locationRevisionRef.current++
    explicitGpsPendingRef.current = true
    setGpsError(false)
    forecastIntent.current++
    placesGuardRef.current.manualSelection()
    locationChoiceRef.current = true
    const request = ++explicitGpsRef.current
    setGpsBusy(true)
    const timer = setTimeout(() => {
      if (request !== explicitGpsRef.current) return
      explicitGpsRef.current++
      explicitGpsPendingRef.current = false
      setInitialLocationReady(true)
      setGpsBusy(false)
      setGpsError(true)
    }, 5000)
    const fail = () => {
      clearTimeout(timer)
      if (request === explicitGpsRef.current) { explicitGpsPendingRef.current = false; setInitialLocationReady(true); setGpsBusy(false); setGpsError(true) }
    }
    try { navigator.geolocation.getCurrentPosition(position => {
      clearTimeout(timer)
      if (request !== explicitGpsRef.current) return
      explicitGpsPendingRef.current = false
      setInitialLocationReady(true)
      const lat = position.coords.latitude, lon = position.coords.longitude
      if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) { setGpsBusy(false); setGpsError(true); return }
      locationChoiceRef.current = false
      setGpsLabelGeneration(generation => generation + 1)
      setGpsBusy(false)
      setLocationSource('geolocation')
      if (locationSource !== 'geolocation' || locationKeyRef.current !== `${lat},${lon}`) {
        setCity(translations[langRef.current].myLocation)
        setPlaceDetails({})
        setExactLocation(null)
      }
      updateCoords({ lat, lon })
    }, fail, { timeout: 5000, maximumAge: 60000 }) } catch { fail() }
  }

  useEffect(() => () => { explicitGpsRef.current++ }, [])

  useEffect(() => {
    if (locationSource !== 'geolocation') return
    const controller = new AbortController()
    startupTiming.mark('reverse:start')
    const revision = locationRevisionRef.current
    const key = locationKey
    const labelCurrent = () => !controller.signal.aborted && !locationChoiceRef.current && revision === locationRevisionRef.current && key === locationKeyRef.current && lang === langRef.current
    void reverseGeocodeLocation(coords, lang, { signal: controller.signal }).then(data => {
      startupTiming.mark('reverse:end')
      if (!labelCurrent()) return
      const localized = locationFromReverseGeocode(data, t.myLocation)
      setCity(localized.name)
      setPlaceDetails({ region: localized.region, country: localized.country })
      setExactLocation(localized.exactLocation)
    }).catch(() => { startupTiming.mark('reverse:end'); if (labelCurrent()) setCity(t.myLocation) })
    return () => controller.abort()
  }, [lang, coords.lat, coords.lon, locationSource, gpsLabelGeneration])

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

  const openPopup = (e: any) => {
    const rect = e.currentTarget.getBoundingClientRect();
    let x = rect.left + (rect.width / 2) - 150;
    let y = rect.top - 320;
    if (x < 10) x = 10;
    if (x + 300 > window.innerWidth - 10) x = window.innerWidth - 310;
    if (y < 10) y = rect.bottom + 15;
    setPopupPos({ x, y });
    setDetailTab('main');
  }

  return (
    <div className={darkMode ? 'weather-app dark' : 'weather-app'}>
      <style>{`
        @media (min-width: 1100px) {
          .main-card .stats-grid {
            grid-template-columns: repeat(7, 1fr) !important;
          }
        }
        @media (max-width: 1099px) and (min-width: 768px) {
          .main-card .stats-grid {
            grid-template-columns: repeat(4, 1fr) !important;
          }
        }
        .popup-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }
        .popup-grid .stat-box {
           background: #f1f5f9;
           box-shadow: none;
           color: #1e293b;
        }
        .weather-app.dark .popup-grid .stat-box {
           background: rgba(255,255,255,0.1);
           color: #ffffff;
        }
      `}</style>

      <div className="header-row">
        <div className="header-title-wrapper" style={{ display: 'flex', flexDirection: 'column' }}>
          <h1><a className="brand-home" href={import.meta.env.BASE_URL} aria-label={lang === 'bg' ? 'Метео Пулс — начална страница' : 'Meteo Pulse — home'}>{t.title}</a></h1>
          <p className="subtitle" style={{ fontSize: '0.9rem', opacity: 0.8, marginTop: '-4px', fontWeight: 'normal' }}>{t.subtitle}</p>
        </div>
        <HeaderNavigation lang={lang} notifications={<WeatherNotifications locationKey={`${Math.round(coords.lat*10)}:${Math.round(coords.lon*10)}`} key={session?.user.id||'guest'} lang={lang} session={session} forecast={plannerLocation?.lat===coords.lat && plannerLocation?.lon===coords.lon ? notificationForecast : null} city={city} />}>
          <AuthPanel lang={lang} ref={plannerAuth} />
          <AdminLink lang={lang} />
          <button className="lang-btn" aria-label={lang === 'bg' ? 'Switch to English' : 'Превключи на български'} onClick={toggleLanguage}>
            {lang === 'bg' ? '🇬🇧 EN' : '🇧🇬 БГ'}
          </button>
          <button className="icon-btn" aria-label={lang === 'bg' ? (darkMode ? 'Светла тема' : 'Тъмна тема') : (darkMode ? 'Light theme' : 'Dark theme')} aria-pressed={darkMode} onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? '☀️' : '🌙'}
          </button>
        </HeaderNavigation>
      </div>

      <div className="search-wrapper">
        <div className="search-row">
          <input type="search" placeholder={t.search} value={searchInput} aria-label={t.search}
            onChange={(e) => handleSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setSuggestions([]); setSearchStatus('idle') }
              if (e.key === 'Enter') {
                e.preventDefault()
                if (suggestions.length) selectCity(suggestions[0])
                else if (searchInput.trim().length >= 2) {
                  if (searchTimer.current) clearTimeout(searchTimer.current)
                  searchCities(searchInput.trim(), ++searchRequestIdRef.current, true)
                }
              }
            }}
            autoComplete="off" />
          <button type="button" className="location-btn" aria-label={lang === 'bg' ? 'Използвай моето местоположение' : 'Use my location'} title={lang === 'bg' ? 'Използвай моето местоположение' : 'Use my location'} aria-busy={gpsBusy} disabled={gpsBusy} onClick={useMyLocation}>📍</button>
        </div>
        {suggestions.length > 0 && (
          <div className="suggestions">
            {suggestions.map((s, i) => (
              <button key={s.id ?? i} type="button" className="suggestion-item" onClick={() => selectCity(s)}>
                <span className="sug-name">{s.name}</span>
                <span className="sug-country">{s.admin1 ? s.admin1 + ', ' : ''}{s.country}</span>
              </button>
            ))}
          </div>
        )}
        {searchInput.trim().length >= 2 && searchStatus !== 'idle' && <p className="search-feedback" role="status">{
          searchStatus === 'loading' ? (lang === 'bg' ? 'Търся населени места…' : 'Searching places…') :
          searchStatus === 'empty' ? (lang === 'bg' ? 'Няма намерено място. Опитай друго изписване.' : 'No places found. Try another spelling.') :
          (lang === 'bg' ? 'Търсенето не се зареди. Опитай пак.' : 'Search failed. Try again.')
        }</p>}
      </div>

      {gpsError && <p className="search-feedback" role="status">{lang === 'bg' ? 'Местоположението не е достъпно. Опитай отново или избери град.' : 'Location is unavailable. Try again or choose a city.'}</p>}

      <div className="info-line">{t.info}</div>

      <div className="city-row">
        {t.quickCities.map((c: any) => {
          return (
            <button key={c.name}
              aria-pressed={city === c.name}
              onClick={() => { finalizeManualLocation(); forecastIntent.current++; placesGuardRef.current.manualSelection(); locationChoiceRef.current = true; setLocationSource('quick'); setCity(c.name); updateCoords({ lat: c.lat, lon: c.lon }); setExactLocation(null); setPlaceDetails({}); }}
              className={city === c.name ? 'city-btn active' : 'city-btn'}>
              {c.name}
            </button>
          )
        })}
      </div>

      <section className={`my-places${localizedPlaces.length ? "" : " my-places-empty"}`} aria-label={lang === 'bg' ? 'Моите места' : 'My places'}>
        {localizedPlaces.length > 0 && <div className="my-places-heading"><h2 id="my-places-title">{lang === 'bg' ? 'Моите места' : 'My places'}</h2>{placesBusy && <span aria-live="polite">{t.loading}</span>}</div>}
        {localizedPlaces.length > 0 ? <div className="my-places-list">{localizedPlaces.map(place => <div className="place-chip" key={place.id || placeKey(place)}>
          <button className={placeKey(place) === placeKey(coords) ? 'place-select active' : 'place-select'} aria-pressed={placeKey(place) === placeKey(coords)} onClick={() => choosePlace(place)}><strong title={place.name}>{place.name}</strong>{(place.region || place.country) && <small title={[place.region, place.country].filter(Boolean).join(', ')}>{[place.region, place.country].filter(Boolean).join(', ')}</small>}</button>
          {session && <button className="default-place" disabled={placesBusy} aria-pressed={place.id === defaultPlaceId} title={lang === 'bg' ? 'Място по подразбиране' : 'Default place'} onClick={() => changeDefault(place)}>{place.id === defaultPlaceId ? '🏠' : '⌂'}</button>}
        </div>)}</div> : <p className="places-empty">{lang === 'bg' ? 'Добави любим град със звездата до името му' : 'Add a favorite city with the star next to its name'}</p>}
        {offerImport && session && <div className="places-import"><span>{lang === 'bg' ? 'Имаш места, запазени на това устройство.' : 'You have places saved on this device.'}</span><button onClick={migrateLocalPlaces} disabled={placesBusy}>{lang === 'bg' ? 'Прехвърли към профила' : 'Move to profile'}</button><button onClick={() => setOfferImport(false)}>{lang === 'bg' ? 'Не сега' : 'Not now'}</button></div>}
        {placesError && <p className="places-error" role="alert">{placesErrorText(placesError, lang)} <button disabled={placesBusy} onClick={() => session ? loadAccountPlaces(session, placesGuardRef.current.ticket()) : setPlaces(localPlaces())}>{t.tryAgain}</button></p>}
      </section>

      {!hasCurrentForecast && (loading || !error) && (
        <section className="forecast-loading" role="status" aria-live="polite" aria-busy="true">
          <div className="card skeleton-current">
            <div className="skeleton-heading"><span aria-hidden="true">🌤️</span><div><h2>{t.loading}</h2><p>{initialLocationReady ? `${t.loadingForecast} ${city}` : (lang === 'bg' ? 'Определяме началното местоположение…' : 'Choosing your starting location…')}</p></div></div>
            <div className="skeleton-hero" aria-hidden="true"><span /><span /></div>
            <div className="skeleton-metrics" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <span key={i} />)}</div>
          </div>
          {['hourly', 'daily'].map(period => <div className="card skeleton-periods" key={period} aria-hidden="true"><div className="skeleton-title" /><div className="skeleton-strip">{Array.from({ length: 7 }, (_, i) => <span key={i}><i /><i /><i /></span>)}</div></div>)}
          <div className="card skeleton-chart" aria-hidden="true"><div className="skeleton-title" /><div /></div>
        </section>
      )}

      {error && !loading && !hasCurrentForecast && (
        <div className="card center-text">
          <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>⚠️ {error}</p>
          <button className="search-btn" onClick={() => fetchWeather(coords.lat, coords.lon)}>{t.tryAgain}</button>
        </div>
      )}

      {hasCurrentForecast && (
        <main ref={forecastDashboardRef} className="forecast-dashboard">
          {error && <p className="forecast-update-error" role="status">{error} <button type="button" onClick={() => fetchWeather(coords.lat, coords.lon, true)}>{t.tryAgain}</button></p>}
          {loading && <div className="forecast-refresh" role="status" aria-live="polite">↻ {t.refreshing}</div>}
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

          <div className="card main-card weather-forecast-view" style={{ padding: 0, position: 'relative', overflow: 'hidden', border: 'none', backgroundColor: '#1e293b' }}>
            
            {bgImageUrl && (
              <img 
                src={bgImageUrl} 
                alt="" 
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  zIndex: 0
                }} 
              />
            )}

            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              background: getDynamicOverlay(weather.temp),
              zIndex: 1
            }}></div>

            <div style={{ position: 'relative', zIndex: 2, padding: '32px', display: 'flex', flexDirection: 'column', minHeight: '400px', justifyContent: 'space-between' }}>
              
              <div className="main-top" style={{ padding: 0, marginBottom: '24px' }}>
                <div className="main-info-left">
                  <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    <span>📍 {city}</span>
                    {exactLocation && (
                      <span style={{ fontSize: '1.1rem', opacity: 0.9, fontWeight: 'normal', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{opacity: 0.5, margin: '0 4px'}}>|</span> 🎯 {exactLocation}
                      </span>
                    )}
                    <button type="button" onClick={toggleFavorite} className="star-btn" title={t.favorite} aria-label={t.favorite} aria-pressed={!!currentFavorite} style={{ marginLeft: '4px' }}>
                      {currentFavorite ? '⭐' : '☆'}
                    </button>
                  </h2>
                  <p className="desc" style={{ marginBottom: '8px' }}>{weather.description}</p>
                  
                  {lastUpdated && (
                    <p style={{ fontSize: '0.85rem', opacity: 0.75, display: 'flex', alignItems: 'center', gap: '5px' }}>
                      🔄 {t.updated} {lastUpdated.toLocaleTimeString(lang === 'bg' ? 'bg-BG' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                  
                 {/* Тук се появява AI съветът от Gemini */}
                  {aiAdvice?.trim() && <WeatherAdvice key={`${weatherRequestIdRef.current}:${aiAdvice}`} advice={aiAdvice} lang={lang} />}

                  <div className="big-temp">{formatWeatherValue(weather.temp, '°C')}</div>
                  <div className="mobile-weather-summary">
                    <p>{t.feelsLike}: <strong>{formatWeatherValue(weather.feelsLike, '°C')}</strong></p>
                    <p>{t.minMaxTemp}: <strong>{formatWeatherValue(weather.minTemp, '°')} / {formatWeatherValue(weather.maxTemp, '°')}</strong></p>
                  </div>
                </div>
                <div className="big-icon"><AnimatedIcon icon={weather.icon} size="7.5rem" /></div>
              </div>
              
              <div id="current-weather-metrics" className={`stats-grid current-weather-metrics${metricsExpanded ? " is-expanded" : ""}`} style={{ padding: 0 }}>
                <div className="stat-box metric-summary"><p>🌡️↕️</p><p className="label">{t.minMaxTemp}</p><p className="value">{formatWeatherValue(weather.minTemp, '°')} / {formatWeatherValue(weather.maxTemp, '°')}</p></div>
                <div className="stat-box metric-summary"><p>🌡️</p><p className="label">{t.feelsLike}</p><p className="value">{formatWeatherValue(weather.feelsLike, '°C')}</p></div>
                <div className="stat-box metric-precipProb"><p>☔</p><p className="label">{t.precipProb}</p><p className="value">{formatWeatherValue(weather.precipProb, '%')}</p></div>
                <div className="stat-box"><p>🌧️</p><p className="label">{t.precipSum}</p><p className="value">{weather.precipSum == null ? '—' : `${weather.precipSum} ${t.mm}`}</p></div>
                <div className="stat-box metric-cloudCover"><p>☁️</p><p className="label">{t.cloudCover}</p><p className="value">{formatWeatherValue(weather.cloudCover, '%')}</p></div>
                <div className="stat-box metric-humidity"><p>💧</p><p className="label">{t.humidity}</p><p className="value">{formatWeatherValue(weather.humidity, '%')}</p></div>
                <div className="stat-box metric-wind"><p>🌬️</p><p className="label">{t.wind}</p><p className="value">{formatWeatherValue(weather.windSpeed, ' ' + t.windUnit)}</p></div>
                <div className="stat-box"><p>🌪️</p><p className="label">{t.maxWind}</p><p className="value">{formatWeatherValue(weather.maxWindSpeedDaily, ' ' + t.windUnit)}</p></div>
                <div className="stat-box"><p>👁️</p><p className="label">{t.visibility}</p><p className="value">{formatWeatherValue(weather.visibility, ' ' + t.km)}</p></div>
                <div className="stat-box"><p>🔵</p><p className="label">{t.pressure}</p><p className="value">{formatWeatherValue(weather.pressure, ' ' + t.hpa)}</p></div>
                <div className="stat-box"><p>☀️</p><p className="label">{t.uvIndex}</p><p className="value">{formatWeatherValue(weather.uvIndex)}</p></div>
                <div className="stat-box"><p>🌅</p><p className="label">{t.sunrise}</p><p className="value">{weather.sunrise}</p></div>
                <div className="stat-box"><p>🌇</p><p className="label">{t.sunset}</p><p className="value">{weather.sunset}</p></div>
                {(weather.seaTemp !== null || currentSources?.marineStatus === 'loading') && (
                  <div className="stat-box sea-temp-box"><p>🌊</p><p className="label">{t.seaTemp}</p><p className="value">{formatAqiValue(weather.seaTemp, marineMissing, '°C')}</p></div>
                )}
              </div>
              <button type="button" className="metrics-toggle" aria-expanded={metricsExpanded} aria-controls="current-weather-metrics" onClick={() => setMetricsExpanded(expanded => !expanded)}>
                {metricsExpanded ? t.fewerMetrics : t.allMetrics}
              </button>

            </div>
          </div>

          <ForecastSectionOrder dashboardRef={forecastDashboardRef}>
          <section key="chat" className="card weather-chat" aria-labelledby="weather-chat-title">
            <div className="chat-heading">
              <div className="chat-avatar" aria-hidden="true">🤖</div>
              <div>
                <h3 id="weather-chat-title">{t.chatTitle}</h3>
                <p>{t.chatSubtitle}</p>
              </div>
              <span className="chat-location">📍 {city}</span>
            </div>
            <div className="chat-messages" aria-live="polite" ref={chatMessagesRef}>
              {chatMessages.map((message, index) => (
                <div key={index} className={`chat-message ${message.role}`}>
                  {message.role === 'bot' && <span aria-hidden="true">🌤️</span>}
                  <p>{message.text}</p>
                </div>
              ))}
              {chatLoading && (
                <div className="chat-message bot">
                  <span aria-hidden="true">🌤️</span>
                  <p>{lang === 'bg' ? 'Боби мисли…' : 'Bobby is thinking…'}</p>
                </div>
              )}
            </div>
            <div className="chat-suggestions">
              {t.chatSuggestions.map((suggestion, index) => (
                <button key={suggestion} type="button" onClick={() => sendChatMessage(suggestion, (['umbrella', 'clothing', 'walk'] as const)[index])} disabled={chatLoading}>{suggestion}</button>
              ))}
            </div>
            <form className="chat-form" onSubmit={event => { event.preventDefault(); sendChatMessage() }}>
              <input value={chatInput} maxLength={400} disabled={chatLoading} onChange={event => setChatInput(event.target.value)} placeholder={t.chatPlaceholder} aria-label={t.chatPlaceholder} />
              <button type="submit" disabled={!chatInput.trim() || chatLoading}>{t.chatSend} <span aria-hidden="true">➤</span></button>
            </form>
            <p className="chat-disclaimer">{lang === 'bg' ? 'Съветите са информативни. При опасно време следвай указанията на местните власти.' : 'Advice is informational. During severe weather, follow local authority guidance.'}</p>
          </section>

          <section key="hourly" className="card hourly-section">
            <div className="forecast-heading"><h3>{t.hours24}</h3><div className="forecast-scroll-controls">
              {[-1, 1].map(direction => <button type="button" key={direction} aria-label={lang === 'bg' ? (direction < 0 ? 'Предишни часове' : 'Следващи часове') : (direction < 0 ? 'Previous hours' : 'Next hours')} onClick={event => {
                const row = event.currentTarget.closest('section')?.querySelector('.hourly-row')
                row?.scrollBy({ left: direction * row.clientWidth * .8, behavior: 'smooth' })
              }}>{direction < 0 ? '←' : '→'}</button>)}
            </div></div>
            <div className="hourly-row" tabIndex={0} aria-label={t.hours24}>
              {hourly.map(h => <ForecastPeriodCard key={h.time} period="hour" item={{ ...h, description: decodeWeatherCode(h.code).desc }} language={lang} label={h.hour}
                date={`${Number(h.time.slice(8, 10))} ${t.months[Number(h.time.slice(5, 7)) - 1]}`}
                icon={<AnimatedIcon icon={h.icon} size="2rem" />} selected={selectedHour?.time === h.time}
                onClick={event => { openPopup(event); setSelectedHour(h); setSelectedDay(null) }} />)}
            </div>
          </section>

          <section key="daily" className="card forecast-section">
            <div className="forecast-heading"><h3>{t.days14}</h3><div className="forecast-scroll-controls">
              {[-1, 1].map(direction => <button type="button" key={direction} aria-label={lang === 'bg' ? (direction < 0 ? 'Предишни дни' : 'Следващи дни') : (direction < 0 ? 'Previous days' : 'Next days')} onClick={event => {
                const row = event.currentTarget.closest('section')?.querySelector('.daily-grid')
                row?.scrollBy({ left: direction * row.clientWidth * .8, behavior: 'smooth' })
              }}>{direction < 0 ? '←' : '→'}</button>)}
            </div></div>
            <div className="daily-grid" tabIndex={0} aria-label={t.days14}>
              {forecast.map(day => {
                const localizedDay = { ...day, description: decodeWeatherCode(day.code).desc,
                  dayName: t.weekDays[new Date(`${day.dateStr}T12:00:00Z`).getUTCDay()],
                  dateFormatted: `${Number(day.dateStr.slice(8, 10))} ${t.months[Number(day.dateStr.slice(5, 7)) - 1]}` }
                return <ForecastPeriodCard key={day.dateStr} period="day" item={localizedDay} language={lang} label={localizedDay.dayName} date={localizedDay.dateFormatted}
                  icon={<AnimatedIcon icon={day.icon} size="2rem" />} selected={selectedDay?.dateStr === day.dateStr}
                  onClick={event => { openPopup(event); setSelectedDay(localizedDay); setSelectedHour(null) }} />
              })}
            </div>
          </section>

          </ForecastSectionOrder>

          <Chart hourly={hourly} darkMode={darkMode} t={t} lang={lang} />
          <WeatherPlanner onSignIn={() => plannerAuth.current?.openSignIn()} lang={lang} session={session} forecast={plannerForecast} city={city} />

          <section className="card map-section">
            <h3>🌍 {t.interactiveMap}</h3>
            <WindyMap coords={coords} lang={lang} darkMode={darkMode} title={t.interactiveMap} />
          </section>

          <section className="card aqi-section">
            <h3>🍃 {t.airQuality}</h3>
            <div className="stats-grid" style={{ marginBottom: '16px' }}>
              <div className="stat-box" style={{ background: darkMode ? 'rgba(255,255,255,0.05)' : '#ade3ff', color: darkMode ? 'white' : '#1e293b', border: 'none', boxShadow: '0 4px 10px rgba(0,0,0,0.03)' }}><p>😷</p><p className="label">{t.aqi}</p><p className="value">{formatAqiValue(weather.aqi, aqiMissing)}</p></div>
              <div className="stat-box" style={{ background: darkMode ? 'rgba(255,255,255,0.05)' : '#ade3ff', color: darkMode ? 'white' : '#1e293b', border: 'none', boxShadow: '0 4px 10px rgba(0,0,0,0.03)' }}><p>🌫️</p><p className="label">{t.pm10}</p><p className="value">{formatAqiValue(weather.pm10, aqiMissing, " µg/m³")}</p></div>
              <div className="stat-box" style={{ background: darkMode ? 'rgba(255,255,255,0.05)' : '#ade3ff', color: darkMode ? 'white' : '#1e293b', border: 'none', boxShadow: '0 4px 10px rgba(0,0,0,0.03)' }}><p>🔬</p><p className="label">{t.pm25}</p><p className="value">{formatAqiValue(weather.pm25, aqiMissing, " µg/m³")}</p></div>
            </div>
            <div className="charts-grid" style={{ gridTemplateColumns: '1fr' }}>
              <SingleChart hourly={hourly.slice(0, 24)} loading={currentSources?.aqiStatus === 'loading'} darkMode={darkMode} type="aqi" label={t.aqiChart} unit="AQI" color="#0ea5e9" height={200} lang={lang} />
            </div>
          </section>
        </main>
      )}

      {hasCurrentForecast && <>
        <ProjectShowcase lang={lang} />
        <AdSlot label={lang === 'bg' ? 'Рекламно пространство' : 'Advertising space'} />
      </>}

      {hasCurrentForecast && selectedDay && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998, background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(2px)' }} onClick={() => setSelectedDay(null)}>
          <div className="card popup-card" style={{ position: 'fixed', top: popupPos.y, left: popupPos.x, margin: 0, background: darkMode ? '#1e293b' : '#ffffff', color: darkMode ? '#ffffff' : '#1e293b', boxShadow: '0 15px 50px rgba(0,0,0,0.15)', zIndex: 9999, cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h4 style={{ fontSize: '1.1rem', margin: 0 }}>{t.detailsFor} {selectedDay.dayName}</h4>
              <button className="icon-btn" style={{ fontSize: '0.9rem', padding: '4px 8px' }} onClick={() => setSelectedDay(null)}>❌</button>
            </div>
            <div className="chart-tabs">
              <button className={'chart-tab ' + (detailTab === 'main' ? 'active-temp' : '')} onClick={() => setDetailTab('main')}>{t.tabMain}</button>
              <button className={'chart-tab ' + (detailTab === 'atmosphere' ? 'active-temp' : '')} onClick={() => setDetailTab('atmosphere')}>{t.tabAtmosphere}</button>
              <button className={'chart-tab ' + (detailTab === 'water' ? 'active-temp' : '')} onClick={() => setDetailTab('water')}>{t.tabWaterWind}</button>
            </div>
            <div className="popup-grid">
              {detailTab === 'main' && <>
                <div className="stat-box"><p>🌡️</p><p className="label">{t.temp}</p><p className="value">{formatWeatherValue(selectedDay.min, '°')} / {formatWeatherValue(selectedDay.max, '°')}</p></div>
                <div className="stat-box"><p>🤔</p><p className="label">{t.feelsLike}</p><p className="value">{formatWeatherValue(selectedDay.feelsLikeMax, '°C')}</p></div>
                <div className="stat-box"><p>🌅</p><p className="label">{t.sunrise}</p><p className="value">{selectedDay.sunrise}</p></div>
                <div className="stat-box"><p>🌇</p><p className="label">{t.sunset}</p><p className="value">{selectedDay.sunset}</p></div>
                <div className="stat-box"><p>💧</p><p className="label">{t.humidity}</p><p className="value">{formatWeatherValue(selectedDay.humidity, '%')}</p></div>
                <div className="stat-box"><p>☀️</p><p className="label">{t.uvIndex}</p><p className="value">{formatWeatherValue(selectedDay.uv, '')}</p></div>
              </>}
              {detailTab === 'atmosphere' && <>
                <div className="stat-box"><p>🔵</p><p className="label">{t.pressure}</p><p className="value">{formatWeatherValue(selectedDay.pressure, t.hpa)}</p></div>
                <div className="stat-box"><p>👁️</p><p className="label">{t.visibility}</p><p className="value">{formatWeatherValue(selectedDay.visibility, t.km)}</p></div>
                <div className="stat-box"><p>☁️</p><p className="label">{t.cloudCover}</p><p className="value">{formatWeatherValue(selectedDay.cloudCover, '%')}</p></div>
                <div className="stat-box"><p>🌿</p><p className="label">{t.dewPoint}</p><p className="value">{formatWeatherValue(selectedDay.dewPoint, '°C')}</p></div>
              </>}
              {detailTab === 'water' && <>
                <div className="stat-box"><p>🌬️</p><p className="label">{t.wind}</p><p className="value">{formatWeatherValue(selectedDay.wind, t.windUnit)}</p></div>
                <div className="stat-box"><p>🌧️</p><p className="label">{t.rain}</p><p className="value">{formatWeatherValue(selectedDay.rain, t.mm)}</p></div>
                {selectedDay.rainProbability != null && <div className="stat-box"><p>☔</p><p className="label">{lang === 'bg' ? 'Вероятност за валежи' : 'Rain chance'}</p><p className="value">{selectedDay.rainProbability}%</p></div>}
                {selectedDay.seaTemp != null ? (
                  <div className="stat-box sea-temp-box"><p>🌊</p><p className="label">{t.seaTemp}</p><p className="value">{selectedDay.seaTemp}°C</p></div>
                ) : (
                  <div className="stat-box"><p>🌊</p><p className="label">{t.seaTemp}</p><p className="value">{marineMissing}</p></div>
                )}
              </>}
            </div>
          </div>
        </div>
      )}

      {hasCurrentForecast && selectedHour && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998, background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(2px)' }} onClick={() => setSelectedHour(null)}>
          <div className="card popup-card" style={{ position: 'fixed', top: popupPos.y, left: popupPos.x, margin: 0, background: darkMode ? '#1e293b' : '#ffffff', color: darkMode ? '#ffffff' : '#1e293b', boxShadow: '0 15px 50px rgba(0,0,0,0.15)', zIndex: 9999, cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h4 style={{ fontSize: '1.1rem', margin: 0 }}>{t.detailsFor} {selectedHour.hour} ч.</h4>
              <button className="icon-btn" style={{ fontSize: '0.9rem', padding: '4px 8px' }} onClick={() => setSelectedHour(null)}>❌</button>
            </div>
            <div className="chart-tabs">
              <button className={'chart-tab ' + (detailTab === 'main' ? 'active-temp' : '')} onClick={() => setDetailTab('main')}>{t.tabMain}</button>
              <button className={'chart-tab ' + (detailTab === 'atmosphere' ? 'active-temp' : '')} onClick={() => setDetailTab('atmosphere')}>{t.tabAtmosphere}</button>
              <button className={'chart-tab ' + (detailTab === 'water' ? 'active-temp' : '')} onClick={() => setDetailTab('water')}>{t.tabWaterWind}</button>
            </div>
            <div className="popup-grid">
              {detailTab === 'main' && <>
                <div className="stat-box"><p>🌡️</p><p className="label">{t.temp}</p><p className="value">{selectedHour.temp == null ? '—' : `${selectedHour.temp}°C`}</p></div>
                <div className="stat-box"><p>🤔</p><p className="label">{t.feelsLike}</p><p className="value">{selectedHour.feelsLike == null ? '—' : `${selectedHour.feelsLike}°C`}</p></div>
                <div className="stat-box"><p>💧</p><p className="label">{t.humidity}</p><p className="value">{selectedHour.humidity == null ? '—' : `${formatWeatherValue(selectedHour.humidity, '%')}`}</p></div>
                <div className="stat-box"><p>☁️</p><p className="label">{lang === 'bg' ? 'Време' : 'Weather'}</p><p className="value"><AnimatedIcon icon={selectedHour.icon} size="1.2rem" /></p></div>
              </>}
              {detailTab === 'atmosphere' && <>
                <div className="stat-box"><p>🔵</p><p className="label">{t.pressure}</p><p className="value">{formatWeatherValue(selectedHour.pressure, t.hpa)}</p></div>
                <div className="stat-box"><p>👁️</p><p className="label">{t.visibility}</p><p className="value">{formatWeatherValue(selectedHour.visibility, t.km)}</p></div>
                <div className="stat-box"><p>☁️</p><p className="label">{t.cloudCover}</p><p className="value">{formatWeatherValue(selectedHour.cloudCover, '%')}</p></div>
                <div className="stat-box"><p>🌿</p><p className="label">{t.dewPoint}</p><p className="value">{formatWeatherValue(selectedHour.dewPoint, '°C')}</p></div>
              </>}
              {detailTab === 'water' && <>
                <div className="stat-box"><p>🌬️</p><p className="label">{t.wind}</p><p className="value">{selectedHour.wind == null ? '—' : `${selectedHour.wind} ${t.windUnit}`}</p></div>
                <div className="stat-box"><p>🌧️</p><p className="label">{t.rain}</p><p className="value">{selectedHour.rain == null ? '—' : `${selectedHour.rain} ${t.mm}`}</p></div>
                {selectedHour.rainProbability != null && <div className="stat-box"><p>☔</p><p className="label">{lang === 'bg' ? 'Вероятност за валежи' : 'Rain chance'}</p><p className="value">{selectedHour.rainProbability}%</p></div>}
                {selectedHour.aqi != null && <div className="stat-box"><p>🍃</p><p className="label">AQI</p><p className="value">{selectedHour.aqi}</p></div>}
                {selectedHour.seaTemp != null ? (
                  <div className="stat-box sea-temp-box"><p>🌊</p><p className="label">{t.seaTemp}</p><p className="value">{selectedHour.seaTemp}°C</p></div>
                ) : (
                  <div className="stat-box"><p>🌊</p><p className="label">{t.seaTemp}</p><p className="value">{marineMissing}</p></div>
                )}
              </>}
            </div>
          </div>
        </div>
      )}

      <div className="footer">
        <p>Данните за времето се предоставят от <a href="https://open-meteo.com" target="_blank" rel="noreferrer">Open-Meteo API</a></p>
        <p>© 2026 Метео Пулс. Всички права запазени.</p>
      </div>
    </div>
  )
}

export default WeatherApp
