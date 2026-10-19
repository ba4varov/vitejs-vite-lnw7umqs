type ApiRequest = { method?: string; body?: unknown }
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: Record<string, unknown>) => void }

import { localRoute } from '../server/weather-local-routing.js'
import { randomUUID } from 'node:crypto'
import type { ValidChatInput, Understanding, RelativeTimeScope, WeatherSummary, ForecastHourly, WeatherCurrent, PendingClarification } from '../server/weather-chat-core.js'
import { deterministicWeatherAnswer, extractRequestedDate, findDailyForecast, localIsoDate, clarificationTurn, parseUnderstanding, relativeForecastDate, unrelatedWeatherAnswer, validateChatInput, weekendForecastDates, zipForecastHours } from '../server/weather-chat-core.js'
import { geminiClient } from '../server/gemini-client.js'
import { semanticSchema, semanticSystem, parseSemanticUnderstanding, resolveSemanticTurn } from '../server/weather-chat-semantics.js'
import { collectLocationCandidates, groundLocation } from '../server/weather-location-evidence.js'
import type { SemanticUnderstanding } from '../server/weather-chat-semantics.js'

type ChatInput = ValidChatInput
// Upstream response shapes describe the fields consumed here, including archive omissions.
type WeatherPayload = {
  timezone?: string; current?: WeatherCurrent; hourly?: ForecastHourly;
  daily?: { time?: string[]; weather_code?: number[]; temperature_2m_min?: number[];
    temperature_2m_max?: number[]; precipitation_sum?: number[];
    precipitation_probability_max?: number[]; wind_speed_10m_max?: number[]; uv_index_max?: number[] }
}
type GeocodingPlace = {
  name: string; latitude: number; longitude: number; timezone?: string;
  country?: string; country_code?: string; admin1?: string; admin2?: string;
  feature_code?: string; feature_class?: string; population?: number
}
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
const requestIsEnglish = (body: unknown) => record(body)?.lang === 'en'
const isRelativeScope = (scope: string): scope is RelativeTimeScope =>
  scope === 'day_before_yesterday' || scope === 'yesterday' || scope === 'today' || scope === 'tomorrow' || scope === 'day_after_tomorrow'

const addIsoDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeout = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try { return await fetch(url, { ...init, signal: controller.signal }) } finally { clearTimeout(timer) }
}

// Diagnostics contain only allowlisted enums, booleans and counts.
function extractGeminiJson(payload: unknown, requestId?: string): unknown {
  const root = record(payload)
  const candidates = root?.candidates
  const candidate = Array.isArray(candidates) ? record(candidates[0]) : null
  const parts = record(candidate?.content)?.parts
  const allParts = Array.isArray(parts) ? parts : []
  const textParts = allParts.filter(part => typeof record(part)?.text === 'string' && record(part)?.thought !== true)
  const text = textParts.map(part => record(part)!.text as string).join('').trim()
  const finish = candidate?.finishReason
  const knownReasons = ['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL', 'FINISH_REASON_UNSPECIFIED']
  const finishReason = typeof finish !== 'string' ? 'missing' : knownReasons.includes(finish) ? finish : 'unknown'
  const usage = record(root?.usageMetadata)
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
  let result: unknown = null
  let extractionReason = 'ok'
  if (!candidate) extractionReason = 'missing_candidate'
  else if (finish !== 'STOP') extractionReason = 'incomplete_or_blocked'
  else if (!text) extractionReason = 'missing_text'
  else {
    // Parse the entire final text, never a substring or an individual fragment.
    const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/)
    try { result = JSON.parse(fenced ? fenced[1] : text) } catch { extractionReason = 'malformed_json' }
  }
  console.info('[weather-chat:gemini-response]', {
    requestId, finishReason, candidateCount: Array.isArray(candidates) ? candidates.length : 0,
    partCount: allParts.length, textPartCount: textParts.length, hasText: Boolean(text),
    outputTokens: count(usage?.candidatesTokenCount), thoughtTokens: count(usage?.thoughtsTokenCount),
    extractionReason
  })
  return result
}

