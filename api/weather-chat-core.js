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

const QUICK_QUESTIONS = new Map([
  ['да взема ли чадър', 'rain'],
  ['как да се облека', 'clothing'],
  ['подходящо ли е за разходка', 'walk']
])

const cleanQuestion = value => value.toLocaleLowerCase('bg-BG').replace(/[?!.,]+/g, '').replace(/\s+/g, ' ').trim()

/** Parse common weather questions without involving an optional AI service. */
export function parseDeterministicQuestion(message, _lang = 'bg') {
  const text = cleanQuestion(message)
  const quickIntent = QUICK_QUESTIONS.get(text)
  let intent = quickIntent
  if (!intent && /(чадър|вали|дъжд|валеж)/i.test(text)) intent = 'rain'
  else if (!intent && /(облека|дрех|яке|палто)/i.test(text)) intent = 'clothing'
  else if (!intent && /(разходк|разходя|навън)/i.test(text)) intent = 'walk'
  else if (!intent && /(температур|колко.*градус|топло|студено)/i.test(text)) intent = 'temperature'
  else if (!intent && /(вятър|ветровито)/i.test(text)) intent = 'wind'
  else if (!intent && /(uv|ултравиолет)/i.test(text)) intent = 'uv'
  else if (!intent && /(времето|прогноз)/i.test(text)) intent = 'general_weather'
  if (!intent) return null

  const tomorrow = /\bутре\b/i.test(text)
  const isoDate = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ?? null
  const cityMatch = text.match(/(?:^|\s)в(?:ъв)?\s+([а-яa-z][а-яa-z -]{1,50}?)(?=\s+(?:днес|утре|вечер|следобед|на\s+20\d{2})|$)/i)
  const requestedCity = cityMatch ? cityMatch[1].trim().replace(/\bвремето$/i, '').trim() || null : null
  const timeScope = isoDate ? 'specific_date' : tomorrow ? 'tomorrow' : /\b(вечер|вечерта)\b/i.test(text) ? 'evening' : /\b(следобед|следобедът)\b/i.test(text) ? 'afternoon' : /\b(нощ|нощта)\b/i.test(text) ? 'night' : quickIntent ? 'next_12h' : 'general'
  return { intent, requestedCity, timeScope, targetDate: isoDate, needsClarification: false, clarificationQuestion: null, isQuick: Boolean(quickIntent) }
}

const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null
const periodLabel = (scope, lang) => lang === 'en'
  ? ({ evening: 'this evening', afternoon: 'this afternoon', night: 'tonight', tomorrow: 'tomorrow' }[scope] ?? 'in the next 12 hours')
  : ({ evening: 'тази вечер', afternoon: 'този следобед', night: 'тази нощ', tomorrow: 'утре' }[scope] ?? 'през следващите 12 часа')

function selectedHours(summary, scope) {
  const hours = Array.isArray(summary.nextHours) ? summary.nextHours : []
  if (scope === 'tomorrow') return []
  const matching = hours.filter(hour => {
    const h = Number(String(hour.time).slice(11, 13))
    return scope === 'evening' ? h >= 18 && h < 23 : scope === 'afternoon' ? h >= 12 && h < 18 : scope === 'night' ? h >= 22 || h < 6 : true
  })
  return (matching.length ? matching : hours).slice(0, scope === 'next_24h' ? 24 : 12)
}

