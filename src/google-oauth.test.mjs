import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { GoTrueClient } from '@supabase/auth-js'
import { createGoogleOAuth, createPKCEStorage } from './google-oauth.js'

function fixture(href = 'https://meteo.example/', enabled = true) {
  const values = new Map(), published = [], calls = [], replacements = [], redirects = []
  const session = { access_token: 'google-token', refresh_token: 'refresh', expires_at: 2000000000, user: { id: 'existing-account', email_confirmed_at: '2026-01-01' } }
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }
  const location = { href, origin: 'https://meteo.example', assign: u => redirects.push(u) }
  const client = {
    signInWithOAuth: async options => { calls.push(options); storage.setItem('meteo-pulse-google-code-verifier', 'verifier'); return { data: { url: 'https://auth.example/authorize' } } },
    exchangeCodeForSession: async code => { calls.push(code); return { data: { session } } },
  }
  const flow = createGoogleOAuth({ createClient: () => client, storage, location, history: { replaceState: (_a, _b, url) => { replacements.push(url); location.href = `https://meteo.example${url}` } }, publish: s => published.push(s), enabled })
  return { flow, values, published, calls, replacements, redirects, session, client, location, pending: () => { storage.setItem('meteo-pulse-google-pending', String(Date.now())); storage.setItem('meteo-pulse-google-code-verifier', 'verifier') } }
}

test('Google uses official provider, root redirect and PKCE navigation without requiring password or captcha', async () => {
  const f = fixture(); await f.flow.start()
  assert.deepEqual(f.calls[0], { provider: 'google', options: { redirectTo: 'https://meteo.example/?oauth=google', skipBrowserRedirect: true } })
  assert.deepEqual(f.redirects, ['https://auth.example/authorize'])
  assert.equal(f.published.length, 0)
})
test('flag disabled blocks provider navigation', async () => {
  const f = fixture(undefined, false)
  await assert.rejects(f.flow.start(), /GOOGLE_DISABLED/)
  assert.equal(f.calls.length, 0)
})
test('callback exchanges once, scrubs URL and publishes the existing account without modifying settings', async () => {
  const f = fixture('https://meteo.example/?oauth=google&code=secret&lang=bg'); f.pending()
  const first = f.flow.consume(), second = f.flow.consume()
  assert.equal(first, second)
  assert.equal(await first, true)
  assert.deepEqual(f.calls, ['secret'])
  assert.deepEqual(f.published, [f.session])
  assert.deepEqual(f.replacements, ['/?lang=bg'])
  assert.equal(f.values.size, 0)
})
for (const [query, error] of [['error=access_denied&error_description=private', 'GOOGLE_DENIED'], ['', 'GOOGLE_INTERRUPTED'], ['code=bad', 'GOOGLE_CALLBACK_FAILED']]) {
  test(`handles ${error}, clears PKCE and leaves previous session untouched`, async () => {
    const f = fixture(`https://meteo.example/?oauth=google&${query}`); f.pending()
    f.client.exchangeCodeForSession = async () => ({ error: new Error('private provider error') })
    await assert.rejects(f.flow.consume(), new RegExp(error))
    assert.equal(f.published.length, 0); assert.equal(f.values.size, 0)
    assert.deepEqual(f.replacements, ['/'])
  })
}
test('missing verifier transaction and expired attempts fail without exchange', async () => {
  for (const age of [null, 11 * 60000]) {
    const f = fixture('https://meteo.example/?oauth=google&code=code')
    if (age) f.values.set('meteo-pulse-google-pending', String(Date.now() - age))
    await assert.rejects(f.flow.consume(), /GOOGLE_INTERRUPTED/)
    assert.equal(f.calls.length, 0)
  }
})
test('manual return after abandoning Google clears pending state and allows another login', async () => {
  const f = fixture(); f.pending()
  await assert.rejects(f.flow.consume(), /GOOGLE_INTERRUPTED/)
  await f.flow.start(); assert.equal(f.redirects.length, 1)
})
test('start network errors leave no transaction and retry works', async () => {
  const f = fixture(), original = f.client.signInWithOAuth
  f.client.signInWithOAuth = async () => { throw new Error('offline') }
  await assert.rejects(f.flow.start(), /offline/); assert.equal(f.values.size, 0)
  f.client.signInWithOAuth = original; await f.flow.start()
  assert.equal(f.redirects.length, 1)
})
test('logout cancels verifier and callback publication can reject stale exchange', async () => {
  const f = fixture('https://meteo.example/?oauth=google&code=code'); f.pending()
  let finish
  f.client.exchangeCodeForSession = () => new Promise(resolve => { finish = resolve })
  const result = f.flow.consume(() => { throw new Error('GOOGLE_CALLBACK_STALE') })
  f.flow.cancel(); assert.equal(f.values.size, 0)
  finish({ data: { session: f.session } })
  await assert.rejects(result, /GOOGLE_CALLBACK_STALE/); assert.equal(f.published.length, 0)
})
test('email recovery fragments do not enter Google flow', async () => {
  const f = fixture('https://meteo.example/#access_token=email&type=recovery')
  assert.equal(await f.flow.consume(), false)
  assert.equal(f.replacements.length, 0)
})
test('SDK cannot persist, auto-refresh or auto-consume a second application session', async () => {
  const source = await readFile(new URL('./auth-client.ts', import.meta.url), 'utf8')
  for (const setting of ['persistSession: true', 'autoRefreshToken: false', 'detectSessionInUrl: false', "flowType: 'pkce'"]) assert.ok(source.includes(setting))
  assert.match(source, /storage: createPKCEStorage\(sessionStorage\)/)
  assert.match(source, /if \(revision !== startedAt\) throw/)
})
test('defaults remain in existing auth.users trigger; OAuth performs no profile writes or email merge', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260930000000_auth_profiles.sql', import.meta.url), 'utf8')
  assert.match(migration, /after insert on auth.users/)
  assert.match(migration, /insert into public.profiles\(user_id\) values \(new.id\)/)
  assert.match(migration, /values \(new.id, 'free', 'active'\)/)
})