class ServiceError extends Error {
  constructor(public stage: string, public code: string, public httpStatus?: number, public model?: string) { super(code) }
}

function logFailure(error: ServiceError) {
  console.error('[weather-chat]', { stage: error.stage, status: error.httpStatus ?? null, code: error.code })
}

async function callGemini(system: string, user: string, maxOutputTokens: number, stage: string, responseSchema?: Record<string, unknown>, requestId?: string) {
  const { payload, model } = await geminiClient.generate({ endpoint: 'weather-chat', stage, requestId, body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens, responseMimeType: 'application/json', ...(responseSchema ? { responseSchema } : {}) }
  } })
  const parsed = extractGeminiJson(payload, requestId)
  if (!parsed) throw new ServiceError(stage, 'invalid-json', 200, model)
  return parsed
}

type Place = { name: string; latitude: number; longitude: number; timezone: string | null }
type AmbiguousPlace = { ambiguous: true; name: string; options: string[] }
async function resolvePlace(input: ChatInput, requestedCity: string | null): Promise<Place | AmbiguousPlace | null> {
  if (!requestedCity) return { name: input.city, latitude: input.latitude, longitude: input.longitude, timezone: null }
  if (requestedCity.trim().toLocaleLowerCase() === input.city.split(',')[0].trim().toLocaleLowerCase()) {
    return { name: input.city, latitude: input.latitude, longitude: input.longitude, timezone: null }
  }
  const queryName = requestedCity.split(',')[0].replace(/^(?:село|град)\s+/iu, '').trim()
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(queryName)}&count=10&language=${/\p{Script=Cyrillic}/u.test(queryName) ? 'bg' : 'en'}&format=json`
  let response: Response
  try { response = await fetchWithTimeout(url) } catch { throw new ServiceError('geocoding', 'network-error') }
  if (!response.ok) throw new ServiceError('geocoding', 'upstream-http', response.status)
  const results = ((await response.json()) as { results?: GeocodingPlace[] })?.results
  if (!Array.isArray(results) || !results.length) return null
  const [namePart, qualifier] = requestedCity.split(',').map(value => value.trim())
  const normalized = (value: unknown) => typeof value === 'string' ? value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : ''
  const requestedName = normalized(namePart.replace(/^(?:село|град)\s+/iu, ''))
  const requestedQualifier = normalized(qualifier)
  const ranked = results.filter(place => Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90 && Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180).map(place => ({ place, score:
    (normalized(place.name) === requestedName ? 100 : 0) +
    (requestedQualifier && [place.country, place.country_code, place.admin1, place.admin2].some(value => normalized(value).includes(requestedQualifier)) ? 50 : 0) +
    (['P', 'place', 'city', 'town', 'village'].some(value => String(place.feature_code ?? place.feature_class ?? '').toLocaleLowerCase().includes(value.toLocaleLowerCase())) ? 10 : 0) +
    Math.log10(Math.max(1, Number(place.population) || 1))
  })).sort((a, b) => b.score - a.score)
  if (!ranked.length || normalized(ranked[0].place.name) !== requestedName) return null
  if ((requestedQualifier && ![ranked[0].place.country, ranked[0].place.country_code, ranked[0].place.admin1, ranked[0].place.admin2].some(value => normalized(value).includes(requestedQualifier))) || (ranked.length > 1 && ranked[0].score - ranked[1].score < 1)) {
    return { ambiguous: true, name: namePart, options: ranked.slice(0, 3).map(({ place }) => [place.admin1, place.country].filter(Boolean).join(', ')).filter((value): value is string => Boolean(value)) }
  }
  const place = ranked[0].place
  if (!place || typeof place.latitude !== 'number' || typeof place.longitude !== 'number') return null
  return { name: place.name, latitude: place.latitude, longitude: place.longitude, timezone: typeof place.timezone === 'string' ? place.timezone : 'UTC' }
}

async function getWeather(place: { name: string; latitude: number; longitude: number; timezone?: string | null }, targetDate: string | null) {
  const p = `latitude=${place.latitude}&longitude=${place.longitude}&timezone=${encodeURIComponent(place.timezone || 'auto')}&forecast_days=16`
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?${p}&current=temperature_2m,apparent_temperature,weather_code,precipitation,wind_speed_10m,uv_index&hourly=temperature_2m,apparent_temperature,weather_code,precipitation,precipitation_probability,wind_speed_10m,uv_index&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max`
  const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?${p}&current=european_aqi,pm10,pm2_5`
  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?${p}&current=sea_surface_temperature`
  const [weatherResult, aqiResult, marineResult] = await Promise.allSettled([fetchWithTimeout(weatherUrl), fetchWithTimeout(aqiUrl), fetchWithTimeout(marineUrl)])
  if (weatherResult.status !== 'fulfilled') throw new ServiceError('open-meteo', 'network-error')
  if (!weatherResult.value.ok) throw new ServiceError('open-meteo', 'upstream-http', weatherResult.value.status)
  const weather: WeatherPayload = await weatherResult.value.json()
  const aqi: { current?: { european_aqi?: number; pm10?: number; pm2_5?: number } } | null = aqiResult.status === 'fulfilled' && aqiResult.value.ok ? await aqiResult.value.json() : null
  const marine: { current?: { sea_surface_temperature?: number } } | null = marineResult.status === 'fulfilled' && marineResult.value.ok ? await marineResult.value.json() : null
  const dailyPayload = weather.daily
  const daily = dailyPayload && Array.isArray(dailyPayload.time) ? dailyPayload.time.map((date: string, i: number) => ({
    date, code: dailyPayload.weather_code?.[i] ?? null, minC: dailyPayload.temperature_2m_min?.[i] ?? null, maxC: dailyPayload.temperature_2m_max?.[i] ?? null,
    rainMm: dailyPayload.precipitation_sum?.[i] ?? null, rainChancePct: dailyPayload.precipitation_probability_max?.[i] ?? null,
    maxWindKmh: dailyPayload.wind_speed_10m_max?.[i] ?? null, maxUv: dailyPayload.uv_index_max?.[i] ?? null
  })) : []
  return { location: place.name, timezone: weather.timezone, current: weather.current ?? null, daily, nextHours: zipForecastHours(weather.hourly, weather.current?.time), tomorrow: findDailyForecast(daily, weather.daily?.time?.[1]), targetDay: targetDate ? findDailyForecast(daily, targetDate) : null,
    airQuality: aqi?.current ? { europeanAqi: aqi.current.european_aqi ?? null, pm10: aqi.current.pm10 ?? null, pm2_5: aqi.current.pm2_5 ?? null } : null,
    marine: marine?.current?.sea_surface_temperature != null ? { seaTemperatureC: marine.current.sea_surface_temperature } : null }
}

