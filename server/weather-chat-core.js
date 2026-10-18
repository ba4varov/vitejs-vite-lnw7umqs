export const ALLOWED_INTENTS = [
  'current', 'later', 'rain', 'thunderstorm', 'clothing', 'walk', 'laundry', 'car_wash',
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
  if (value.targetDate !== null && (typeof value.targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.targetDate) || !Number.isFinite(Date.parse(`${value.targetDate}T00:00:00Z`)) || new Date(`${value.targetDate}T00:00:00Z`).toISOString().slice(0, 10) !== value.targetDate)) return null
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
  if (Object.keys(body).some(key => !['message', 'city', 'latitude', 'longitude', 'lang', 'quickAction', 'context', 'pendingClarification'].includes(key))) return null
  if (Object.keys(body).length < 5 || Object.keys(body).length > 8) return null
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 400) return null
  if (typeof body.city !== 'string' || !body.city.trim() || body.city.length > 100) return null
  if (typeof body.latitude !== 'number' || !Number.isFinite(body.latitude) || body.latitude < -90 || body.latitude > 90) return null
  if (typeof body.longitude !== 'number' || !Number.isFinite(body.longitude) || body.longitude < -180 || body.longitude > 180) return null
  if (body.lang !== 'bg' && body.lang !== 'en') return null
  if (body.quickAction !== undefined && !QUICK_ACTIONS.includes(body.quickAction)) return null
  if (body.pendingClarification !== undefined && !validatePendingClarification(body.pendingClarification)) return null
  if (body.context !== undefined && !validateConversationContext(body.context)) return null
  return { ...(body.pendingClarification ? { pendingClarification: body.pendingClarification } : {}), ...(body.context ? { context: body.context } : {}), message: body.message.trim(), city: body.city.trim(), latitude: body.latitude, longitude: body.longitude, lang: body.lang, ...(body.quickAction ? { quickAction: body.quickAction } : {}) }
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

// Bare weekdays mean the nearest occurrence, including today in the selected city.
const WEEKDAYS = new Map([
  ...'неделя понеделник вторник сряда четвъртък петък събота'.split(' ').map((name, day) => [name, day]),
  ...'sunday monday tuesday wednesday thursday friday saturday'.split(' ').map((name, day) => [name, day])
])
const WEEKDAY_NAMES = [...WEEKDAYS.keys()].join('|')
const NEXT_WEEKDAY = 'следващия|следващият|следващата|идния|идният|идната|next'
const THIS_WEEKDAY = 'този|тази|текущия|текущият|текущата|настоящия|настоящият|настоящата|this'
const WEEKDAY_MODIFIER = `(?:${NEXT_WEEKDAY}|${THIS_WEEKDAY})`
const weekdayOnly = value => new RegExp(`^(?:${WEEKDAY_MODIFIER}\\s+)?(?:${WEEKDAY_NAMES})$`, 'u').test(normalizeQuestion(value))

