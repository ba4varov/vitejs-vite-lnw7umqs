// Supabase requires persistence enabled to use a custom storage adapter.
// Only PKCE state is persistent; the SDK cannot store an application session.
export function createPKCEStorage(storage) {
  const verifierKey = 'meteo-pulse-google-code-verifier'
  return {
    getItem: key => key === verifierKey ? storage.getItem(key) : null,
    setItem: (key, value) => { if (key === verifierKey) storage.setItem(key, value) },
    removeItem: key => { if (key === verifierKey) storage.removeItem(key) },
  }
}

// The SDK owns PKCE only. Application sessions always go through auth-client.
export function createGoogleOAuth({ createClient, storage, location, history, publish, enabled }) {
  const pendingKey = 'meteo-pulse-google-pending'
  const verifierKey = 'meteo-pulse-google-code-verifier'
  let callback
  const clean = () => { storage.removeItem(pendingKey); storage.removeItem(verifierKey) }
  const scrub = () => {
    const next = new URL(location.href)
    for (const key of ['code', 'oauth', 'error', 'error_code', 'error_description']) next.searchParams.delete(key)
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
          const { data, error } = await client.exchangeCodeForSession(code)
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
