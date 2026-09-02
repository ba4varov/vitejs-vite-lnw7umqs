export const ALLOWED_INTENTS = [
  'current', 'later', 'rain', 'clothing', 'walk', 'laundry', 'car_wash',
  'outdoor_activity', 'wind', 'temperature', 'uv', 'air_quality', 'marine',
  'other_city', 'general_weather', 'unrelated', 'unclear'
]

export const ALLOWED_TIME_SCOPES = [
  'now', 'next_12h', 'next_24h', 'evening', 'night', 'afternoon', 'tomorrow',
  'general', 'specific_date'
]

export function parseUnderstanding(value, lang) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const allowedKeys = ['intent', 'requestedCity', 'timeScope', 'targetDate', 'needsClarification', 'clarificationQuestion']
  if (Object.keys(value).some(key => !allowedKeys.includes(key))) return null
  const requestedCity = value.requestedCity ?? null
  const clarificationQuestion = value.clarificationQuestion ?? null
  if (!ALLOWED_INTENTS.includes(value.intent) || !ALLOWED_TIME_SCOPES.includes(value.timeScope) || typeof value.needsClarification !== 'boolean') return null
  if (requestedCity !== null && (typeof requestedCity !== 'string' || !requestedCity.trim() || requestedCity.length > 100)) return null
  if (clarificationQuestion !== null && (typeof clarificationQuestion !== 'string' || !clarificationQuestion.trim() || clarificationQuestion.length > 180)) return null
  if (value.targetDate !== null && (typeof value.targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.targetDate) || new Date(`${value.targetDate}T00:00:00Z`).toISOString().slice(0, 10) !== value.targetDate)) return null
  if (value.timeScope === 'specific_date' && value.targetDate === null) return null
  const normalizedQuestion = value.needsClarification && !clarificationQuestion
    ? (lang === 'bg' ? 'За кое място и период питаш?' : 'Which place and time period do you mean?')
    : clarificationQuestion
  return { intent: value.intent, requestedCity, timeScope: value.timeScope, targetDate: value.targetDate, needsClarification: value.needsClarification, clarificationQuestion: normalizedQuestion }
}

export function findDailyForecast(daily, targetDate) {
  return Array.isArray(daily) ? daily.find(day => day?.date === targetDate) ?? null : null
}

export function geminiUnderstandingError(code, lang = 'bg') {
  if (lang === 'en') return code === 'invalid-json' || code === 'invalid-structure' ? 'Gemini returned an invalid response. Please try again.' : 'Gemini is temporarily unavailable. Please try again shortly.'
  return code === 'invalid-json' || code === 'invalid-structure' ? 'Получих невалиден отговор от Gemini. Опитай отново.' : 'Gemini временно не е достъпен. Опитай отново след малко.'
}

export function validateChatInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  if (Object.keys(body).some(key => !['message', 'city', 'latitude', 'longitude', 'lang'].includes(key))) return null
  if (Object.keys(body).length !== 5) return null
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 400) return null
  if (typeof body.city !== 'string' || !body.city.trim() || body.city.length > 100) return null
  if (typeof body.latitude !== 'number' || !Number.isFinite(body.latitude) || body.latitude < -90 || body.latitude > 90) return null
  if (typeof body.longitude !== 'number' || !Number.isFinite(body.longitude) || body.longitude < -180 || body.longitude > 180) return null
  if (body.lang !== 'bg' && body.lang !== 'en') return null
  return { message: body.message.trim(), city: body.city.trim(), latitude: body.latitude, longitude: body.longitude, lang: body.lang }
}