export function extractRequestedDate(message, now = new Date(), timezone = 'UTC', _lang = 'bg') {
  const text = normalizeQuestion(message)
  const calendarIso = text.match(/\b20\d{2}-\d{2}-\d{2}\b/u)?.[0]
  if (calendarIso) return Number.isFinite(Date.parse(calendarIso)) && new Date(calendarIso).toISOString().slice(0, 10) === calendarIso ? calendarIso : null
  const englishRelative = text.match(/(?:^|\s)in\s+(\d{1,2})\s+days?(?=\s|$)/u)
  if (englishRelative) {
    const date = new Date(`${localIsoDate(now, timezone)}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() + Number(englishRelative[1]))
    return date.toISOString().slice(0, 10)
  }
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
      if (!match) {
        const city = extractRequestedCity(message)
        const dateText = city ? text.replace(normalizeQuestion(city), '') : text
        const weekday = dateText.match(new RegExp(`(?:^|\\s)(?:(${WEEKDAY_MODIFIER})\\s+)?(${WEEKDAY_NAMES})(?=\\s|$)`, 'u'))
        if (!weekday) return null
        const date = new Date(`${localIsoDate(now, timezone)}T12:00:00Z`)
        const targetDay = (WEEKDAYS.get(weekday[2]) + 6) % 7
        const localDay = (date.getUTCDay() + 6) % 7
        // Calendar weeks start on Monday. Bare names retain nearest-occurrence semantics.
        const offset = !weekday[1] ? (targetDay - localDay + 7) % 7
          : targetDay - localDay + (new RegExp(`^(?:${NEXT_WEEKDAY})$`, 'u').test(weekday[1]) ? 7 : 0)
        date.setUTCDate(date.getUTCDate() + offset)
        return date.toISOString().slice(0, 10)
      }
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
  // Remove a weekday phrase before another location preposition, so the first
  // Bulgarian "в" cannot swallow both the date and the actual city as one name.
  const cleaned = normalizeBulgarianTimeExpressions(message).replace(/[?!]+$/u, '').trim()
    .replace(new RegExp(String.raw`(?:^|\s)(?:във|в|на|on|for)\s+(?:${WEEKDAY_MODIFIER}\s+)?(?:${WEEKDAY_NAMES})(?=\s+(?:във|в|in|at|near)\s)`, 'giu'), ' ')
  const weekdayBoundary = String.raw`\s+(?:във|в|на|on|for)\s+(?:${WEEKDAY_MODIFIER}\s+)?(?:${WEEKDAY_NAMES})(?:\s|$)`
  const qualifiedWeekdayBoundary = String.raw`\s+${WEEKDAY_MODIFIER}\s+(?:${WEEKDAY_NAMES})(?:\s|$)`
  const stop = String.raw`(?=${weekdayBoundary}|${qualifiedWeekdayBoundary}|[,;.!?]|\s+(?:на|за|on|for)\s+\d|\s+(?:днес|утре|вдругиден|вчера|завчера|сега|в момента|тази|този|следващия|сутрин|следобед|вечер|нощ|довечера|през|след|за колко|today|tomorrow|yesterday|this|next|when|while|morning|afternoon|evening|night|during|over)(?:\s|$)|$)`
  // "за" denotes a place only when attached to an explicit weather construction.
  const patterns = [
    new RegExp(String.raw`(?:^|\s)(?:във|в)\s+([\p{L}][\p{L}'’.,-]*(?:\s+[\p{L}][\p{L}'’.,-]*){0,4}?)${stop}`, 'giu'),
    new RegExp(String.raw`(?:времето|прогнозата|прогноза)\s+за\s+([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,4}?)${stop}`, 'giu'),
    new RegExp(String.raw`(?:^|\s)(?:in|at|near)\s+([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,4}?)${stop}`, 'giu'),
    new RegExp(String.raw`(?:weather|forecast)\s+(?:for|in)\s+([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,4}?)${stop}`, 'giu')
  ]
  const candidates = patterns.flatMap(pattern => [...cleaned.matchAll(pattern)].map(match => match[1]
    .replace(/,\s*(?:докато|когато|а|но|when|while)(?=\s|$).*$/iu, '')
    .replace(/\s+(?:какво|каква|какъв|ще|е|бъде|времето|прогнозата).*$/iu, '').trim())).filter(candidate => !weekdayOnly(candidate))
  if (candidates.length) {
    const candidate = candidates.at(-1)
    if (!candidate.split(/\s+/u).every(word => PROTECTED_LOCATION.has(normalizeQuestion(word).replace(/[.,]/g, '')))) return candidate
  }
  // Common free word order: a proper-name phrase immediately before the time word.
  const followup = cleaned.match(/^(?:а|and|what about)\s+([\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*){0,3})$/u)?.[1]
  if (followup && !weekdayOnly(followup) && !followup.split(/\s/u).some(word => PROTECTED_LOCATION.has(normalizeQuestion(word))) && !/^(?:tomorrow|today|wind|rain|temperature|yesterday)$/iu.test(followup)) return followup
  if (/^(?:за|а|and|for|on)\s/iu.test(cleaned)) return null
  const bare = cleaned.match(/(?:^|\s)([\p{Lu}][\p{L}'’.-]*(?:[ ,]+[\p{Lu}][\p{L}'’.-]*){0,3})\s+(?:днес|утре|вдругиден)(?=\s|$)/u)?.[1]
  return bare && !weekdayOnly(bare) && !PROTECTED_LOCATION.has(normalizeQuestion(bare)) ? bare.trim() : null
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
  if (!intent && /(?:гръмотев|гръм|гърм|мълни|светкавиц|\bthunder(?:(?:storm|shower)s?|ing|s)?\b|\blightning\b)/iu.test(text)) intent = 'thunderstorm'
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
  const unresolvedFuture = /(?:^|\s)(?:next\s+week|in\s+(?:a few|some)\s+days|sometime|след\s+(?:\d+|един|едно|три|четири|пет)\s+дни?|в\s*друг(?:ия|и)\s+ден|(?:следващата|идната)\s+седмица|за\s+уикенда)(?=\s|$)/u.test(text) && !requestedScope && !requestedDate
  const conflictingDays = /(?:утре\s+или\s+вдругиден|tomorrow\s+or\s+(?:the\s+)?day after tomorrow)/iu.test(text)
  const explicitIso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ?? null
  const validIso = explicitIso && Number.isFinite(Date.parse(explicitIso)) && new Date(explicitIso).toISOString().slice(0, 10) === explicitIso
  const invalidDate = /\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b|\b20\d{2}-\d{2}-\d{2}\b/u.test(text) && !requestedDate && !validIso
  if (unresolvedFuture || conflictingDays || invalidDate) return { intent, requestedCity, timeScope: 'general', targetDate: null, needsClarification: true, clarificationQuestion: lang === 'bg' ? 'За кой точно ден питаш?' : 'Which exact day do you mean?', isQuick: false }
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

// WMO interpretation, never precipitation probability or a lightning-strike forecast.
const THUNDER_CODES = new Set([95, 96, 99])
const WMO_CODES = new Set([0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99])

function thunderstormAnswer(summary, understood, lang) {
  const scope = understood.timeScope
  if (scope === 'this_weekend' || scope === 'next_weekend') {
    const dates = summary.requestedDates ?? []
    if (dates.length) return dates.map(date => thunderstormAnswer({ ...summary, targetDay: findDailyForecast(summary.targetDays, date) }, { ...understood, timeScope: 'specific_date', targetDate: date }, lang)).join('\n')
    return lang === 'bg' ? `Нямам достатъчно данни за гръмотевични бури за ${summary.location} за избрания уикенд.` : `I don't have enough thunderstorm data for ${summary.location} for the selected weekend.`
  }
  const date = understood.targetDate
  const dayScope = ['today', 'tomorrow', 'day_after_tomorrow', 'yesterday', 'day_before_yesterday', 'specific_date'].includes(scope)
  const period = dayScope && date ? date : scope === 'general' ? periodLabel('next_12h', lang) : periodLabel(scope, lang)
  let codes = [], complete = false
  const hours = summary.nextHours ?? []
  if (scope === 'now') {
    codes = [summary.current?.weather_code]
    complete = WMO_CODES.has(codes[0])
  } else if (dayScope && date) {
    // Daily WMO is the day's most severe condition. Hourly evidence may also
    // reveal a storm even if the daily summary is missing or disagrees.
    const dailyCode = summary.targetDay?.date === date ? summary.targetDay.code : null
    const dayHours = hours.filter(hour => hour.time.slice(0, 10) === date)
    codes = [dailyCode, ...dayHours.map(hour => hour.code)]
    const byTime = new Map(dayHours.map(hour => [hour.time.slice(0, 13), hour.code]))
    complete = WMO_CODES.has(dailyCode) || Array.from({ length: 24 }, (_, i) => `${date}T${String(i).padStart(2, '0')}`).every(time => WMO_CODES.has(byTime.get(time)))
  } else {
    const effectiveScope = scope === 'general' ? 'next_12h' : scope
    const selected = selectedHours(summary, effectiveScope)
    codes = selected.map(hour => hour.code)
    // Generate the expected window independently of the supplied rows. Gaps,
    // duplicate timestamps and null/unknown codes cannot justify a negative.
    const start = summary.current?.time?.slice(0, 13)
    if (start && Number.isFinite(Date.parse(`${start}:00:00Z`))) {
      const base = Date.parse(`${start}:00:00Z`)
      const expectedHours = Array.from({ length: 72 }, (_, i) => ({ time: new Date(base + i * 3600000).toISOString().slice(0, 16) }))
      const expected = selectedHours({ ...summary, nextHours: expectedHours }, effectiveScope)
      const byTime = new Map(selected.map(hour => [hour.time.slice(0, 13), hour.code]))
      complete = expected.length > 0 && expected.every(hour => WMO_CODES.has(byTime.get(hour.time.slice(0, 13))))
    }
  }
  const placePeriod = `${summary.location} (${period})`
  if (codes.some(code => THUNDER_CODES.has(code))) return lang === 'bg'
    ? `За ${placePeriod} ${summary.historical ? 'архивните данни' : 'прогнозните данни'} от Open-Meteo показват гръмотевична буря. Това не определя точни места или моменти на попадения на мълнии.`
    : `For ${placePeriod}, Open-Meteo ${summary.historical ? 'historical data indicate' : 'forecast data indicate'} a thunderstorm. This does not predict exact lightning-strike locations or times.`
  if (!complete) return lang === 'bg'
    ? `Нямам достатъчно данни за гръмотевични бури за ${placePeriod}. Не мога надеждно да преценя дали ще гърми.`
    : `I don't have enough thunderstorm data for ${placePeriod}. I cannot reliably tell whether there will be thunder.`
  return lang === 'bg'
    ? `Наличните ${summary.historical ? 'архивни' : 'прогнозни'} данни от Open-Meteo за ${placePeriod} не показват гръмотевични бури. Това не е гаранция за липса на гръмотевици.`
    : `Available Open-Meteo ${summary.historical ? 'historical' : 'forecast'} data for ${placePeriod} do not indicate thunderstorms. This is not a guarantee of no thunder.`
}