export function deterministicWeatherAnswer(summary, understood, lang = 'bg') {
  const period = periodLabel(understood.timeScope, lang)
  const day = understood.timeScope === 'tomorrow' ? summary.tomorrow : understood.targetDate ? summary.targetDay : null
  const hours = selectedHours(summary, understood.timeScope)
  const values = key => hours.map(item => number(item[key])).filter(value => value !== null)
  const max = (key, fallback = null) => { const data = values(key); return data.length ? Math.max(...data) : fallback }
  const min = (key, fallback = null) => { const data = values(key); return data.length ? Math.min(...data) : fallback }
  const rainChance = max('rainChancePct', number(day?.rainChancePct))
  const rainMm = values('rainMm').reduce((sum, value) => sum + value, 0) || number(day?.rainMm) || 0
  const codes = hours.map(hour => number(hour.code)).filter(code => code !== null)
  const wetCode = codes.some(code => (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95)
  const dangerous = codes.some(code => code >= 95 || code === 66 || code === 67)
  const temp = number(summary.current?.temperature_2m) ?? min('tempC', number(day?.minC))
  const feels = number(summary.current?.apparent_temperature) ?? min('feelsC', temp)
  const wind = max('windKmh', number(day?.maxWindKmh) ?? number(summary.current?.wind_speed_10m))
  const uv = max('uv', number(day?.maxUv) ?? number(summary.current?.uv_index))

  if (understood.intent === 'rain') {
    const needed = wetCode || rainMm > 0.1 || (rainChance ?? 0) >= 35
    if (lang === 'en') return `${needed ? 'Yes, take an umbrella' : 'No umbrella is needed'} ${period}: precipitation probability is up to ${rainChance ?? 0}% and about ${rainMm.toFixed(1)} mm is expected.`
    return `${needed ? 'Да, вземи чадър' : 'Не, не е нужен чадър'} ${period}: вероятността за валеж е до ${rainChance ?? 0}%, очакват се около ${rainMm.toFixed(1)} мм.`
  }
  if (understood.intent === 'clothing') {
    const advice = (feels ?? temp ?? 15) <= 8 ? 'облечи топло яке и дрехи на слоеве' : (feels ?? temp ?? 15) <= 17 ? 'облечи леко яке и дрехи на слоеве' : 'избери леки дрехи'
    const extras = `${(rainMm > 0.1 || (rainChance ?? 0) >= 35) ? ', с непромокаем слой' : ''}${(wind ?? 0) >= 25 ? ', и ветроустойчиво яке' : ''}`
    return lang === 'en' ? `${period}, dress for ${temp ?? '?'}°C (feels like ${feels ?? '?'}°C), wind up to ${wind ?? '?'} km/h${rainMm > 0.1 ? ', with a waterproof layer' : ''}.` : `${period[0].toLocaleUpperCase('bg-BG') + period.slice(1)} ${advice}${extras}. Температурата е около ${temp ?? '?'}°C, усеща се като ${feels ?? '?'}°C, с вятър до ${wind ?? '?'} км/ч.`
  }
  if (understood.intent === 'walk') {
    const bad = dangerous || (wind ?? 0) >= 45 || rainMm >= 5
    const conditional = !bad && ((rainChance ?? 0) >= 35 || (wind ?? 0) >= 25 || (temp ?? 15) < 2 || (temp ?? 15) > 32 || (uv ?? 0) >= 6)
    const verdict = bad ? 'Не, не е подходящо за разходка' : conditional ? 'Да, но с повишено внимание е подходящо за разходка' : 'Да, подходящо е за разходка'
    return lang === 'en' ? `${bad ? 'No' : conditional ? 'Yes, with precautions' : 'Yes'}, a walk is suitable ${period}. Rain chance is ${rainChance ?? 0}%, wind up to ${wind ?? '?'} km/h, temperature about ${temp ?? '?'}°C and UV up to ${uv ?? '?'}${dangerous ? '; dangerous weather is possible' : ''}.` : `${verdict} ${period}. Валежи: до ${rainChance ?? 0}%, вятър: до ${wind ?? '?'} км/ч, температура: около ${temp ?? '?'}°C, UV: до ${uv ?? '?'}${dangerous ? '; възможно е опасно време' : ''}.`
  }
  if (day) return lang === 'bg' ? `Прогнозата за ${summary.location} на ${day.date} е от ${day.minC ?? '?'}°C до ${day.maxC ?? '?'}°C, с валежи до ${day.rainChancePct ?? '?'}%.` : `The forecast for ${summary.location} on ${day.date} is ${day.minC ?? '?'}°C to ${day.maxC ?? '?'}°C, with precipitation up to ${day.rainChancePct ?? '?'}%.`
  return lang === 'bg' ? `В момента в ${summary.location} е ${temp ?? '?'}°C, усеща се като ${feels ?? '?'}°C, с вятър ${wind ?? '?'} км/ч и вероятност за валеж до ${rainChance ?? 0}%.` : `It is ${temp ?? '?'}°C in ${summary.location}, feels like ${feels ?? '?'}°C, with wind at ${wind ?? '?'} km/h and precipitation probability up to ${rainChance ?? 0}%.`
}
