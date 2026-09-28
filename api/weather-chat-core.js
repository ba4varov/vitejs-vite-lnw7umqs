export const ALLOWED_INTENTS = [
  'current', 'later', 'rain', 'clothing', 'walk', 'laundry', 'car_wash',
  'outdoor_activity', 'wind', 'temperature', 'uv', 'air_quality', 'marine',
  'other_city', 'general_weather', 'unrelated', 'unclear'
]

export const ALLOWED_TIME_SCOPES = [
  'now', 'next_12h', 'next_24h', 'evening', 'night', 'afternoon', 'tomorrow',
  'today', 'day_after_tomorrow', 'tomorrow_morning', 'tomorrow_afternoon',
  'tomorrow_evening', 'tomorrow_night', 'morning', 'general', 'specific_date',
  'this_weekend', 'next_weekend', 'yesterday', 'day_before_yesterday'
]

export const QUICK_ACTIONS = ['umbrella', 'clothing', 'walk']

export const unrelatedWeatherAnswer = (lang = 'bg') => lang === 'bg'
  ? 'Мога да отговарям само на въпроси за времето. За всичко друго прогнозата ми е мъглива. 🌫️'
  : 'I can only answer weather questions. For everything else, my forecast is foggy. 🌫️'

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

export function zipForecastHours(hourly, currentTime) {
  if (!Array.isArray(hourly?.time)) return []
  const start = currentTime ? hourly.time.findIndex(time => String(time).slice(0, 13) >= currentTime.slice(0, 13)) : 0
  if (start < 0) return []
  return hourly.time.slice(start).map((time, offset) => {
    const i = start + offset
    return {
      time, tempC: hourly.temperature_2m?.[i] ?? null, feelsC: hourly.apparent_temperature?.[i] ?? null,
      rainMm: hourly.precipitation?.[i] ?? null, rainChancePct: hourly.precipitation_probability?.[i] ?? null,
      windKmh: hourly.wind_speed_10m?.[i] ?? null, uv: hourly.uv_index?.[i] ?? null, code: hourly.weather_code?.[i] ?? null
    }
  })
}

export function geminiUnderstandingError(code, lang = 'bg') {
  if (lang === 'en') return code === 'invalid-json' || code === 'invalid-structure' ? 'Gemini returned an invalid response. Please try again.' : 'Gemini is temporarily unavailable. Please try again shortly.'
  return code === 'invalid-json' || code === 'invalid-structure' ? 'Получих невалиден отговор от Gemini. Опитай отново.' : 'Gemini временно не е достъпен. Опитай отново след малко.'
}

export function validateChatInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  if (Object.keys(body).some(key => !['message', 'city', 'latitude', 'longitude', 'lang', 'quickAction'].includes(key))) return null
  if (Object.keys(body).length < 5 || Object.keys(body).length > 6) return null
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 400) return null
  if (typeof body.city !== 'string' || !body.city.trim() || body.city.length > 100) return null
  if (typeof body.latitude !== 'number' || !Number.isFinite(body.latitude) || body.latitude < -90 || body.latitude > 90) return null
  if (typeof body.longitude !== 'number' || !Number.isFinite(body.longitude) || body.longitude < -180 || body.longitude > 180) return null
  if (body.lang !== 'bg' && body.lang !== 'en') return null
  if (body.quickAction !== undefined && !QUICK_ACTIONS.includes(body.quickAction)) return null
  return { message: body.message.trim(), city: body.city.trim(), latitude: body.latitude, longitude: body.longitude, lang: body.lang, ...(body.quickAction ? { quickAction: body.quickAction } : {}) }
}

const QUICK_QUESTIONS = new Map([
  ['да взема ли чадър', 'rain'],
  ['трябва ли ми чадър', 'rain'],
  ['как да се облека', 'clothing'],
  ['какви дрехи да взема', 'clothing'],
  ['подходящо ли е за разходка', 'walk'], ['става ли за разходка', 'walk'],
  ['може ли да излезем навън', 'walk'], ['добро ли е времето за разходка', 'walk']
])

const PROTECTED_LOCATION = new Set('разходка чадър дрехи обличане плаж море навън излизане времето прогноза условия днес утре вдругиден сутрин следобед вечер нощ валеж дъжд сняг буря градушка температура студено топло вятър облаци момента сега'.split(' '))

/** Canonicalize only known Bulgarian time expressions (never place names). */
export const normalizeBulgarianTimeExpressions = value => value.normalize('NFC').replace(
  /(?:вдруги(?:\s+|-)ден|след\s+(?:два|2)\s+дни|ден\s+след\s+утре)/giu,
  'вдругиден'
)

export const normalizeQuestion = value => normalizeBulgarianTimeExpressions(value).toLocaleLowerCase('bg-BG').replace(/[?!,;:]+/g, ' ').replace(/\s+/g, ' ').trim()