export function deterministicWeatherAnswer(summary, understood, lang = 'bg') {
  if (understood.intent === 'thunderstorm') return thunderstormAnswer(summary, understood, lang)
  if (understood.timeScope === 'this_weekend' || understood.timeScope === 'next_weekend') {
    return weekendForecastAnswer(summary, understood, lang)
  }
  const period = periodLabel(understood.timeScope, lang)
  const day = PERIOD_HOURS[understood.timeScope.replace(/^tomorrow_/, '')] ? null : ['day_before_yesterday', 'yesterday', 'today', 'tomorrow', 'day_after_tomorrow'].includes(understood.timeScope) ? summary.targetDay : understood.targetDate ? summary.targetDay : null
  const hours = selectedHours(summary, understood.timeScope)
  const missing = () => lang === 'bg' ? `Нямам достатъчно данни за ${summary.location} за избрания показател и период.` : `I don't have enough data for ${summary.location} for the selected measure and period.`
  if (understood.targetDate && !day && !PERIOD_HOURS[understood.timeScope.replace(/^tomorrow_/, '')]) return missing()
  if (!['general', 'now'].includes(understood.timeScope) && ['air_quality', 'marine'].includes(understood.intent)) return missing()
  if (day && understood.intent === 'uv') return number(day.maxUv) === null ? missing() : (lang === 'bg' ? `UV индексът за ${summary.location} на ${day.date} е до ${day.maxUv}.` : `UV index for ${summary.location} on ${day.date} reaches ${day.maxUv}.`)
  const fields = day ? { temperature: [day.minC, day.maxC], wind: [day.maxWindKmh], rain: [day.rainMm, day.rainChancePct] } : {
    temperature: [summary.current?.temperature_2m, ...hours.map(h => h.tempC)], wind: hours.length ? hours.map(h => h.windKmh) : [summary.current?.wind_speed_10m],
    rain: hours.flatMap(h => [h.rainMm, h.rainChancePct]), uv: hours.length ? hours.map(h => h.uv) : [summary.current?.uv_index] }
  if (fields[understood.intent]?.every(v => number(v) === null)) return missing()
  if (['clothing', 'walk', 'laundry', 'car_wash', 'outdoor_activity', 'general_weather', 'current', 'later', 'other_city'].includes(understood.intent) &&
      ['temperature', 'wind', 'rain'].some(key => !fields[key]?.some(v => number(v) !== null))) return missing()

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
  const rainMm = hours.length ? (values('rainMm').length ? values('rainMm').reduce((sum, value) => sum + value, 0) : null) : number(day?.rainMm)
  const codes = hours.map(hour => number(hour.code)).filter(code => code !== null)
  const wetCode = codes.some(code => (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95)
  const dangerous = codes.some(code => code >= 95 || code === 66 || code === 67)
  const temp = hourlyPeriod ? min('tempC') : number(summary.current?.temperature_2m) ?? min('tempC', number(day?.minC))
  const feels = hourlyPeriod ? min('feelsC') : number(summary.current?.apparent_temperature) ?? min('feelsC')
  const wind = max('windKmh', hourlyPeriod ? null : number(day?.maxWindKmh) ?? number(summary.current?.wind_speed_10m))
  const uv = max('uv', hourlyPeriod ? null : number(day?.maxUv) ?? number(summary.current?.uv_index))

  // A calendar date always wins over activity/current-condition intents.
  if (day && ['rain', 'clothing', 'walk', 'temperature', 'wind'].includes(understood.intent)) return dailyIntentAnswer(summary, day, understood, lang)
  if (day && ['specific_date', 'day_before_yesterday', 'yesterday', 'today', 'tomorrow', 'day_after_tomorrow'].includes(understood.timeScope)) return dailyForecastAnswer(summary, day, lang, understood.timeScope)
  if (hours.length && understood.intent === 'general_weather' && ['next_12h', 'next_24h', 'morning', 'afternoon', 'evening', 'night', 'tomorrow_morning', 'tomorrow_afternoon', 'tomorrow_evening', 'tomorrow_night'].includes(understood.timeScope)) {
    const temperatures = values('tempC'); const apparent = values('feelsC')
    const practical = (rainChance ?? 0) >= 35 || rainMm > 0.1 ? 'Предвиди защита от дъжд.' : (wind ?? 0) >= 30 ? 'Предвиди защита от вятър.' : 'Условията изглеждат подходящи за обичайни дейности.'
    return lang === 'bg'
      ? `Прогнозата за ${summary.location} ${period} е ${Math.min(...temperatures)}–${Math.max(...temperatures)}°C${apparent.length ? `, усеща се като ${Math.min(...apparent)}–${Math.max(...apparent)}°C` : ''}. Валежи: до ${rainChance ?? '?'}% и около ${(rainMm === null ? '?' : rainMm.toFixed(1))} мм; вятър до ${wind ?? '?'} км/ч. ${practical}`
      : `The forecast for ${summary.location} ${period} is ${Math.min(...temperatures)}–${Math.max(...temperatures)}°C, precipitation up to ${rainChance ?? '?'}% (${(rainMm === null ? '?' : rainMm.toFixed(1))} mm), and wind up to ${wind ?? '?'} km/h.`
  }

  if (understood.intent === 'rain') {
    const needed = wetCode || rainMm > 0.1 || (rainChance ?? 0) >= 35
    const complete = hours.length > 0 && hours.every(hour => number(hour.rainMm) !== null && number(hour.rainChancePct) !== null)
    if (!needed && !complete) return lang === 'bg'
      ? `Данните за валежите ${period} са непълни. Не мога надеждно да преценя дали ще ти трябва чадър; вземи го за всеки случай.`
      : `Precipitation data ${period} are incomplete. I cannot reliably tell whether you will need an umbrella; take one just in case.`
    if (lang === 'en') return `${needed ? 'Yes, take an umbrella' : 'No umbrella is needed'} ${period}: precipitation probability is up to ${rainChance ?? '?'}% and about ${(rainMm === null ? '?' : rainMm.toFixed(1))} mm is expected.`
    return `${needed ? 'Да, вземи чадър' : 'Не, не е нужен чадър'} ${period}: вероятността за валеж е до ${rainChance ?? '?'}%, очакват се около ${(rainMm === null ? '?' : rainMm.toFixed(1))} мм.`
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
    return lang === 'en' ? `${bad ? 'No' : conditional ? 'Yes, with precautions' : 'Yes'}, a walk is suitable ${period}. Rain chance is ${rainChance ?? '?'}%, wind up to ${wind ?? '?'} km/h, temperature about ${temp ?? '?'}°C and UV up to ${uv ?? '?'}${dangerous ? '; dangerous weather is possible' : ''}.` : `${verdict} ${period}. Валежи: до ${rainChance ?? '?'}%, вятър: до ${wind ?? '?'} км/ч, температура: около ${temp ?? '?'}°C, UV: до ${uv ?? '?'}${dangerous ? '; възможно е опасно време' : ''}.`
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
    return lang === 'bg' ? `${wet ? 'По-добре изчакай' : 'Условията изглеждат подходящи'} за ${understood.intent === 'laundry' ? 'простиране' : 'миене на колата'} ${period}. Валежи: до ${rainChance ?? '?'}% и около ${(rainMm === null ? '?' : rainMm.toFixed(1))} мм.` : `${wet ? 'Better wait' : 'Conditions look suitable'} ${period}. Rain chance up to ${rainChance ?? '?'}%, about ${(rainMm === null ? '?' : rainMm.toFixed(1))} mm.`
  }
  if (day) return dailyForecastAnswer(summary, day, lang, understood.timeScope)
  return lang === 'bg' ? `В момента в ${summary.location} е ${temp ?? '?'}°C, усеща се като ${feels ?? '?'}°C, с вятър ${wind ?? '?'} км/ч и вероятност за валеж до ${rainChance ?? '?'}%.` : `It is ${temp ?? '?'}°C in ${summary.location}, feels like ${feels ?? '?'}°C, with wind at ${wind ?? '?'} km/h and precipitation probability up to ${rainChance ?? '?'}%.`
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
  if (['clothing', 'walk'].includes(understood.intent) && [day.minC, day.maxC, day.maxWindKmh, day.rainMm].some(v => number(v) === null)) return lang === 'bg' ? `Нямам достатъчно данни за ${summary.location} на ${day.date}.` : `I don't have enough data for ${summary.location} on ${day.date}.`
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
  if ([day.minC, day.maxC, day.rainMm, day.maxWindKmh].every(v => number(v) === null)) return lang === 'bg' ? `Нямам достатъчно данни за ${summary.location} на ${day.date}.` : `I don't have enough data for ${summary.location} on ${day.date}.`
  const practical = (number(day.rainChancePct) ?? 0) >= 35 || (number(day.rainMm) ?? 0) > 0.1 ? 'Предвиди защита от дъжд.' : (number(day.maxWindKmh) ?? 0) >= 30 ? 'Предвиди защита от силен вятър.' : [day.rainMm, day.maxWindKmh].every(v => number(v) !== null) ? 'Условията изглеждат подходящи за обичайни дейности.' : ''
  const condition = ({ 0: 'ясно', 1: 'предимно ясно', 2: 'частично облачно', 3: 'облачно', 45: 'мъгливо', 48: 'мъгливо', 61: 'слаб дъжд', 63: 'дъжд', 65: 'силен дъжд', 71: 'слаб сняг', 73: 'сняг', 75: 'силен сняг', 95: 'гръмотевична буря' })[day.code] ?? 'променливи условия'
  const relativeLabel = lang === 'bg' ? ({ day_after_tomorrow: ' (вдругиден)', yesterday: ' (вчера)', day_before_yesterday: ' (завчера)' }[scope] ?? '') : ''
  return lang === 'bg' ? `Прогнозата за ${summary.location} на ${formattedDate}${relativeLabel} е: ${condition}, с минимална температура ${day.minC ?? '?'}°C и максимална ${day.maxC ?? '?'}°C. Вероятност за валеж: ${day.rainChancePct ?? '?'}%, количество: ${day.rainMm ?? '?'} мм; вятър до ${day.maxWindKmh ?? '?'} км/ч. ${practical}` : `The forecast for ${summary.location} on ${formattedDate} is ${day.minC ?? '?'}°C to ${day.maxC ?? '?'}°C, precipitation ${day.rainChancePct ?? '?'}% (${day.rainMm ?? '?'} mm), and wind up to ${day.maxWindKmh ?? '?'} km/h.`
}

// A bounded, data-only conversation snapshot. Never accepted as weather evidence.
export function validateConversationContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (Object.keys(value).some(key => !['city', 'latitude', 'longitude', 'intent', 'timeScope', 'targetDate', 'previousQuestion'].includes(key))) return false
  return Boolean(validateChatInput({ message: value.previousQuestion, city: value.city, latitude: value.latitude, longitude: value.longitude, lang: 'en' }) &&
    ALLOWED_INTENTS.includes(value.intent) && !['unrelated', 'unclear'].includes(value.intent) &&
    ALLOWED_TIME_SCOPES.includes(value.timeScope) &&
    (value.targetDate === null || (typeof value.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.targetDate) && Number.isFinite(Date.parse(value.targetDate)))))
}

