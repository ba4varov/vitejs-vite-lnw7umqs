export const ALLOWED_INTENTS: readonly ['current', 'later', 'rain', 'clothing', 'walk', 'laundry', 'car_wash', 'outdoor_activity', 'wind', 'temperature', 'uv', 'air_quality', 'marine', 'other_city', 'general_weather', 'unrelated', 'unclear']
export const ALLOWED_TIME_SCOPES: readonly ['now', 'next_12h', 'next_24h', 'evening', 'night', 'afternoon', 'tomorrow', 'today', 'day_after_tomorrow', 'tomorrow_morning', 'tomorrow_afternoon', 'tomorrow_evening', 'tomorrow_night', 'morning', 'general', 'specific_date', 'this_weekend', 'next_weekend', 'yesterday', 'day_before_yesterday']
export const QUICK_ACTIONS: readonly ['umbrella', 'clothing', 'walk']
export type Intent = typeof ALLOWED_INTENTS[number]
export type TimeScope = typeof ALLOWED_TIME_SCOPES[number]
export type RelativeTimeScope = 'day_before_yesterday' | 'yesterday' | 'today' | 'tomorrow' | 'day_after_tomorrow'
export type Understanding = { intent: Intent; requestedCity: string | null; timeScope: TimeScope; targetDate: string | null; needsClarification: boolean; clarificationQuestion: string | null }
export function unrelatedWeatherAnswer(lang?: 'bg' | 'en'): string
export function parseUnderstanding(value: unknown, lang: 'bg' | 'en'): Understanding | null
export function findDailyForecast<T extends { date?: string }>(daily: readonly T[] | null | undefined, targetDate: string | null | undefined): T | null
export function zipForecastHours(hourly: ForecastHourly | null | undefined, currentTime?: string): ForecastHour[]
export function geminiUnderstandingError(code: string, lang?: 'bg' | 'en'): string
export type ValidChatInput = { message: string; city: string; latitude: number; longitude: number; lang: 'bg' | 'en'; quickAction?: 'umbrella' | 'clothing' | 'walk' }
export function validateChatInput(body: unknown): ValidChatInput | null
export type DeterministicUnderstanding = Understanding & { isQuick: boolean }
export function normalizeQuestion(value: string): string
export function normalizeBulgarianTimeExpressions(value: string): string
export function localIsoDate(now?: Date, timezone?: string): string
export function relativeForecastDate(scope: 'day_before_yesterday' | 'yesterday' | 'today' | 'tomorrow' | 'day_after_tomorrow', now?: Date, timezone?: string): string | null
export function weekendForecastDates(scope: 'this_weekend' | 'next_weekend', now?: Date, timezone?: string): string[]
export function extractRequestedDate(message: string, now?: Date, timezone?: string, lang?: 'bg' | 'en'): string | null
export function extractRequestedCity(message: string, lang?: 'bg' | 'en'): string | null
export function extractTimeScope(message: string): TimeScope | null
export function parseDeterministicQuestion(message: string, lang?: 'bg' | 'en', options?: { now?: Date; timezone?: string; quickAction?: 'umbrella' | 'clothing' | 'walk' }): DeterministicUnderstanding | null
export function deterministicWeatherAnswer(summary: WeatherSummary, understood: Understanding, lang?: 'bg' | 'en'): string

export type DailyForecast = {
  date: string; code: number | null; minC: number | null; maxC: number | null;
  rainMm: number | null; rainChancePct: number | null; maxWindKmh: number | null; maxUv?: number | null
}
export type ForecastHour = {
  time: string; tempC: number | null; feelsC: number | null; rainMm: number | null;
  rainChancePct: number | null; windKmh: number | null; uv: number | null; code: number | null
}
export type ForecastHourly = {
  time?: string[]; temperature_2m?: number[]; apparent_temperature?: number[];
  precipitation?: number[]; precipitation_probability?: number[];
  wind_speed_10m?: number[]; uv_index?: number[]; weather_code?: number[]
}
export type WeatherCurrent = {
  time?: string; temperature_2m?: number; apparent_temperature?: number;
  weather_code?: number; precipitation?: number; wind_speed_10m?: number; uv_index?: number
}
export type WeatherSummary = {
  location: string; timezone?: string; targetDay: DailyForecast | null; historical?: boolean;
  current?: WeatherCurrent | null; daily?: DailyForecast[]; nextHours?: ForecastHour[];
  tomorrow?: DailyForecast | null; requestedDate?: string | null;
  requestedDates?: string[]; targetDays?: DailyForecast[];
  airQuality?: { europeanAqi: number | null; pm10: number | null; pm2_5: number | null } | null;
  marine?: { seaTemperatureC: number } | null
}
