const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta'
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
  return name.startsWith('gemini-') &&
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

export function createGeminiClient({ fetchImpl = fetch, env = process.env, logger = console.error } = {}) {
  let cachedModel

  function log(endpoint, error) {
    logger(`[${endpoint}]`, {
      endpoint, stage: error.stage, status: error.httpStatus ?? null,
      upstreamStatus: error.upstreamStatus ?? null, code: error.code,
      model: error.model ?? null, message: error.safeMessage ?? null
    })
  }

  async function listModels(stage) {
    const apiKey = env.GEMINI_API_KEY
    let response
    try {
      response = await fetchImpl(`${API_ROOT}/models`, { method: 'GET', headers: { 'x-goog-api-key': apiKey } })
    } catch {
      throw new GeminiServiceError(stage, 'models-list-failed', { safeMessage: 'Model discovery network failure' })
    }
    if (!response.ok) {
      throw new GeminiServiceError(stage, 'models-list-failed', { httpStatus: response.status, ...await upstreamDetails(response, apiKey) })
    }
    let payload
    try { payload = await response.json() } catch {
      throw new GeminiServiceError(stage, 'models-list-failed', { httpStatus: response.status, safeMessage: 'Invalid model discovery response' })
    }
    return Array.isArray(payload?.models) ? payload.models : []
  }

  async function resolveModel(stage, { exclude, ignoreConfigured = false } = {}) {
    if (cachedModel && cachedModel !== exclude) return cachedModel
    const models = await listModels(stage)
    const configured = !ignoreConfigured ? normalizeName(env.GEMINI_MODEL) : ''
    if (configured) {
      const found = models.find(model => normalizeName(model.name) === configured)
      if (!found || !isCompatible(found)) {
        throw new GeminiServiceError(stage, 'configured-model-unavailable', { model: configured, safeMessage: 'Configured model is unavailable or incompatible' })
      }
      cachedModel = configured
      return cachedModel
    }
    const selected = compatibleFlashModels(models).map(model => normalizeName(model.name)).find(name => name !== exclude)
    if (!selected) throw new GeminiServiceError(stage, 'no-compatible-model', { safeMessage: 'No compatible stable Gemini Flash model is available' })
    cachedModel = selected
    return cachedModel
  }

  async function generate({ endpoint, stage, body }) {
    if (!env.GEMINI_API_KEY) {
      const error = new GeminiServiceError(stage, 'missing-configuration', { safeMessage: 'Gemini is not configured' })
      log(endpoint, error); throw error
    }
    let model
    try {
      model = await resolveModel(stage)
      for (let attempt = 0; attempt < 2; attempt++) {
        let response
        try {
          response = await fetchImpl(`${API_ROOT}/models/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(body)
          })
        } catch { throw new GeminiServiceError(stage, 'network-error', { model, safeMessage: 'Gemini network failure' }) }
        if (response.ok) return { payload: await response.json(), model }
        const details = await upstreamDetails(response, env.GEMINI_API_KEY)
        if (response.status === 404 && attempt === 0) {
          const previous = model
          cachedModel = undefined
          model = await resolveModel(stage, { exclude: previous, ignoreConfigured: true })
          continue
        }
        throw new GeminiServiceError(stage, 'upstream-http', { httpStatus: response.status, model, ...details })
      }
    } catch (error) {
      const serviceError = error instanceof GeminiServiceError ? error : new GeminiServiceError(stage, 'unexpected-error', { model })
      log(endpoint, serviceError)
      throw serviceError
    }
  }

  return { generate, resolveModel, invalidate: () => { cachedModel = undefined } }
}

export const geminiClient = createGeminiClient()