export function parseConversationQuestion(message, lang = 'bg', options = {}) {
  const context = options.context
  const text = normalizeQuestion(message)
  const date = extractRequestedDate(message, options.now, options.timezone, lang)
  const scope = extractTimeScope(message)
  const city = extractRequestedCity(message, lang)
  let parsed = parseDeterministicQuestion(message, lang, options)
  const fragment = /^(?:а\s+|and\s+|what about\s+)?(?:утре|днес|вдругиден|вчера|(?:the\s+)?day\s+(?:after|before)\s+(?:tomorrow|yesterday)|tomorrow|today|yesterday|tonight)(?:\s.*)?$/iu.test(text)
  if (parsed?.intent === 'unrelated' && (scope || date) && fragment) parsed = { ...parsed, intent: context?.intent ?? 'general_weather', timeScope: scope ?? 'specific_date', targetDate: date }
  if (!context || options.quickAction || !parsed || parsed.needsClarification || ['unrelated', 'unclear'].includes(parsed.intent)) return parsed
  const entityOnly = parsed.intent === 'general_weather' && (city || date || scope) && !/(време|прогноз|weather|forecast)/iu.test(text)
  return { ...parsed, intent: entityOnly ? context.intent : parsed.intent,
    timeScope: date || scope || parsed.targetDate ? parsed.timeScope : context.timeScope,
    targetDate: date || scope || parsed.targetDate ? parsed.targetDate : context.targetDate }
}