async function getHistoricalWeather(place: { name: string; latitude: number; longitude: number; timezone?: string | null }, date: string) {
  const p = `latitude=${place.latitude}&longitude=${place.longitude}&timezone=${encodeURIComponent(place.timezone || 'auto')}&start_date=${date}&end_date=${date}`
  const url = `https://archive-api.open-meteo.com/v1/archive?${p}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max`
  let response: Response
  try { response = await fetchWithTimeout(url) } catch { throw new ServiceError('open-meteo', 'network-error') }
  if (!response.ok) throw new ServiceError('open-meteo', 'upstream-http', response.status)
  const data: WeatherPayload = await response.json()
  const day = Array.isArray(data.daily?.time) && data.daily.time[0] ? { date: data.daily.time[0], code: data.daily.weather_code?.[0] ?? null, minC: data.daily.temperature_2m_min?.[0] ?? null, maxC: data.daily.temperature_2m_max?.[0] ?? null, rainMm: data.daily.precipitation_sum?.[0] ?? null, rainChancePct: null, maxWindKmh: data.daily.wind_speed_10m_max?.[0] ?? null } : null
  return { location: place.name, timezone: data.timezone, targetDay: day, historical: true }
}


const clarification = (lang: 'bg' | 'en') => lang === 'bg'
  ? 'За кое място, период и каква информация за времето питаш?'
  : 'Which place, period, and weather information do you mean?'

