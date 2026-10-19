import assert from 'node:assert/strict'
import { semanticFixture } from './bobi-language-corpus.mjs'

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
export const latencyCases = [
  { name: 'fast', quotaMs: 100, googleMs: 900 },
  { name: 'normal', quotaMs: 500, googleMs: 4000 },
  { name: 'production-reservation-fast-answer', quotaMs: 1533, googleMs: 6000 },
  { name: 'production-reservation-6800', quotaMs: 1533, googleMs: 6800 },
  { name: 'fast-reservation-6800', quotaMs: 100, googleMs: 6800 },
  { name: 'production-reservation-hang', quotaMs: 1533, googleMs: Infinity },
  { name: 'slow-reservation-5400', quotaMs: 2800, googleMs: 5400 },
  { name: 'quota-timeout', quotaMs: 3100, googleMs: 100 },
  { name: 'generation-stage-timeout', quotaMs: 100, googleMs: Infinity },
  { name: 'cold-discovery', quotaMs: 1533, discoveryMs: 1000, googleMs: 5800 },
  { name: 'slow-discovery', quotaMs: 100, discoveryMs: 1600, googleMs: 100 },
  { name: 'slow-generation-body', quotaMs: 1533, googleMs: 100, bodyMs: 6700 },
  { name: 'slow-quota-body', quotaMs: 100, quotaBodyMs: 1433, googleMs: 6800 }
]

// All network access is injected. Real quota code, real stage/deadline timers,
// deterministic millisecond clock, synthetic response data. No external requests.
export async function simulateLatency(timers, createClient, options, execute) {
  const epoch = Date.parse('2026-10-08T09:00:00Z')
  timers.enable({ apis: ['Date', 'setTimeout'], now: epoch })
  const logs = [], calls = []
  const pause = (ms, signal) => {
    if (ms === 0) return Promise.resolve()
    return new Promise((resolve, reject) => {
      let timer
      const onAbort = () => { clearTimeout(timer); reject(signal.reason) }
      const done = () => { signal.removeEventListener('abort', onAbort); resolve() }
      if (Number.isFinite(ms)) timer = setTimeout(done, ms)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  }
  const value = options.value ?? semanticFixture({ intent: 'rain', timeScope: 'tomorrow', timeSource: 'explicit' })
  const client = createClient({
    env: { GEMINI_API_KEY: 'synthetic-key', SUPABASE_URL: 'https://quota.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
      ...(options.discoveryMs === undefined ? { GEMINI_MODEL: 'gemini-3.8-flash' } : {}) },
    now: () => Date.now(), logger: (...args) => logs.push(args),
    fetchImpl: async (url, init) => {
      const quota = url === 'https://quota.example.invalid/rest/v1/rpc/gemini_quota'
      const discovery = init.method === 'GET'
      assert.ok(quota || url.startsWith('https://generativelanguage.googleapis.com/v1beta/models'))
      const kind = quota ? 'quota' : discovery ? 'discovery' : 'generation'
      calls.push({ kind, atMs: Date.now() - epoch, signal: init.signal })
      await pause(quota ? options.quotaMs : discovery ? options.discoveryMs : options.googleMs, init.signal)
      return { ok: true, status: 200, json: async () => {
        await pause(quota ? options.quotaBodyMs ?? 0 : discovery ? 0 : options.bodyMs ?? 0, init.signal)
        return quota ? { allowed: true, reason: 'reserved' }
          : discovery ? { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] }
            : { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }
      } }
    }
  })
  let settled = false, result, outcome
  const pending = (execute ? execute(client) : client.generate({ endpoint: 'weather-chat', stage: 'gemini-understanding', body: {}, requestId: 'simulation' }))
    .then(value => { result = value; outcome = 'ok' }, error => { outcome = error.code ?? 'unexpected' })
    .finally(() => { settled = true })
  await flush()
  while (!settled && Date.now() - epoch <= 12000) { timers.tick(1); await flush() }
  assert.ok(settled, 'the understanding must remain bounded')
  await pending
  return { outcome, elapsedMs: Date.now() - epoch, result, logs, calls,
    quotaCalls: calls.filter(call => call.kind === 'quota').length,
    googleCalls: calls.filter(call => call.kind === 'generation').length }
}
