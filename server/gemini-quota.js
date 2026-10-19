// No messages, user IDs, coordinates or cached semantic outputs. Only a shared
// project-scope counter and cooldown. Missing storage fails closed for AI.
export const QUOTA_RPC_TIMEOUT_MS = 3000
export function createGeminiQuota({ env = process.env, fetchImpl = fetch, logger = (prefix, data) => console.info(prefix, data), now = () => performance.now() } = {}) {
  async function rpc(action, parent) {
    const started = now()
    const unavailable = { allowed: false, reason: 'quota_unavailable' }
    let status = null, code = 'configuration_error', configError, timer, onAbort, signal
    try {
      const key = env.SUPABASE_SERVICE_ROLE_KEY
      let base
      try { base = new URL(env.SUPABASE_URL) } catch { configError = 'invalid_url'; return unavailable }
      if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) {
        configError = 'invalid_url'; return unavailable
      }
      if (typeof key !== 'string' || !key.trim() || /[\r\n]/u.test(key)) { configError = 'missing_or_invalid_key'; return unavailable }
      const limit = Number(env.GEMINI_DAILY_REQUEST_LIMIT ?? 20)
      if (!Number.isInteger(limit) || limit < 0 || limit > 10000) { configError = 'invalid_daily_limit'; return unavailable }
      const controller = new AbortController()
      signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal
      timer = setTimeout(() => controller.abort(), QUOTA_RPC_TIMEOUT_MS)
      code = 'network_error'
      signal.throwIfAborted()
      const aborted = new Promise((_, reject) => {
        onAbort = () => reject(new Error('RPC aborted'))
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      })
      // One deadline covers headers AND body; race also bounds transports that
      // ignore abort. Never retry or refund an ambiguously committed reservation.
      return await Promise.race([(async () => {
        const response = await fetchImpl(new URL('/rest/v1/rpc/gemini_quota', base).href, {
          method: 'POST', signal, redirect: 'error',
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, daily_limit: limit })
        })
        signal.throwIfAborted()
        status = response.status
        if (!response.ok) {
          code = 'http_error'
          // Do not read or log upstream error bodies.
          void response.body?.cancel().catch(() => {})
          return unavailable
        }
        let result
        try { result = await response.json() } catch (error) {
          code = error instanceof SyntaxError ? 'invalid_response' : 'network_error'
          throw error
        }
        signal.throwIfAborted()
        if (action === 'reserve' && result?.allowed === true && result.reason === 'reserved' ||
            result?.allowed === false && ['daily_limit', 'cooldown'].includes(result.reason)) {
          code = result.reason
          return { allowed: result.allowed, reason: result.reason }
        }
        code = 'invalid_response'
        return unavailable
      })(), aborted])
    } catch {
      if (signal?.aborted) code = parent?.aborted ? 'aborted' : 'timeout'
      return unavailable
    } finally {
      clearTimeout(timer)
      if (onAbort) signal.removeEventListener('abort', onAbort)
      // Allowlisted metadata only: never URLs, keys, exception text or payloads.
      try { logger('[gemini-quota:rpc]', { action, durationMs: Math.max(0, Math.round(now() - started)), status, code, ...(configError ? { configError } : {}) }) } catch { /* Logging cannot change quota decisions. */ }
    }
  }
  return { reserve: signal => rpc('reserve', signal), block: signal => rpc('block', signal) }
}