async function optionalGeminiUnderstanding(input: ChatInput, requestId: string): Promise<SemanticUnderstanding | null> {
  if (!process.env.GEMINI_API_KEY) { logUnderstanding('missing_configuration', false, requestId); return null }
  try {
    logUnderstanding('gemini_invoked', true, requestId)
    const result = await callGemini(semanticSystem, JSON.stringify({ currentDate: localIsoDate(new Date(), 'Europe/Sofia'), selectedCity: input.city, language: input.lang, message: input.message, context: input.context ?? null, pendingClarification: input.pendingClarification ?? null }), 1024, 'gemini-understanding', semanticSchema, requestId)
    const parsed = parseSemanticUnderstanding(result, input.lang)
    logUnderstanding(parsed ? 'gemini_valid' : 'invalid_structure', true, requestId)
    return parsed
  } catch (error) {
    const details = record(error)
    const code = details?.code
    const reason = ['daily_limit', 'cooldown', 'quota_unavailable', 'ai_disabled'].includes(String(code)) ? String(code) as 'daily_limit' | 'cooldown' | 'quota_unavailable' | 'ai_disabled' : details?.httpStatus === 429 ? 'quota'
      : details?.httpStatus === 401 ? 'authentication' : details?.httpStatus === 403 ? 'permission'
      : details?.httpStatus === 404 ? 'model_unavailable' : code === 'invalid-json' ? 'invalid_json'
      : code === 'timeout' ? 'timeout' : code === 'network-error' ? 'network_error'
      : code === 'models-list-failed' ? 'discovery_failed'
      : code === 'configured-model-unavailable' || code === 'no-compatible-model' ? 'model_unavailable'
      : code === 'upstream-http' ? 'upstream_http' : 'unexpected_error'
    logUnderstanding(reason, true, requestId)
    return null
  }
}

// Fixed enums only: no message, city, coordinates, model prose or error text.
function logUnderstanding(reason: 'daily_limit' | 'cooldown' | 'quota_unavailable' | 'ai_disabled' | 'gemini_invoked' | 'gemini_valid' | 'missing_configuration' | 'quick_action' | 'budget_exhausted' | 'invalid_structure' | 'invalid_json' | 'quota' | 'authentication' | 'permission' | 'timeout' | 'network_error' | 'discovery_failed' | 'model_unavailable' | 'upstream_http' | 'unexpected_error', attempted: boolean, requestId: string) {
  console.info('[weather-chat:understanding]', { requestId, provider: 'gemini', phase: reason === 'gemini_invoked' ? 'invocation' : 'result', reason, attempted })
}