test('real Supabase SDK persists PKCE across clients but never persists its session', async () => {
  const values = new Map(), requests = []
  const backing = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }
  const options = { url: 'https://auth.example/auth/v1', headers: { apikey: 'anon' }, storageKey: 'meteo-pulse-google', storage: createPKCEStorage(backing), flowType: 'pkce', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) })
      return new Response(JSON.stringify({ access_token: 'google', refresh_token: 'refresh', expires_in: 3600, token_type: 'bearer', user: { id: 'existing-account' } }), { headers: { 'Content-Type': 'application/json' } })
    } }
  const first = new GoTrueClient(options)
  const result = await first.signInWithOAuth({ provider: 'google', options: { redirectTo: 'https://meteo.example/?oauth=google', skipBrowserRedirect: true } })
  assert.equal(result.error, null)
  const authorize = new URL(result.data.url)
  assert.equal(authorize.searchParams.get('code_challenge_method'), 's256')
  assert.ok(authorize.searchParams.get('code_challenge'))
  assert.ok(values.has('meteo-pulse-google-code-verifier'))
  await first.dispose()
  const second = new GoTrueClient(options)
  try {
    const exchange = await second.exchangeCodeForSession('auth-code')
    assert.equal(exchange.error, null)
    assert.equal(exchange.data.session.user.id, 'existing-account')
    assert.ok(requests[0].url.includes('grant_type=pkce'))
    assert.equal(requests[0].body.auth_code, 'auth-code')
    assert.ok(requests[0].body.code_verifier)
    assert.equal(values.size, 0)
    assert.equal((await second.getSession()).data.session, null)
  } finally { await second.dispose() }
})
