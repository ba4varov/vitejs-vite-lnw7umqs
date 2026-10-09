// Supabase requires persistence enabled to use a custom storage adapter.
// Only PKCE state is persistent; the SDK cannot store an application session.
const pkceKey = key => /^meteo-pulse-google-(?:code-verifier|flows-code-verifier|flow-[a-zA-Z0-9_-]+-code-verifier)$/.test(key)
export function createPKCEStorage(storage) {
  return {
    getItem: key => pkceKey(key) ? storage.getItem(key) : null,
    setItem: (key, value) => { if (pkceKey(key)) storage.setItem(key, value) },
    removeItem: key => { if (pkceKey(key)) storage.removeItem(key) },
  }
}

// The SDK owns PKCE only. Application sessions always go through auth-client.
export function createGoogleOAuth({ createClient, storage, location, history, publish, enabled }) {
  const pendingKey = 'meteo-pulse-google-pending'
  const verifierKey = 'meteo-pulse-google-code-verifier'
  let callback
  const clean = () => {
    const keys = ['meteo-pulse-google-flows-code-verifier']
    try {
      const flows = JSON.parse(storage.getItem('meteo-pulse-google-flows-code-verifier') || '[]')
      if (Array.isArray(flows)) for (const id of flows) {
        const key = `meteo-pulse-google-flow-${id}-code-verifier`
        if (typeof id === 'string' && pkceKey(key)) keys.push(key)
      }
    } catch { /* Enumerate browser storage below if its index is unavailable. */ }
    for (let i = 0; i < (storage.length || 0); i++) { const key = storage.key(i); if (key && pkceKey(key)) keys.push(key) }
    keys.forEach(key => storage.removeItem(key))
    storage.removeItem(pendingKey); storage.removeItem(verifierKey)
  }
  const scrub = () => {
    const next = new URL(location.href)
    for (const key of ['code', 'oauth', 'error', 'error_code', 'error_description', 'sb_flow_id']) next.searchParams.delete(key)
    next.hash = ''
    history.replaceState({}, '', next.pathname + next.search)
  }
  return {
    async start() {
      if (!enabled) throw new Error('GOOGLE_DISABLED')
      // Fail before navigation if PKCE cannot survive a page reload.
      clean()
      storage.setItem(pendingKey, String(Date.now()))
      const client = createClient()
      try {
        const redirectTo = `${location.origin}/?oauth=google`
        const { data, error } = await client.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } })
        if (error || !data?.url) throw error || new Error('GOOGLE_START_FAILED')
        location.assign(data.url)
      } catch (error) { clean(); throw error }
      finally { await client.dispose?.() }
    },
    consume(onSession = publish) {
      if (callback) return callback
      const params = new URL(location.href).searchParams
      if (params.get('oauth') !== 'google') {
        // Returning manually after abandoning the provider must not leave a verifier.
        if (storage.getItem(pendingKey)) { clean(); return Promise.reject(new Error('GOOGLE_INTERRUPTED')) }
        return Promise.resolve(false)
      }
      const code = params.get('code')
      const pending = Number(storage.getItem(pendingKey))
      scrub()
      callback = (async () => {
        let client
        try {
          if (params.has('error') || params.has('error_code')) throw new Error('GOOGLE_DENIED')
          if (!code || !pending || Date.now() - pending > 10 * 60_000) throw new Error('GOOGLE_INTERRUPTED')
          client = createClient()
          const { data, error } = await client.exchangeCodeForSession(code, params.get('sb_flow_id') ? { flowId: params.get('sb_flow_id') } : undefined)
          if (error || !data?.session?.access_token || !data.session.refresh_token || !data.session.user?.id) throw new Error('GOOGLE_CALLBACK_FAILED')
          onSession(data.session)
          return true
        } finally { clean(); await client?.dispose?.() }
      })()
      return callback
    },
    cancel: clean,
  }
}
