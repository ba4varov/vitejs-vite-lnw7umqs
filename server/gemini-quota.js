// No messages, user IDs, coordinates or cached semantic outputs. Only a shared
// project-scope counter and cooldown. Missing storage fails closed for AI.
export function createGeminiQuota({ env = process.env, fetchImpl = fetch } = {}) {
  async function rpc(action, signal) {
    const base = env.SUPABASE_URL?.replace(/\/$/u, ''), key = env.SUPABASE_SERVICE_ROLE_KEY
    if (!base || !key) return { allowed: false, reason: 'quota_unavailable' }
    const limit = Number(env.GEMINI_DAILY_REQUEST_LIMIT ?? 20)
    if (!Number.isInteger(limit) || limit < 0 || limit > 10000) return { allowed: false, reason: 'quota_unavailable' }
    let timer
    try {
      return await Promise.race([(async () => {
        const response = await fetchImpl(`${base}/rest/v1/rpc/gemini_quota`, {
          method: 'POST', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(1000)]),
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, daily_limit: limit })
        })
        if (!response.ok) return { allowed: false, reason: 'quota_unavailable' }
        const result = await response.json()
        return (result?.allowed === true && result.reason === 'reserved' || result?.allowed === false && ['daily_limit', 'cooldown'].includes(result.reason))
          ? result : { allowed: false, reason: 'quota_unavailable' }
      })(), new Promise(resolve => { timer = setTimeout(() => resolve({ allowed: false, reason: 'quota_unavailable' }), 1000) })])
    } catch { return { allowed: false, reason: 'quota_unavailable' } } finally { clearTimeout(timer) }
  }
  return { reserve: signal => rpc('reserve', signal), block: signal => rpc('block', signal) }
}