const MONTHS_BG = new Map([
  ['януари', 1], ['февруари', 2], ['март', 3], ['април', 4], ['май', 5], ['юни', 6],
  ['юли', 7], ['август', 8], ['септември', 9], ['октомври', 10], ['ноември', 11], ['декември', 12]
])

const iso = (year, month, day) => {
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const date = new Date(`${value}T00:00:00Z`)
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day ? value : null
}

export function localIsoDate(now = new Date(), timezone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = type => parts.find(part => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function relativeForecastDate(scope, now = new Date(), timezone = 'UTC') {
  const offsets = { day_before_yesterday: -2, yesterday: -1, today: 0, tomorrow: 1, day_after_tomorrow: 2 }
  const offset = offsets[scope]
  if (offset === undefined) return null
  const date = new Date(`${localIsoDate(now, timezone)}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

/** Return the Saturday/Sunday dates for a weekend in the searched place. */
export function weekendForecastDates(scope, now = new Date(), timezone = 'UTC') {
  if (scope !== 'this_weekend' && scope !== 'next_weekend') return []
  const localDate = localIsoDate(now, timezone)
  const localDay = new Date(`${localDate}T12:00:00Z`).getUTCDay()
  let saturdayOffset = (6 - localDay + 7) % 7

  // On Sunday, this weekend has only its remaining Sunday. The following
  // Saturday is nevertheless the start of "next weekend".
  if (scope === 'this_weekend' && localDay === 0) return [localDate]
  if (scope === 'next_weekend') saturdayOffset += localDay === 0 ? 0 : 7
  const saturday = new Date(`${localDate}T12:00:00Z`)
  saturday.setUTCDate(saturday.getUTCDate() + saturdayOffset)
  const sunday = new Date(saturday)
  sunday.setUTCDate(sunday.getUTCDate() + 1)
  return [saturday.toISOString().slice(0, 10), sunday.toISOString().slice(0, 10)]
}

export function extractRequestedDate(message, now = new Date(), timezone = 'UTC', _lang = 'bg') {
  const text = normalizeQuestion(message)
  const relative = text.match(/(?:^|\s)(?:след\s+(\d{1,2}|един|едно|два|две|три|четири|пет)\s+дни?|следващ(?:ия|ият)\s+ден)(?=\s|$)/u)
  if (relative) {
    const words = { един: 1, едно: 1, два: 2, две: 2, три: 3, четири: 4, пет: 5 }
    const offset = relative[1] ? (words[relative[1]] ?? Number(relative[1])) : 1
    if (offset < 1 || offset > 15) return null
    const date = new Date(`${localIsoDate(now, timezone)}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
  }
  let match = text.match(/(?:^|\s)(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?(?=\s|$)/u)
  let day; let month; let year
  if (match) [, day, month, year] = match
  else {
    match = text.match(/(?:^|\s)(\d{1,2})(?:-?ти)?\s+(януари|февруари|март|април|май|юни|юли|август|септември|октомври|ноември|декември)(?:\s+(\d{4}))?(?=\s|$)/u)
    if (!match) {
      const englishMonths = new Map('january february march april may june july august september october november december'.split(' ').map((name, i) => [name, i + 1]))
      match = text.match(/(?:^|\s)(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?(?=\s|$)/u)
      if (!match) return null
      day = match[2]; month = englishMonths.get(match[1]); year = match[3]
    } else {
      day = match[1]; month = MONTHS_BG.get(match[2]); year = match[3]
    }
  }
  day = Number(day); month = Number(month)
  const today = localIsoDate(now, timezone)
  if (!year) {
    year = Number(today.slice(0, 4))
    const candidate = iso(year, month, day)
    if (candidate && candidate < today) year += 1
  } else year = Number(year)
  return iso(year, month, day)
}

export function extractRequestedCity(message, _lang = 'bg') {
  const cleaned = normalizeBulgarianTimeExpressions(message).replace(/[?!]+$/u, '').trim()
  const stop = String.raw`(?=[,;.!?]|\s+(?:на|за|on|for)\s+\d|\s+(?:днес|утре|вдругиден|вчера|завчера|сега|в момента|тази|този|следващия|сутрин|следобед|вечер|нощ|довечера|през|след|за колко|today|tomorrow|yesterday|this|next|when|while|morning|afternoon|evening|night|during|over)(?:\s|$)|$)`
  // "за" denotes a place only when attached to an explicit weather construction.
  const patterns = [
    new RegExp(String.raw`(?:^|\s)(?:във|в)\s+([\p{L}][\p{L}'’.,-]*(?:\s+[\p{L}][\p{L}'’.,-]*){0,4}?)${stop}`, 'giu'),
    new RegExp(String.raw`(?:времето|прогнозата|прогноза)\s+за\s+([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,4}?)${stop}`, 'giu'),
    new RegExp(String.raw`(?:^|\s)(?:in|at|near)\s+([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,4}?)${stop}`, 'giu'),
    new RegExp(String.raw`(?:weather|forecast)\s+(?:for|in)\s+([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,4}?)${stop}`, 'giu')
  ]
  const candidates = patterns.flatMap(pattern => [...cleaned.matchAll(pattern)].map(match => match[1]
    .replace(/,\s*(?:докато|когато|а|но|when|while)(?=\s|$).*$/iu, '')
    .replace(/\s+(?:какво|каква|какъв|ще|е|бъде|времето|прогнозата).*$/iu, '').trim()))
  if (candidates.length) {
    const candidate = candidates.at(-1)
    if (!candidate.split(/\s+/u).every(word => PROTECTED_LOCATION.has(normalizeQuestion(word).replace(/[.,]/g, '')))) return candidate
  }
  // Common free word order: a proper-name phrase immediately before the time word.
  const bare = cleaned.match(/(?:^|\s)([\p{Lu}][\p{L}'’.-]*(?:[ ,]+[\p{Lu}][\p{L}'’.-]*){0,3})\s+(?:днес|утре|вдругиден)(?=\s|$)/u)?.[1]
  return bare && !PROTECTED_LOCATION.has(normalizeQuestion(bare)) ? bare.trim() : null
}

export function extractTimeScope(message) {
  const text = normalizeQuestion(message)
  const has = value => new RegExp(`(?:^|\\s)${value}(?=\\s|$)`, 'u').test(text)
  if (has('(?:следващия|следващият|идния|идният)\\s+уикенд')) return 'next_weekend'
  if (has('next\\s+weekend')) return 'next_weekend'
  if (has('(?:(?:този|настоящия)\\s+уикенд|през\\s+уикенда)')) return 'this_weekend'
  if (has('this\\s+weekend')) return 'this_weekend'
  if (has('(?:сега|в момента)')) return 'now'
  if (has('(?:следващите|идните|до)\\s+24\\s+часа')) return 'next_24h'
  if (has('(?:next|following)\\s+24\\s+hours')) return 'next_24h'
  if (has('(?:следващите|идните|до)\\s+12\\s+часа')) return 'next_12h'
  if (has('(?:next|following)\\s+12\\s+hours')) return 'next_12h'
  if (has('the\\s+day\\s+before\\s+yesterday') || has('завчера')) return 'day_before_yesterday'
  if (has('the\\s+day\\s+after\\s+tomorrow')) return 'day_after_tomorrow'
  if (has('yesterday') || has('вчера')) return 'yesterday'
  if (has('утре\\s+(?:през\\s+)?нощ(?:та)?')) return 'tomorrow_night'
  if (has('утре\\s+сутрин')) return 'tomorrow_morning'
  if (has('утре\\s+следобед')) return 'tomorrow_afternoon'
  if (has('утре\\s+вечер')) return 'tomorrow_evening'
  if (has('вдругиден')) return 'day_after_tomorrow'
  if (has('tomorrow\\s+night')) return 'tomorrow_night'
  if (has('tomorrow\\s+morning')) return 'tomorrow_morning'
  if (has('tomorrow\\s+afternoon')) return 'tomorrow_afternoon'
  if (has('tomorrow\\s+evening')) return 'tomorrow_evening'
  if (has('tomorrow')) return 'tomorrow'
  if (has('утре')) return 'tomorrow'
  if (has('(?:днес|до края на деня)')) return 'today'
  if (has('today')) return 'today'
  if (has('тази сутрин')) return 'morning'
  if (has('този следобед')) return 'afternoon'
  if (has('(?:тази вечер|довечера|вечерта)')) return 'evening'
  if (has('(?:тази нощ|през нощта)')) return 'night'
  if (has('this\\s+morning')) return 'morning'
  if (has('this\\s+afternoon')) return 'afternoon'
  if (has('this\\s+evening')) return 'evening'
  if (has('tonight')) return 'night'
  return null
}

/** Parse common weather questions without involving an optional AI service. */
export function parseDeterministicQuestion(message, lang = 'bg', options = {}) {
  const normalizedMessage = normalizeBulgarianTimeExpressions(message)
  const text = normalizeQuestion(normalizedMessage)
  // Explicit entities are deliberately extracted before generic intent words.
  const requestedCity = extractRequestedCity(normalizedMessage, lang)
  const requestedDate = extractRequestedDate(normalizedMessage, options.now, options.timezone, lang)
  const actionIntent = { umbrella: 'rain', clothing: 'clothing', walk: 'walk' }[options.quickAction]
  const quickIntent = actionIntent ?? QUICK_QUESTIONS.get(text)
  let intent = quickIntent
  if (!intent && /(чадър|вали|превал|дъжд|валеж|сняг|снег)/i.test(text)) intent = 'rain'
  else if (!intent && /\b(rain|raining|precipitation|snow|umbrella|shower)s?\b/i.test(text)) intent = 'rain'
  else if (!intent && /(облека|дрех|яке|палто)/i.test(text)) intent = 'clothing'
  else if (!intent && /\b(wear|clothes|clothing|jacket|coat|dress)\b/i.test(text)) intent = 'clothing'
  else if (!intent && /(разходк|разходя|навън)/i.test(text)) intent = 'walk'
  else if (!intent && /\b(walk|stroll|walking)\b/i.test(text)) intent = 'walk'
  else if (!intent && /(температур|колко.*градус|топло|студено)/i.test(text)) intent = 'temperature'
  else if (!intent && /\b(temperature|degrees|hot|cold|warm)\b/i.test(text)) intent = 'temperature'
  else if (!intent && /(вятър|ветровито)/i.test(text)) intent = 'wind'
  else if (!intent && /\b(wind|windy|gusts?)\b/i.test(text)) intent = 'wind'
  else if (!intent && /(пера|пране|простра|простирам)/i.test(text)) intent = 'laundry'
  else if (!intent && /(измия|мия|автомивка).*колата|колата.*(?:измия|мия)/i.test(text)) intent = 'car_wash'
  else if (!intent && /(плаж|море|морска вода)/i.test(text)) intent = 'marine'
  else if (!intent && /(въздух|замърсен|aqi)/i.test(text)) intent = 'air_quality'
  else if (!intent && /(uv|ултравиолет)/i.test(text)) intent = 'uv'
  else if (!intent && /\b(air quality|aqi|pollution)\b/i.test(text)) intent = 'air_quality'
  else if (!intent && /\b(uv|ultraviolet)\b/i.test(text)) intent = 'uv'
  else if (!intent && /\b(weather|forecast|sunny|cloudy)\b/i.test(text)) intent = 'general_weather'
  // Standalone "време" is ambiguous in Bulgarian. Common non-weather phrases
  // such as "нямам време" must not be routed to the forecast service.
  else if (!intent && /(прогноз|слънц|облач)/i.test(text)) intent = 'general_weather'
  else if (!intent && /(?:^|\s)време(?:то)?(?=\s|$)/iu.test(text) && !/(?:нямам|нямаш|няма|имам|имаш|има|губя|губиш|губим)\s+(?:много\s+|никакво\s+)?време|време\s+за\s+(?:губене|почивка|работа|учене)/iu.test(text)) intent = 'general_weather'
  else if (!intent && (requestedCity || requestedDate)) intent = 'general_weather'
  if (!intent) return { intent: 'unrelated', requestedCity: null, timeScope: 'general', targetDate: null, needsClarification: false, clarificationQuestion: null, isQuick: false }

  if (intent === 'general_weather' && /^(?:време(?:то)?|прогноза(?:та)?|weather|forecast)$/u.test(text)) {
    return { intent: 'unclear', requestedCity, timeScope: 'general', targetDate: null, needsClarification: true, clarificationQuestion: lang === 'bg' ? 'За кое място и период питаш?' : 'Which place and time period do you mean?', isQuick: false }
  }

  const requestedScope = extractTimeScope(normalizedMessage)
  // A relative-day construction we do not explicitly support is safer to
  // clarify than to silently answer with current conditions.
  const unresolvedFuture = /(?:^|\s)(?:след\s+(?:\d+|един|едно|три|четири|пет)\s+дни?|в\s*друг(?:ия|и)\s+ден|(?:следващата|идната)\s+седмица|за\s+уикенда)(?=\s|$)/u.test(text) && !requestedScope && !requestedDate
  if (unresolvedFuture) return { intent: 'unclear', requestedCity, timeScope: 'general', targetDate: null, needsClarification: true, clarificationQuestion: lang === 'bg' ? 'За кой точно ден питаш?' : 'Which exact day do you mean?', isQuick: false }
  const explicitIso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ?? null
  const targetDate = requestedDate ?? explicitIso
  const timeScope = targetDate ? 'specific_date' : requestedScope ?? (quickIntent ? 'next_12h' : 'general')
  return { intent, requestedCity: actionIntent ? null : requestedCity, timeScope, targetDate, needsClarification: false, clarificationQuestion: null, isQuick: Boolean(quickIntent) }
}

const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null
const periodLabel = (scope, lang) => lang === 'en'
  ? ({ now: 'now', next_12h: 'in the next 12 hours', next_24h: 'in the next 24 hours', today: 'today', yesterday: 'yesterday', day_before_yesterday: 'the day before yesterday', day_after_tomorrow: 'the day after tomorrow', morning: 'this morning', evening: 'this evening', afternoon: 'this afternoon', night: 'tonight', tomorrow: 'tomorrow', tomorrow_morning: 'tomorrow morning', tomorrow_afternoon: 'tomorrow afternoon', tomorrow_evening: 'tomorrow evening', tomorrow_night: 'tomorrow night' }[scope] ?? 'now')
  : ({ now: 'сега', next_12h: 'през следващите 12 часа', next_24h: 'през следващите 24 часа', today: 'днес', yesterday: 'вчера', day_before_yesterday: 'завчера', day_after_tomorrow: 'вдругиден', morning: 'тази сутрин', evening: 'тази вечер', afternoon: 'този следобед', night: 'тази нощ', tomorrow: 'утре', tomorrow_morning: 'утре сутрин', tomorrow_afternoon: 'утре следобед', tomorrow_evening: 'утре вечер', tomorrow_night: 'утре през нощта' }[scope] ?? 'сега')

const PERIOD_HOURS = {
  morning: [6, 12], afternoon: [12, 18], evening: [18, 23], night: [22, 30]
}

function selectedHours(summary, scope) {
  const hours = Array.isArray(summary.nextHours) ? summary.nextHours : []
  if (['tomorrow', 'today', 'day_after_tomorrow', 'specific_date'].includes(scope)) return []
  if (scope === 'now') return hours.slice(0, 1)
  const period = scope.replace(/^tomorrow_/, '')
  const window = PERIOD_HOURS[period]
  if (!window) return hours.slice(0, scope === 'next_24h' ? 24 : 12)
  const date = scope.startsWith('tomorrow_') ? summary.requestedDate : summary.current?.time?.slice(0, 10)
  if (!date) return []
  const nextDate = new Date(`${date}T12:00:00Z`)
  nextDate.setUTCDate(nextDate.getUTCDate() + 1)
  const endDate = nextDate.toISOString().slice(0, 10)
  return hours.filter(hour => {
    const time = String(hour.time)
    const day = time.slice(0, 10)
    const hourOfDay = Number(time.slice(11, 13))
    return (day === date && hourOfDay >= window[0] && hourOfDay < Math.min(24, window[1])) ||
      (window[1] > 24 && day === endDate && hourOfDay < window[1] - 24)
  })
}

export function deterministicWeatherAnswer(summary, understood, lang = 'bg') {
  if (understood.timeScope === 'this_weekend' || understood.timeScope === 'next_weekend') {
    return weekendForecastAnswer(summary, understood, lang)
  }
  const period = periodLabel(understood.timeScope, lang)
  const day = ['day_before_yesterday', 'yesterday', 'today', 'tomorrow', 'day_after_tomorrow'].includes(understood.timeScope) ? summary.targetDay : understood.targetDate ? summary.targetDay : null
  const hours = selectedHours(summary, understood.timeScope)
  const hourlyPeriod = Boolean(PERIOD_HOURS[understood.timeScope.replace(/^tomorrow_/, '')])
  if (hourlyPeriod && !hours.length) return lang === 'bg'
    ? `Нямам налична почасова прогноза за ${summary.location} ${period}. Не искам да ти дам данни за друг период.`
    : `I don't have an hourly forecast for ${summary.location} ${period}, so I can't give you figures from a different period.`
  const values = key => hours.map(item => number(item[key])).filter(value => value !== null)
  if (hourlyPeriod && !values('tempC').length) return lang === 'bg'
    ? `Нямам достатъчно почасови данни за ${summary.location} ${period}.`
    : `I don't have enough hourly data for ${summary.location} ${period}.`
  const max = (key, fallback = null) => { const data = values(key); return data.length ? Math.max(...data) : fallback }
  const min = (key, fallback = null) => { const data = values(key); return data.length ? Math.min(...data) : fallback }
  const rainChance = max('rainChancePct', hourlyPeriod ? null : number(day?.rainChancePct))
  const rainMm = hours.length ? values('rainMm').reduce((sum, value) => sum + value, 0) : number(day?.rainMm) ?? 0
  const codes = hours.map(hour => number(hour.code)).filter(code => code !== null)
  const wetCode = codes.some(code => (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95)
  const dangerous = codes.some(code => code >= 95 || code === 66 || code === 67)
  const temp = hourlyPeriod ? min('tempC') : number(summary.current?.temperature_2m) ?? min('tempC', number(day?.minC))
  const feels = hourlyPeriod ? min('feelsC') : number(summary.current?.apparent_temperature) ?? min('feelsC', temp)
  const wind = max('windKmh', hourlyPeriod ? null : number(day?.maxWindKmh) ?? number(summary.current?.wind_speed_10m))
  const uv = max('uv', hourlyPeriod ? null : number(day?.maxUv) ?? number(summary.current?.uv_index))

  // A calendar date always wins over activity/current-condition intents.
  if (day && ['rain', 'clothing', 'walk', 'temperature', 'wind'].includes(understood.intent)) return dailyIntentAnswer(summary, day, understood, lang)
  if (day && ['specific_date', 'day_before_yesterday', 'yesterday', 'today', 'tomorrow', 'day_after_tomorrow'].includes(understood.timeScope)) return dailyForecastAnswer(summary, day, lang, understood.timeScope)
  if (hours.length && understood.intent === 'general_weather' && ['next_12h', 'next_24h', 'morning', 'afternoon', 'evening', 'night', 'tomorrow_morning', 'tomorrow_afternoon', 'tomorrow_evening', 'tomorrow_night'].includes(understood.timeScope)) {
    const temperatures = values('tempC'); const apparent = values('feelsC')
    const practical = (rainChance ?? 0) >= 35 || rainMm > 0.1 ? 'Предвиди защита от дъжд.' : (wind ?? 0) >= 30 ? 'Предвиди защита от вятър.' : 'Условията изглеждат подходящи за обичайни дейности.'
    return lang === 'bg'
      ? `Прогнозата за ${summary.location} ${period} е ${Math.min(...temperatures)}–${Math.max(...temperatures)}°C${apparent.length ? `, усеща се като ${Math.min(...apparent)}–${Math.max(...apparent)}°C` : ''}. Валежи: до ${rainChance ?? 0}% и около ${rainMm.toFixed(1)} мм; вятър до ${wind ?? '?'} км/ч. ${practical}`
      : `The forecast for ${summary.location} ${period} is ${Math.min(...temperatures)}–${Math.max(...temperatures)}°C, precipitation up to ${rainChance ?? 0}% (${rainMm.toFixed(1)} mm), and wind up to ${wind ?? '?'} km/h.`
  }

  if (understood.intent === 'rain') {
    const needed = wetCode || rainMm > 0.1 || (rainChance ?? 0) >= 35
    if (lang === 'en') return `${needed ? 'Yes, take an umbrella' : 'No umbrella is needed'} ${period}: precipitation probability is up to ${rainChance ?? 0}% and about ${rainMm.toFixed(1)} mm is expected.`
    return `${needed ? 'Да, вземи чадър' : 'Не, не е нужен чадър'} ${period}: вероятността за валеж е до ${rainChance ?? 0}%, очакват се около ${rainMm.toFixed(1)} мм.`
  }
  if (understood.intent === 'clothing') {
    const advice = (feels ?? temp ?? 15) <= 8 ? 'облечи по-топли дрехи' : (feels ?? temp ?? 15) <= 17 ? 'вземи леко яке' : 'избери леки дрехи'
    const extras = `${(rainMm > 0.1 || (rainChance ?? 0) >= 35) ? '; заради дъжда вземи и непромокаемо яке' : ''}${(wind ?? 0) >= 25 ? '; заради вятъра избери ветроустойчиво яке' : ''}`
    return lang === 'en' ? `${period}, dress for ${temp ?? '?'}°C (feels like ${feels ?? '?'}°C), wind up to ${wind ?? '?'} km/h${rainMm > 0.1 ? ', with a waterproof layer' : ''}.` : `${period[0].toLocaleUpperCase('bg-BG') + period.slice(1)} ${advice}${extras}. Температурата е около ${temp ?? '?'}°C, усеща се като ${feels ?? '?'}°C, с вятър до ${wind ?? '?'} км/ч.`
  }
  if (understood.intent === 'walk') {
    const bad = dangerous || (wind ?? 0) >= 45 || rainMm >= 5
    const conditional = !bad && ((rainChance ?? 0) >= 35 || (wind ?? 0) >= 25 || (temp ?? 15) < 2 || (temp ?? 15) > 32 || (uv ?? 0) >= 6)
    const verdict = bad ? 'Не, не е подходящо за разходка' : conditional ? 'Да, но с повишено внимание е подходящо за разходка' : 'Да, подходящо е за разходка'
    return lang === 'en' ? `${bad ? 'No' : conditional ? 'Yes, with precautions' : 'Yes'}, a walk is suitable ${period}. Rain chance is ${rainChance ?? 0}%, wind up to ${wind ?? '?'} km/h, temperature about ${temp ?? '?'}°C and UV up to ${uv ?? '?'}${dangerous ? '; dangerous weather is possible' : ''}.` : `${verdict} ${period}. Валежи: до ${rainChance ?? 0}%, вятър: до ${wind ?? '?'} км/ч, температура: около ${temp ?? '?'}°C, UV: до ${uv ?? '?'}${dangerous ? '; възможно е опасно време' : ''}.`
  }
  if (understood.intent === 'temperature') return lang === 'bg'
    ? `В ${summary.location} ${period} температурата е ${hours.length > 1 ? `${min('tempC') ?? '?'}–${max('tempC') ?? '?'}°C` : `${temp ?? '?'}°C`}, усеща се като ${feels ?? '?'}°C.`
    : `In ${summary.location} ${period}, temperature is ${hours.length > 1 ? `${min('tempC') ?? '?'}–${max('tempC') ?? '?'}°C` : `${temp ?? '?'}°C`}, feels like ${feels ?? '?'}°C.`
  if (understood.intent === 'wind') return lang === 'bg'
    ? `В ${summary.location} ${period} вятърът е до ${wind ?? '?'} км/ч.`
    : `In ${summary.location} ${period}, wind reaches ${wind ?? '?'} km/h.`
  if (understood.intent === 'uv') return lang === 'bg'
    ? `В ${summary.location} ${period} UV индексът е до ${uv ?? '?'}; при стойност 6 или повече ползвай слънцезащита.`
    : `In ${summary.location} ${period}, UV index reaches ${uv ?? '?'}; use sun protection at 6 or above.`
  if (understood.intent === 'air_quality') return lang === 'bg'
    ? `В ${summary.location} текущият европейски индекс за качество на въздуха е ${summary.airQuality?.europeanAqi ?? 'неизвестен'}${summary.airQuality?.pm2_5 != null ? `, ФПЧ2.5: ${summary.airQuality.pm2_5} µg/m³` : ''}.` : `In ${summary.location}, current European AQI is ${summary.airQuality?.europeanAqi ?? 'unavailable'}.`
  if (understood.intent === 'marine') return lang === 'bg'
    ? `Край ${summary.location} текущата температура на морската повърхност е ${summary.marine?.seaTemperatureC != null ? `${summary.marine.seaTemperatureC}°C` : 'няма налични данни'}.` : `Sea surface temperature near ${summary.location} is ${summary.marine?.seaTemperatureC != null ? `${summary.marine.seaTemperatureC}°C` : 'unavailable'}.`
  if (understood.intent === 'laundry' || understood.intent === 'car_wash') {
    const wet = rainMm > 0.1 || (rainChance ?? 0) >= 35
    return lang === 'bg' ? `${wet ? 'По-добре изчакай' : 'Условията изглеждат подходящи'} за ${understood.intent === 'laundry' ? 'простиране' : 'миене на колата'} ${period}. Валежи: до ${rainChance ?? '?'}% и около ${rainMm.toFixed(1)} мм.` : `${wet ? 'Better wait' : 'Conditions look suitable'} ${period}. Rain chance up to ${rainChance ?? '?'}%, about ${rainMm.toFixed(1)} mm.`
  }
  if (day) return dailyForecastAnswer(summary, day, lang, understood.timeScope)
  return lang === 'bg' ? `В момента в ${summary.location} е ${temp ?? '?'}°C, усеща се като ${feels ?? '?'}°C, с вятър ${wind ?? '?'} км/ч и вероятност за валеж до ${rainChance ?? 0}%.` : `It is ${temp ?? '?'}°C in ${summary.location}, feels like ${feels ?? '?'}°C, with wind at ${wind ?? '?'} km/h and precipitation probability up to ${rainChance ?? 0}%.`
}

function weekendForecastAnswer(summary, understood, lang) {
  const dates = Array.isArray(summary.requestedDates) ? summary.requestedDates : []
  const days = Array.isArray(summary.targetDays) ? summary.targetDays : []
  const label = understood.timeScope === 'next_weekend'
    ? (lang === 'bg' ? 'следващия уикенд' : 'next weekend')
    : (lang === 'bg' ? 'този уикенд' : 'this weekend')
  const lines = dates.map(date => {
    const day = days.find(candidate => candidate?.date === date)
    if (!day) return lang === 'bg'
      ? `За ${date} няма налична прогноза.`
      : `No forecast is available for ${date}.`
    return ['rain', 'clothing', 'walk', 'temperature', 'wind'].includes(understood.intent)
      ? dailyIntentAnswer(summary, day, { ...understood, timeScope: 'specific_date' }, lang)
      : dailyForecastAnswer(summary, day, lang, 'specific_date')
  })
  if (!lines.length) return lang === 'bg'
    ? `Нямам налична прогноза за ${summary.location} за ${label}.`
    : `I don't have a forecast for ${summary.location} for ${label}.`
  return lang === 'bg'
    ? `Прогноза за ${summary.location} за ${label}:\n${lines.join('\n')}`
    : `Forecast for ${summary.location} for ${label}:\n${lines.join('\n')}`
}

function dailyIntentAnswer(summary, day, understood, lang) {
  const period = periodLabel(understood.timeScope, lang)
  const dateLabel = understood.timeScope === 'specific_date'
    ? new Intl.DateTimeFormat(lang === 'bg' ? 'bg-BG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day.date}T00:00:00Z`))
    : period
  const placePeriod = `${summary.location} ${dateLabel}`
  const rain = number(day.rainMm); const chance = number(day.rainChancePct); const wind = number(day.maxWindKmh)
  const minC = number(day.minC); const maxC = number(day.maxC)
  const historical = Boolean(summary.historical)
  const source = historical
    ? (lang === 'bg' ? 'Това са архивни реанализирани данни от Open-Meteo, а не прогноза.' : 'These are Open-Meteo historical reanalysis data, not a forecast.')
    : (lang === 'bg' ? 'Данните са прогноза от Open-Meteo.' : 'The data are an Open-Meteo forecast.')
  if (understood.timeScope === 'specific_date' && understood.intent === 'rain') return `${dailyForecastAnswer(summary, day, lang, understood.timeScope)} ${source}`
  if (understood.intent === 'rain') return lang === 'bg'
    ? `За ${placePeriod} ${rain == null && chance == null ? 'няма налични данни за валежите' : `валежите са ${rain ?? '?'} мм${chance == null ? '' : `, с вероятност до ${chance}%`}`}. ${source}`
    : `For ${placePeriod}, ${rain == null && chance == null ? 'precipitation data are unavailable' : `precipitation is ${rain ?? '?'} mm${chance == null ? '' : `, with probability up to ${chance}%`}`}. ${source}`
  if (understood.intent === 'temperature') return lang === 'bg'
    ? `За ${placePeriod} температурата е ${minC ?? '?'}–${maxC ?? '?'}°C. ${source}`
    : `For ${placePeriod}, the temperature is ${minC ?? '?'}–${maxC ?? '?'}°C. ${source}`
  if (understood.intent === 'wind') return lang === 'bg'
    ? `За ${placePeriod} вятърът е до ${wind ?? '?'} км/ч. ${source}`
    : `For ${placePeriod}, wind reaches ${wind ?? '?'} km/h. ${source}`
  const wet = (rain ?? 0) > 0.1 || (chance ?? 0) >= 35
  const cold = (minC ?? 15) <= 8
  if (understood.intent === 'clothing') return lang === 'bg'
    ? `За ${placePeriod} ${cold ? 'са подходящи топли дрехи' : 'са подходящи сезонни дрехи'}${wet ? ' и непромокаем слой' : ''}; температурите са ${minC ?? '?'}–${maxC ?? '?'}°C, а вятърът е до ${wind ?? '?'} км/ч. ${source}`
    : `For ${placePeriod}, ${cold ? 'wear warm clothes' : 'wear season-appropriate clothes'}${wet ? ' with a waterproof layer' : ''}; temperatures are ${minC ?? '?'}–${maxC ?? '?'}°C and wind reaches ${wind ?? '?'} km/h. ${source}`
  const unsuitable = wet || (wind ?? 0) >= 45 || (minC ?? 15) < 0 || (maxC ?? 15) > 34
  return lang === 'bg'
    ? `За разходка в ${placePeriod} условията ${unsuitable ? 'изискват повишено внимание' : 'изглеждат подходящи'}: ${minC ?? '?'}–${maxC ?? '?'}°C, ${rain ?? '?'} мм валеж и вятър до ${wind ?? '?'} км/ч. ${source}`
    : `For a walk in ${placePeriod}, conditions ${unsuitable ? 'call for extra care' : 'look suitable'}: ${minC ?? '?'}–${maxC ?? '?'}°C, ${rain ?? '?'} mm precipitation, and wind up to ${wind ?? '?'} km/h. ${source}`
}

function dailyForecastAnswer(summary, day, lang, scope) {
  const formattedDate = lang === 'bg'
    ? new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day.date}T00:00:00Z`))
    : day.date
  const practical = (number(day.rainChancePct) ?? 0) >= 35 || (number(day.rainMm) ?? 0) > 0.1 ? 'Предвиди защита от дъжд.' : (number(day.maxWindKmh) ?? 0) >= 30 ? 'Предвиди защита от силен вятър.' : 'Условията изглеждат подходящи за обичайни дейности.'
  const condition = ({ 0: 'ясно', 1: 'предимно ясно', 2: 'частично облачно', 3: 'облачно', 45: 'мъгливо', 48: 'мъгливо', 61: 'слаб дъжд', 63: 'дъжд', 65: 'силен дъжд', 71: 'слаб сняг', 73: 'сняг', 75: 'силен сняг', 95: 'гръмотевична буря' })[day.code] ?? 'променливи условия'
  const relativeLabel = lang === 'bg' ? ({ day_after_tomorrow: ' (вдругиден)', yesterday: ' (вчера)', day_before_yesterday: ' (завчера)' }[scope] ?? '') : ''
  return lang === 'bg' ? `Прогнозата за ${summary.location} на ${formattedDate}${relativeLabel} е: ${condition}, с минимална температура ${day.minC ?? '?'}°C и максимална ${day.maxC ?? '?'}°C. Вероятност за валеж: ${day.rainChancePct ?? '?'}%, количество: ${day.rainMm ?? '?'} мм; вятър до ${day.maxWindKmh ?? '?'} км/ч. ${practical}` : `The forecast for ${summary.location} on ${formattedDate} is ${day.minC ?? '?'}°C to ${day.maxC ?? '?'}°C, precipitation ${day.rainChancePct ?? '?'}% (${day.rainMm ?? '?'} mm), and wind up to ${day.maxWindKmh ?? '?'} km/h.`
}
