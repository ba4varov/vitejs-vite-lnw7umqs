export const ALLOWED_INTENTS = [
  'current', 'later', 'rain', 'clothing', 'walk', 'laundry', 'car_wash',
  'outdoor_activity', 'wind', 'temperature', 'uv', 'air_quality', 'marine',
  'other_city', 'general_weather', 'unrelated', 'unclear'
]

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
