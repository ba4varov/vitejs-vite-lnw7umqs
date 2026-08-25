export type Language = 'bg' | 'en'

export interface Coordinates {
  lat: number
  lon: number
}

export interface FavoriteCity extends Coordinates {
  name: string
}

export interface CitySuggestion {
  name: string
  country?: string
  admin1?: string
  latitude: number
  longitude: number
}

export interface WeatherSummary {
  temp: number
  minTemp: number
  maxTemp: number
  precipProb: number
  precipSum: string
  cloudCover: number
  maxWindSpeedDaily: number
  humidity: number
  windSpeed: number
  feelsLike: number
  visibility: number
  pressure: number
  uvIndex: number
  sunrise: string
  sunset: string
  code: number
  seaTemp: number | null
  description: string
  icon: string
  aqi: number | null
  pm10: number | null
  pm25: number | null
}

export interface HourlyForecastItem {
  hour: string
  temp: number
  feelsLike: number
  rain: number
  wind: number
  pressure: number
  humidity: number
  visibility: number
  dewPoint: number
  cloudCover: number
  seaTemp: number | null
  aqi: number
  icon: string
}

export interface DailyForecastItem {
  dateStr: string
  dayName: string
  dateFormatted: string
  max: number
  min: number
  feelsLikeMax: number
  icon: string
  rain: string
  wind: number
  uv: number
  sunrise: string
  sunset: string
  humidity: number
  pressure: number
  visibility: number
  dewPoint: number
  cloudCover: number
  seaTemp: number | null
}

export interface WeatherData {
  weather: WeatherSummary
  hourly: HourlyForecastItem[]
  forecast: DailyForecastItem[]
}