// No measurements, executable instructions or unbounded conversation history.
export function validatePendingClarification(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (Object.keys(value).some(key => !['understanding', 'context', 'message', 'missing', 'attempts', 'locationMode'].includes(key))) return false
  try {
    return Boolean(['intent', 'date', 'location'].includes(value.missing) &&
      (value.locationMode === undefined || ['qualifier', 'name'].includes(value.locationMode)) &&
      Number.isInteger(value.attempts) && value.attempts >= 1 && value.attempts <= 3 &&
      typeof value.message === 'string' && value.message.trim().length > 0 && value.message.length <= 400 &&
      parseUnderstanding(value.understanding, 'en') &&
      (value.context === undefined || validateConversationContext(value.context)))
  } catch { return false }
}

export function clarificationTurn(message, lang = 'bg', options = {}) {
  const pending = options.quickAction ? undefined : options.pendingClarification
  const raw = parseDeterministicQuestion(message, lang, options)
  const text = normalizeQuestion(message)
  const city = extractRequestedCity(message, lang)
  const scope = extractTimeScope(message)
  const date = extractRequestedDate(message, options.now, options.timezone, lang)
  // Only short answers complete a slot. A full question or explicit cancellation starts anew.
  const newExplicitQuestion = city && raw && !['general_weather', 'unrelated', 'unclear'].includes(raw.intent)
  const ai = parseUnderstanding(options.aiUnderstanding, lang)
  const cityOnly = city && raw?.intent === 'general_weather' && !/(време|прогноз|weather|forecast)/iu.test(text)
  const aiWeatherIntent = ai && !ai.needsClarification && !cityOnly && !['unrelated', 'unclear', 'other_city'].includes(ai.intent)
  const pendingCandidate = pending?.missing === 'intent' && raw?.intent === 'unrelated' && !city && !/(?:cancel|отказ|забрави|напиши|write|ignore)/iu.test(text)
  const aiFollowUp = pendingCandidate && aiWeatherIntent
  const fragment = !newExplicitQuestion && text.split(/\s+/u).length <= 8 && !/(?:какъв|каква|какво|какви|колко|дали|what |how |write|напиши|разкажи|tell |cancel|отказ|забрави)/iu.test(text)
  const continuation = pending && (fragment || aiFollowUp)
  let understanding, sourceMessage = message, context = options.context, missing
  if (continuation) {
    understanding = { ...pending.understanding, needsClarification: false, clarificationQuestion: null }
    context = pending.context
    sourceMessage = pending.message
    if (aiWeatherIntent && pending.missing === 'intent') understanding.intent = ai.intent
    else if (raw && !['unrelated', 'unclear', 'general_weather'].includes(raw.intent)) understanding.intent = raw.intent
    else if (/(общ|прогноз|general|forecast|weather)/iu.test(text)) understanding.intent = 'general_weather'
    if (scope || date) {
      understanding.timeScope = date ? 'specific_date' : scope
      understanding.targetDate = date
      sourceMessage = message // Keep yearless dates available for destination-timezone resolution.
    }
    if (city) understanding.requestedCity = city
    if (pending.missing === 'location' && !aiWeatherIntent && !city && !scope && !date && raw?.intent === 'unrelated' && message.length <= 100 && !/(не знам|не съм сигур|not sure|do not know|don't know)/iu.test(text)) {
      understanding.requestedCity = pending.locationMode === 'name' ? message.trim() : `${understanding.requestedCity?.split(',')[0] ?? ''}, ${message.trim()}`.replace(/^, /, '').slice(0, 100)
    }
    const explicitMeasure = raw && !['unrelated', 'unclear', 'general_weather'].includes(raw.intent)
    const generalForecast = /общ|general|forecast|прогноз|weather/iu.test(text)
    const previousMeasure = context && /същ|предиш|same|previous/iu.test(text)
    if (previousMeasure) understanding.intent = context.intent
    const resolved = pending.missing === 'intent' ? Boolean(aiWeatherIntent || explicitMeasure || generalForecast || previousMeasure)
      : pending.missing === 'date' ? Boolean(scope || date) : understanding.requestedCity !== pending.understanding.requestedCity
    if (!resolved) missing = pending.missing
    if (raw?.needsClarification && raw.intent !== 'unclear') {
      missing = 'date'
      understanding = { ...understanding, timeScope: 'general', targetDate: null }
      sourceMessage = message
    }
  } else {
    // A standalone question abandons pending slots, including their old context.
    if (pending) context = undefined
    understanding = parseConversationQuestion(message, lang, { ...options, context })
    if (cityOnly) missing = 'intent'
    else if (understanding?.needsClarification) {
      missing = 'date'
      if (understanding.intent === 'unclear') understanding = { ...understanding, intent: 'general_weather' }
    }
  }
  if (!understanding) return { understanding: null, message, context }
  if (missing) {
    const place = understanding.requestedCity || context?.city || options.city || ''
    const labels = lang === 'bg' ? { thunderstorm: 'гръмотевичните бури', wind: 'вятъра', rain: 'валежите', temperature: 'температурата', uv: 'UV индекса', air_quality: 'въздуха', marine: 'морето', clothing: 'облеклото', walk: 'разходка', laundry: 'пране', car_wash: 'миене на колата', outdoor_activity: 'дейности навън', current: 'текущото време', later: 'времето по-късно' } : { thunderstorm: 'thunderstorms', wind: 'wind', rain: 'rain', temperature: 'temperature', uv: 'UV index', air_quality: 'air quality', marine: 'sea', clothing: 'clothing', walk: 'walking', laundry: 'laundry', car_wash: 'washing the car', outdoor_activity: 'outdoor activities', current: 'current weather', later: 'weather later' }
    const measure = labels[context?.intent]
    const question = missing === 'date' ? (lang === 'bg' ? `За кой точно ден${place ? ` в ${place}` : ''} питаш?` : `Which exact day${place ? ` in ${place}` : ''} do you mean?`)
      : missing === 'location' ? (lang === 'bg' ? 'Кое населено място имаш предвид? Посочи област или държава.' : 'Which location do you mean? Please specify a region or country.')
      : lang === 'bg' ? `Какво Ви интересува за ${place}?`
      : measure ? `For ${place}, do you mean ${measure} or the general forecast?` : `What weather information would you like for ${place}?`
    const attempts = continuation ? pending.attempts + 1 : 1
    const { isQuick: _isQuick, ...snapshot } = understanding
    const next = { understanding: { ...snapshot, needsClarification: false, clarificationQuestion: null }, message: sourceMessage, missing, attempts, ...(pending?.locationMode && missing === 'location' ? { locationMode: pending.locationMode } : {}), ...(context ? { context } : {}) }
    return { understanding, message: sourceMessage, context, answer: attempts > 3 ? (lang === 'bg' ? `За да продължа, е нужно уточнение: ${question}` : `To continue, I need this information: ${question}`) : question, pendingClarification: attempts <= 3 ? next : null }
  }
  return { understanding, message: sourceMessage, context, continuation: Boolean(continuation), pendingCandidate: Boolean(pendingCandidate), pendingClarification: null }
}
