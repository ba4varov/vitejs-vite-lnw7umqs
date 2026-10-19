import { createGeminiQuota } from './gemini-quota.js'
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta'
// Per understanding, including HTTP bodies and the single 404 recovery.
export const GEMINI_BUDGET_MS = Object.freeze({ total: 8000, discovery: 1500, generation: 6500 })
const STABLE_TEXT_MODEL = /^gemini-\d+(?:\.\d+)?-(?:flash(?:-lite)?|pro)(?:-\d{3})?$/
const EXCLUDED_MODEL_KINDS = /(?:image|imagen|live|audio|tts|speech|transcri|embed|preview|experimental|\bexp\b)/i

export class GeminiServiceError extends Error {
  constructor(stage, code, { httpStatus, upstreamStatus, model, safeMessage } = {}) {
    super(code)
    this.name = 'GeminiServiceError'
    this.stage = stage
    this.code = code
    this.httpStatus = httpStatus
    this.upstreamStatus = upstreamStatus
    this.model = model
    this.safeMessage = safeMessage
  }
}

function normalizeName(name) {
  return typeof name === 'string' ? name.trim().replace(/^models\//, '') : ''
}

function isCompatible(model) {
  const name = normalizeName(model?.name)
  return STABLE_TEXT_MODEL.test(name) &&
    Array.isArray(model.supportedGenerationMethods) &&
    model.supportedGenerationMethods.includes('generateContent') &&
    !EXCLUDED_MODEL_KINDS.test(`${name} ${model.displayName ?? ''}`)
}

function versionParts(name) {
  const match = name.match(/gemini-(\d+)(?:\.(\d+))?/i)
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : [0, 0]
}

export function compatibleFlashModels(models) {
  return models.filter(model => isCompatible(model) && /(?:^|-)flash(?:-|$)/i.test(normalizeName(model.name)))
    .sort((a, b) => {
      const an = normalizeName(a.name); const bn = normalizeName(b.name)
      const lite = Number(/flash-lite/i.test(an)) - Number(/flash-lite/i.test(bn))
      if (lite) return lite
      const [aMajor, aMinor] = versionParts(an); const [bMajor, bMinor] = versionParts(bn)
      return bMajor - aMajor || bMinor - aMinor || bn.localeCompare(an, undefined, { numeric: true })
    })
}

// Only known model families get thinking controls; unknown/future models keep defaults.
export function semanticGenerationBody(body, model) {
  const isFlash38 = model === 'gemini-3.8-flash'
  const generationConfig = { ...body.generationConfig, maxOutputTokens: 1024 }
  if (isFlash38) {
    // Gemini 3.8 removes sampling controls and does not support multiple candidates.
    for (const key of ['temperature', 'topP', 'topK', 'candidateCount']) delete generationConfig[key]
  }
  let thinkingConfig
  if (isFlash38) thinkingConfig = { thinkingLevel: 'low' }
  else if (/^gemini-2\.5-flash(?:-lite)?(?:-\d{3})?$/.test(model)) thinkingConfig = { thinkingBudget: 0 }
  else if (/^gemini-2\.5-pro(?:-\d{3})?$/.test(model)) thinkingConfig = { thinkingBudget: 128 }
  else if (/^gemini-3-flash(?:-\d{3})?$/.test(model)) thinkingConfig = { thinkingLevel: 'minimal' }
  else if (/^gemini-3-pro(?:-\d{3})?$/.test(model)) thinkingConfig = { thinkingLevel: 'low' }
  return { ...body, generationConfig: { ...generationConfig,
    ...(thinkingConfig ? { thinkingConfig } : {}) } }
}

function sanitizeMessage(value, apiKey) {
  if (typeof value !== 'string') return undefined
  let result = value.replaceAll(apiKey, '[redacted]').replace(/[\r\n\t]+/g, ' ').replace(/https?:\/\/\S+/g, '[url]')
  result = result.replace(/(?:key|token|authorization)\s*[=:]\s*\S+/gi, '$1=[redacted]').trim()
  return result ? result.slice(0, 180) : undefined
}

async function upstreamDetails(response, apiKey) {
  try {
    const payload = await response.json()
    return {
      upstreamStatus: typeof payload?.error?.status === 'string' ? payload.error.status.slice(0, 80) : undefined,
      safeMessage: sanitizeMessage(payload?.error?.message, apiKey)
    }
  } catch { return {} }
}

export function createGeminiClient({ fetchImpl = fetch, env = process.env, logger = (prefix, data) => (data.code === 'ok' || prefix.endsWith(':gemini-usage]') ? console.info : console.error)(prefix, data), now = () => performance.now(), quota } = {}) {
  const quotaGuard = quota ?? createGeminiQuota({ env, fetchImpl, logger, now })
  let cooldownDay
  const quotaDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  let cachedModel

  function log(endpoint, error, requestId) {
    logger(`[${endpoint}]`, {
      endpoint, stage: error.stage, status: error.httpStatus ?? null,
      code: error.code, ...(requestId ? { requestId } : {})
    })
  }

  // Abort fetch AND bound awaiting its body. Clear timers/listeners on every exit.
  async function timedStage({ endpoint, stage, phase, signal: parent, requestId }, operation) {
    const started = now()
    const controller = new AbortController()
    const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal
    const timer = setTimeout(() => controller.abort(), GEMINI_BUDGET_MS[phase])
    let onAbort
    let failure
    try {
      signal.throwIfAborted()
      const aborted = new Promise((_, reject) => {
        onAbort = () => reject(new GeminiServiceError(stage, 'timeout'))
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      })
      return await Promise.race([operation(signal), aborted])
    } catch (error) {
      failure = signal.aborted ? new GeminiServiceError(stage, 'timeout')
        : error instanceof GeminiServiceError ? error
          : new GeminiServiceError(stage, phase === 'discovery' ? 'models-list-failed' : 'network-error')
      throw failure
    } finally {
      clearTimeout(timer)
      if (onAbort) signal.removeEventListener('abort', onAbort)
      logger(`[${endpoint}:gemini-stage]`, {
        endpoint, stage, phase, durationMs: Math.max(0, Math.round(now() - started)),
        status: failure?.httpStatus ?? null, code: failure?.code ?? 'ok',
        ...(requestId ? { requestId } : {})
      })
    }
  }

  async function listModels(stage, { signal, endpoint, requestId }) {
    return timedStage({ endpoint, stage, phase: 'discovery', signal, requestId }, async stageSignal => {
      const apiKey = env.GEMINI_API_KEY
      const response = await fetchImpl(`${API_ROOT}/models`, { signal: stageSignal, method: 'GET', headers: { 'x-goog-api-key': apiKey } })
      if (response.status === 429) throw new GeminiServiceError(stage, 'upstream-http', { httpStatus: 429 })
      if (!response.ok) {
        throw new GeminiServiceError(stage, 'models-list-failed', { httpStatus: response.status, ...await upstreamDetails(response, apiKey) })
      }
      let payload
      try { payload = await response.json() } catch {
        throw new GeminiServiceError(stage, 'models-list-failed', { httpStatus: response.status, safeMessage: 'Invalid model discovery response' })
      }
      return Array.isArray(payload?.models) ? payload.models : []
    })
  }

  async function resolveModel(stage, { exclude, ignoreConfigured = false, signal, endpoint = 'gemini', requestId } = {}) {
    if (cachedModel && cachedModel !== exclude) return cachedModel
    const configured = !ignoreConfigured ? normalizeName(env.GEMINI_MODEL) : ''
    if (configured) {
      // A conservative stable text-model grammar is checked locally. Availability
      // is checked by generateContent itself; 404 triggers discovery below.
      if (!STABLE_TEXT_MODEL.test(configured)) {
        throw new GeminiServiceError(stage, 'configured-model-unavailable', { safeMessage: 'Configured model is incompatible' })
      }
      return configured
    }
    const models = await listModels(stage, { signal, endpoint, requestId })
    const selected = compatibleFlashModels(models).map(model => normalizeName(model.name)).find(name => name !== exclude)
    if (!selected) throw new GeminiServiceError(stage, 'no-compatible-model', { safeMessage: 'No compatible stable Gemini Flash model is available' })
    cachedModel = selected
    return cachedModel
  }

  async function generate({ endpoint, stage, body, requestId = undefined }) {
    if (!env.GEMINI_API_KEY) {
      const error = new GeminiServiceError(stage, 'missing-configuration', { safeMessage: 'Gemini is not configured' })
      log(endpoint, error, requestId); throw error
    }
    if (env.GEMINI_DISABLED === 'true' || cooldownDay === quotaDay()) {
      const error = new GeminiServiceError(stage, env.GEMINI_DISABLED === 'true' ? 'ai_disabled' : 'cooldown')
      logger(`[${endpoint}:gemini-usage]`, { requestId, reason: error.code, savedGeminiCalls: 1, geminiCalls: 0 })
      log(endpoint, error, requestId); throw error
    }
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), GEMINI_BUDGET_MS.total)
    const signal = deadline.signal
    let model
    try {
      const reserve = async stageSignal => {
        const reservation = await quotaGuard.reserve(stageSignal)
        if (!reservation.allowed) {
          logger(`[${endpoint}:gemini-usage]`, { requestId, reason: reservation.reason, savedGeminiCalls: 1, geminiCalls: 0 })
          throw new GeminiServiceError(stage, reservation.reason)
        }
      }
      // Gate discovery too, so a cold instance cannot repeatedly probe Google
      // after another instance has exhausted the shared daily allowance.
      await reserve(signal)
      model = await resolveModel(stage, { signal, endpoint, requestId })
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const payload = await timedStage({ endpoint, stage, phase: 'generation', signal, requestId }, async stageSignal => {
            if (attempt > 0) await reserve(stageSignal)
            logger(`[${endpoint}:gemini-usage]`, { requestId, reason: 'generation', savedGeminiCalls: 0, geminiCalls: 1 })
            const response = await fetchImpl(`${API_ROOT}/models/${encodeURIComponent(model)}:generateContent`, {
              signal: stageSignal, method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(stage === 'gemini-understanding' ? semanticGenerationBody(body, model) : body)
            })
            if (response.status === 429) throw new GeminiServiceError(stage, 'upstream-http', { httpStatus: 429 })
            if (!response.ok) {
              throw new GeminiServiceError(stage, 'upstream-http', { httpStatus: response.status, model, ...await upstreamDetails(response, env.GEMINI_API_KEY) })
            }
            try { return await response.json() } catch {
              throw new GeminiServiceError(stage, 'invalid-json', { httpStatus: response.status })
            }
          })
          cachedModel = model
          return { payload, model }
        } catch (error) {
          if (error instanceof GeminiServiceError && error.httpStatus === 404) cachedModel = undefined
          if (error instanceof GeminiServiceError && error.httpStatus === 404 && attempt === 0) {
            const previous = model
            model = await resolveModel(stage, { exclude: previous, ignoreConfigured: true, signal, endpoint, requestId })
            continue
          }
          throw error
        }
      }
    } catch (error) {
      const serviceError = error instanceof GeminiServiceError ? error : new GeminiServiceError(stage, 'unexpected-error')
      if (serviceError.httpStatus === 429) {
        // Local fast path also protects this warm instance if shared storage
        // fails. The shared breaker is authoritative across instances.
        cooldownDay = quotaDay()
        await quotaGuard.block(signal).catch(() => {})
      }
      log(endpoint, serviceError, requestId)
      throw serviceError
    } finally { clearTimeout(timer) }
  }

  return { generate, resolveModel, invalidate: () => { cachedModel = undefined } }
}

export const geminiClient = createGeminiClient()