let budgetMinute = 0
let budgetCount = 0
let requestCount = 0
function takeGeminiBudget() {
  const minute = Math.floor(Date.now() / 60000)
  if (minute !== budgetMinute) { budgetMinute = minute; budgetCount = 0; requestCount = 0 }
  return ++budgetCount <= 20
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const requestId = randomUUID()
  let decisionSource: 'gemini' | 'local' | 'none' = 'none'
  const reply = (status: number, body: Record<string, unknown>, outcome: 'answer' | 'clarification' | 'unrelated' | 'unavailable' | 'rejected' | 'error', reason: 'semantic' | 'fallback' | 'semantic_clarification' | 'invalid_date' | 'geocoding' | 'weather_data' | 'invalid_request' | 'request_limit' | 'upstream_error' | 'location_evidence') => {
    console.info('[weather-chat:decision]', { requestId, source: decisionSource, outcome, reason })
    return response.status(status).json(body)
  }
  try {
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' }, 'rejected', 'invalid_request')
    const input = validateChatInput(request.body)
    if (!input) return reply(400, { error: requestIsEnglish(request.body) ? 'Invalid request.' : 'Невалидна заявка.' }, 'rejected', 'invalid_request')

    const minute = Math.floor(Date.now() / 60000)
    if (minute !== budgetMinute) { budgetMinute = minute; budgetCount = 0; requestCount = 0 }
    if (++requestCount > 120) return reply(429, { error: input.lang === 'bg' ? 'Твърде много заявки. Опитайте след минута.' : 'Too many requests. Please try in a minute.' }, 'rejected', 'request_limit')

    // Infer the message language without changing the interface preference.
    if (/[а-я]/iu.test(input.message)) input.lang = 'bg'
    else if (/\b(weather|rain|wind|thunder|thunderstorms?|lightning|temperature|tomorrow|today|and|what|wear|umbrella|forecast)\b/i.test(input.message)) input.lang = 'en'

    let placeInput = input.context && !input.quickAction ? { ...input, city: input.context.city, latitude: input.context.latitude, longitude: input.context.longitude } : input
    const cache = new Map<string, Promise<Place | AmbiguousPlace | null>>()
    const resolve = (name: string) => {
      const key = name.toLocaleLowerCase()
      if (!cache.has(key)) cache.set(key, resolvePlace(placeInput, name))
      return cache.get(key)!
    }
    let route = localRoute(input)
    const localCity = route.useLocal && !input.quickAction ? clarificationTurn(input.message, input.lang, input).understanding?.requestedCity : null
    if (localCity) {
      const verified = await resolve(localCity)
      if (!verified || 'ambiguous' in verified) route = { useLocal: false, reason: 'unverified_location' }
    }
    // This minute throttle is only instance-local, never the project quota.
    const withinBudget = !route.useLocal && takeGeminiBudget()
    console.info('[weather-chat:routing]', { requestId, route: route.useLocal ? 'local' : 'ai_preferred', reason: route.reason, savedGeminiCalls: route.useLocal && !input.quickAction && Boolean(process.env.GEMINI_API_KEY) ? 1 : 0 })
    if (input.quickAction) logUnderstanding('quick_action', false, requestId)
    else if (!withinBudget && !route.useLocal) logUnderstanding('budget_exhausted', false, requestId)
    const ai = withinBudget ? await optionalGeminiUnderstanding(input, requestId) : null
    decisionSource = ai ? 'gemini' : 'local'
    const userMessage = input.message
    const semanticTurn = ai ? resolveSemanticTurn(input.message, input.lang, input, ai) : null
    const turn = semanticTurn ?? clarificationTurn(input.message, input.lang, input)
    const decisionReason = ai ? 'semantic' : 'fallback'
    if (turn.answer) return reply(200, { answer: turn.answer, pendingClarification: turn.pendingClarification, intent: 'unclear', needsClarification: true }, 'clarification', semanticTurn?.reason ?? 'fallback')
    input.context = turn.context
    input.message = turn.message
    let understood: Understanding | null = turn.understanding
    if (route.useLocal && understood?.timeScope === 'general') understood = { ...understood, timeScope: 'next_12h' }
    if (understood?.needsClarification) {
      const missing = ['unclear', 'other_city', 'general_weather'].includes(understood.intent) ? 'intent' : 'date'
      const place = understood.requestedCity ?? input.context?.city ?? input.city
      const answer = missing === 'intent'
        ? (input.lang === 'bg' ? `Какво Ви интересува за ${place}?` : `What weather information would you like for ${place}?`)
        : (input.lang === 'bg' ? `За кой точно ден в ${place} питате?` : `Which exact day in ${place} do you mean?`)
      const snapshot = { ...understood, intent: understood.intent === 'unclear' ? 'general_weather' : understood.intent, needsClarification: false, clarificationQuestion: null }
      const pendingClarification: PendingClarification = { understanding: snapshot, message: input.message, missing, attempts: 1, ...(input.context ? { context: input.context } : {}) }
      return reply(200, { answer, pendingClarification, intent: 'unclear', needsClarification: true }, 'clarification', decisionReason)
    }
    if (!understood || understood.needsClarification || understood.intent === 'unclear') {
      return reply(200, { answer: clarification(input.lang), intent: 'unclear', needsClarification: true }, 'clarification', decisionReason)
    }
    if (understood.intent === 'unrelated') return reply(200, { answer: unrelatedWeatherAnswer(input.lang), intent: understood.intent, needsClarification: false }, 'unrelated', decisionReason)

    placeInput = input.context && !input.quickAction ? { ...input, city: input.context.city, latitude: input.context.latitude, longitude: input.context.longitude } : input
    const qualifiedReply = turn.continuation && input.pendingClarification?.missing === 'location' && understood.requestedCity?.includes(',')
    const evidence = input.quickAction ? [] : collectLocationCandidates(userMessage, input.lang).filter(candidate => !qualifiedReply || candidate.strength !== 'name')
    const grounded = await groundLocation(evidence, understood.requestedCity, ai?.citySource === 'explicit', resolve).catch(error => {
      console.info('[weather-chat:location]', { requestId, interpreter: decisionSource, evidence: 'unavailable', candidates: evidence.length, resolution: 'blocked' })
      throw error
    })
    if (grounded.status === 'ambiguous' || grounded.status === 'unverified') {
      console.info('[weather-chat:location]', { requestId, interpreter: decisionSource, evidence: grounded.status, candidates: grounded.candidates, resolution: 'clarification' })
      const snapshot = parseUnderstanding({ intent: understood.intent, requestedCity: grounded.requestedCity, timeScope: understood.timeScope, targetDate: understood.targetDate, needsClarification: false, clarificationQuestion: null }, input.lang)!
      const attempts = (input.pendingClarification?.missing === 'location' ? input.pendingClarification.attempts : 0) + 1
      const pendingClarification: PendingClarification | null = attempts <= 3 ? { understanding: snapshot, message: userMessage, missing: 'location', locationMode: grounded.status === 'ambiguous' && grounded.requestedCity ? 'qualifier' : 'name', attempts } : null
      const answer = input.lang === 'bg' ? 'За кое населено място питате? Посочете името и област или държава, за да не използвам погрешно място.' : 'Which location do you mean? Please give its name and region or country so I can use the right place.'
      return reply(200, { answer, pendingClarification, intent: understood.intent, needsClarification: true }, 'clarification', 'location_evidence')
    }
    const place = grounded.status === 'verified' ? grounded.place : understood.requestedCity ? await resolve(understood.requestedCity) : await resolvePlace(placeInput, null)
    const preventedInheritance = grounded.status === 'verified' && (!understood.requestedCity || understood.requestedCity.toLocaleLowerCase() === placeInput.city.toLocaleLowerCase()) && (grounded.place.latitude !== placeInput.latitude || grounded.place.longitude !== placeInput.longitude)
    console.info('[weather-chat:location]', { requestId, interpreter: decisionSource, evidence: grounded.status, candidates: grounded.candidates, resolution: grounded.status === 'verified' ? 'verified_place' : understood.requestedCity ? 'geocoding' : input.context ? 'inherited' : 'selected', preventedInheritance })
    if (grounded.status === 'verified') understood = { ...understood, requestedCity: grounded.place.name }
    if (!place || 'ambiguous' in place) {
      const attempts = (turn.continuation && input.pendingClarification?.missing === 'location' ? input.pendingClarification.attempts : 0) + 1
      const snapshot = parseUnderstanding({ intent: understood.intent, requestedCity: understood.requestedCity, timeScope: understood.timeScope, targetDate: understood.targetDate, needsClarification: false, clarificationQuestion: null }, input.lang)!
      const pendingClarification: PendingClarification | null = attempts <= 3 ? { understanding: snapshot, message: input.message, missing: 'location', locationMode: place ? 'qualifier' : 'name', attempts, ...(input.context ? { context: input.context } : {}) } : null
      const answer = !place ? (input.lang === 'bg' ? `Не намирам място „${understood.requestedCity}“. Посочи правилното име и държава.` : `I cannot find “${understood.requestedCity}”. Please provide its name and country.`)
        : input.lang === 'bg' ? `Кой ${place.name} имаш предвид — ${place.options.join(', ')}?` : `Which ${place.name} do you mean—${place.options.join(', ')}?`
      return reply(200, { answer, pendingClarification, intent: understood.intent, needsClarification: true }, 'clarification', 'geocoding')
    }
    // Re-resolve yearless dates using the explicitly requested location's local date.
    const resolveTextDate = !ai || ai.timeSource === 'explicit' && ai.timeScope === 'specific_date'
    const localTargetDate = resolveTextDate ? extractRequestedDate(input.message, new Date(), place.timezone ?? 'UTC', input.lang) : null
    if (localTargetDate) understood = { ...understood, targetDate: localTargetDate, timeScope: 'specific_date' }
    if (understood.timeScope !== 'specific_date') understood = { ...understood, targetDate: null }
    let summary: WeatherSummary = await getWeather(place, understood.targetDate)
    if (understood.timeScope === 'this_weekend' || understood.timeScope === 'next_weekend') {
      const requestedDates = weekendForecastDates(understood.timeScope, new Date(), summary.timezone || place.timezone || 'UTC')
      summary = { ...summary, requestedDates, targetDays: requestedDates.map(date => findDailyForecast(summary.daily, date)).filter(day => day !== null) }
    }
    if (!understood.targetDate && ['day_before_yesterday', 'yesterday', 'today', 'tomorrow', 'day_after_tomorrow', 'tomorrow_morning', 'tomorrow_afternoon', 'tomorrow_evening', 'tomorrow_night'].includes(understood.timeScope)) {
      const today = localIsoDate(new Date(), summary.timezone || place.timezone || 'UTC')
      const relativeScope = isRelativeScope(understood.timeScope) ? understood.timeScope : 'tomorrow'
      understood = { ...understood, targetDate: relativeForecastDate(relativeScope, new Date(), summary.timezone || place.timezone || 'UTC') ?? addIsoDays(today, 1) }
      summary = { ...summary, requestedDate: understood.targetDate, targetDay: findDailyForecast(summary.daily, understood.targetDate) }
    }
    // Recompute yearless/relative expressions only after Open-Meteo supplies the location timezone.
    const resolvedDate = resolveTextDate ? extractRequestedDate(input.message, new Date(), summary.timezone || place.timezone || 'UTC', input.lang) : null
    if (resolvedDate) {
      understood = { ...understood, targetDate: resolvedDate, timeScope: 'specific_date' }
      summary = { ...summary, targetDay: findDailyForecast(summary.daily, resolvedDate) }
    }
    const context = { city: place.name, latitude: place.latitude, longitude: place.longitude, intent: understood.intent, timeScope: understood.timeScope, targetDate: understood.targetDate, previousQuestion: input.message }
    const localToday = localIsoDate(new Date(), summary.timezone || place.timezone || 'UTC')
    if (understood.targetDate && understood.targetDate < localToday) summary = await getHistoricalWeather({ ...place, timezone: summary.timezone || place.timezone }, understood.targetDate)
    if (understood.intent !== 'thunderstorm' && understood.targetDate && !summary.targetDay) return reply(200, { context, answer: input.lang === 'bg' ? `За ${understood.targetDate} все още няма надеждна прогноза в наличния прогнозен период.` : `A reliable forecast for ${understood.targetDate} is not available yet.`, intent: understood.intent, needsClarification: false }, 'unavailable', 'weather_data')
    const answer = deterministicWeatherAnswer(summary, understood, input.lang)
    return reply(200, { answer, context, intent: understood.intent, requestedCity: understood.requestedCity, timeScope: understood.timeScope, targetDate: understood.targetDate, needsClarification: false }, 'answer', decisionReason)
  } catch (error) {
    const serviceError = error instanceof ServiceError ? error : new ServiceError('open-meteo', 'unexpected-error')
    logFailure(serviceError)
    const openMeteoFailed = ['open-meteo', 'geocoding'].includes(serviceError.stage)
    return reply(openMeteoFailed ? 502 : 200, openMeteoFailed
      ? { error: requestIsEnglish(request.body) ? 'I could not retrieve the weather data.' : 'Не успях да проверя метеорологичните данни.', source: 'open-meteo' }
      : { answer: requestIsEnglish(request.body) ? 'Which place, period, and weather information do you mean?' : 'За кое място, период и каква информация за времето питаш?', needsClarification: true }, openMeteoFailed ? 'error' : 'clarification', 'upstream_error')
  }
}
