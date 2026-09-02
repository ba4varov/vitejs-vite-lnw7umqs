type ApiRequest = { method?: string; body?: Record<string, unknown> }
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: Record<string, unknown>) => void }

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null

function advice(weather: Record<string, unknown>) {
  const bg = weather.lang !== 'en'
  const temp = finite(weather.temp)
  const feels = finite(weather.feelsLike) ?? temp
  const rain = finite(weather.rain) ?? 0
  const chance = finite(weather.precipProb) ?? 0
  const wind = finite(weather.wind) ?? 0
  const uv = finite(weather.uvIndex) ?? 0
  const code = finite(weather.code) ?? 0
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return bg ? 'Облечи се топло и обуй стабилни обувки — очаква се сняг.' : 'Dress warmly and wear sturdy shoes—snow is expected.'
  if (rain > 0 || chance >= 35 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return bg ? `Вземи чадър или непромокаемо яке — вероятността за валеж е ${chance}%.` : `Take an umbrella or waterproof jacket—the rain chance is ${chance}%.`
  if (wind >= 25) return bg ? `Закопчай якето — вятърът е около ${wind} км/ч.` : `Zip up your jacket—wind is around ${wind} km/h.`
  if (uv >= 6) return bg ? `UV индексът е ${uv}: ползвай слънцезащита и търси сянка.` : `UV index is ${uv}: use sunscreen and seek shade.`
  if ((feels ?? 15) <= 10) return bg ? 'Хладно е — облечи се на слоеве и вземи яке.' : 'It is chilly—wear layers and take a jacket.'
  if ((temp ?? 15) >= 28) return bg ? 'Топло е — вземи вода, леки дрехи и слънцезащита.' : 'It is hot—take water, light clothing, and sunscreen.'
  return bg ? 'Времето е спокойно — подходящо е за излизане с обичайните сезонни дрехи.' : 'Conditions are calm—regular seasonal clothing should be comfortable.'
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' })
    if (!request.body || typeof request.body !== 'object') return response.status(400).json({ error: 'Невалидни метеорологични данни.' })
    return response.status(200).json({ advice: advice(request.body) })
  } catch {
    return response.status(200).json({ advice: 'Провери актуалната прогноза преди да излезеш.' })
  }
}
