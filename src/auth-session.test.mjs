import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { createPlacesSessionGuard } from './places-session-guard.js'

const original = await readFile(new URL('./auth-client.ts', import.meta.url), 'utf8')
const captcha = await readFile(new URL('./captcha-payload.js', import.meta.url), 'utf8')
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
let moduleId = 0
const session = (seconds = 3600, token = 'old') => ({ access_token: token, refresh_token: `refresh-${token}`, expires_at: Math.floor(Date.now() / 1000) + seconds, user: { id: 'account' } })

async function setup(t, stored = null, google = false) {
  const values = new Map(stored ? [['meteo-pulse-auth', JSON.stringify(stored)]] : [])
  const pending = new Map()
  const location = { href: 'https://meteo.example/', origin: 'https://meteo.example', assign: () => {} }
  const window = new EventTarget()
  window.location = location
  const document = new EventTarget()
  document.visibilityState = 'visible'
  t.mock.method(globalThis, 'setTimeout', globalThis.setTimeout)
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 })
  const descriptors = new Map()
  for (const [name, value] of Object.entries({ window, document, location, history: { replaceState: (_a, _b, next) => { location.href = `https://meteo.example${next}` } }, sessionStorage: { getItem: key => pending.get(key) ?? null, setItem: (key, value) => pending.set(key, value), removeItem: key => pending.delete(key) }, navigator: { locks: { request: async (_name, callback) => callback() } }, localStorage: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  } })) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { value, configurable: true })
  }
  t.after(() => { for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] } })
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline') })
  const source = stripTypeScriptTypes(original.replace("'@supabase/auth-js'", JSON.stringify(import.meta.resolve('@supabase/auth-js'))).replace("'./google-oauth.js'", JSON.stringify(new URL('./google-oauth.js', import.meta.url).href)).replace("'./captcha-payload.js'", JSON.stringify(dataUrl(captcha))).replaceAll('import.meta.env', `({ VITE_GOOGLE_AUTH_ENABLED: '${google}', VITE_SUPABASE_URL: 'https://auth.example', VITE_SUPABASE_ANON_KEY: 'anon' })`))
  const auth = await import(`${dataUrl(source)}#${moduleId++}`)
  let active
  auth.subscribeSession(value => { active = value })
  return { auth, fetch, values, pending, location, window, document, active: () => active, response: (data, status = 200) => ({ ok: status < 400, status, json: async () => data }), flush: async () => { for (let i = 0; i < 12; i++) await Promise.resolve() } }
}

test('valid stored sessions restore without a network request', async t => {
  const f = await setup(t)
  const valid = session()
  f.values.set('meteo-pulse-auth', JSON.stringify(valid))
  assert.deepEqual(await f.auth.restoreSession(), valid)
  assert.equal(f.fetch.mock.callCount(), 0)
})

test('profile GET bypasses cache and observes plan changes with the same bearer token', async t => {
  const f = await setup(t)
  const active = session()
  let plan = 'free'
  f.fetch.mock.mockImplementation(async () => f.response({ plan }))
  for (const nextPlan of ['free', 'pro', 'free']) {
    plan = nextPlan
    assert.equal((await f.auth.profileRequest(active)).plan, nextPlan)
  }
  for (const call of f.fetch.mock.calls) {
    const [url, options] = call.arguments
    assert.equal(url, '/api/profile')
    assert.equal(options.method, 'GET')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.headers.Authorization, `Bearer ${active.access_token}`)
  }
  f.fetch.mock.mockImplementation(async () => f.response({ error: 'PROFILE_FAILED' }, 503))
  await assert.rejects(f.auth.profileRequest(active), /PROFILE_FAILED/)
})

test('refresh starts before expiry and publishes the rotated token', async t => {
  const f = await setup(t)
  f.auth.saveSession(session(120))
  const renewed = session(3600, 'new')
  f.fetch.mock.mockImplementation(async () => f.response(renewed))
  t.mock.timers.tick(59_000); await f.flush()
  assert.equal(f.fetch.mock.callCount(), 0)
  t.mock.timers.tick(1000); await f.flush()
  assert.equal(f.fetch.mock.callCount(), 1)
  assert.equal(f.fetch.mock.calls[0].arguments[0], 'https://auth.example/auth/v1/token?grant_type=refresh_token')
  assert.deepEqual(f.active(), renewed)
})

for (const status of [0, 429, 500, 503]) test(`temporary refresh failure (${status}) retains session and retries`, async t => {
  const f = await setup(t)
  const existing = session(30)
  f.values.set('meteo-pulse-auth', JSON.stringify(existing))
  if (status) f.fetch.mock.mockImplementation(async () => f.response({ message: 'temporary' }, status))
  assert.deepEqual(await f.auth.restoreSession(), existing)
  assert.deepEqual(JSON.parse(f.values.get('meteo-pulse-auth')), existing)
  const renewed = session(3600, 'new')
  f.fetch.mock.mockImplementation(async () => f.response(renewed))
  t.mock.timers.tick(30_000); await f.flush()
  assert.deepEqual(f.active(), renewed)
})

test('explicit invalid refresh token clears the session', async t => {
  const f = await setup(t)
  f.values.set('meteo-pulse-auth', JSON.stringify(session(0)))
  f.fetch.mock.mockImplementation(async () => f.response({ error_code: 'refresh_token_not_found' }, 400))
  assert.equal(await f.auth.restoreSession(), null)
  assert.equal(f.values.has('meteo-pulse-auth'), false)
})

test('concurrent restores share one refresh', async t => {
  const f = await setup(t)
  f.values.set('meteo-pulse-auth', JSON.stringify(session(0)))
  let resolve
  f.fetch.mock.mockImplementation(() => new Promise(r => { resolve = r }))
  const first = f.auth.restoreSession(), second = f.auth.restoreSession()
  assert.equal(f.fetch.mock.callCount(), 1)
  resolve(f.response(session(3600, 'new')))
  assert.deepEqual(await first, await second)
})

test('logout is immediate, tolerates failure, and late refresh cannot restore it', async t => {
  const f = await setup(t)
  const existing = session(0)
  f.values.set('meteo-pulse-auth', JSON.stringify(existing))
  let resolve
  f.fetch.mock.mockImplementation(url => url.includes('/logout') ? Promise.reject(new Error('offline')) : new Promise(r => { resolve = r }))
  const restoring = f.auth.restoreSession()
  const logout = f.auth.signOut(existing)
  assert.equal(f.active(), null)
  assert.equal(f.values.has('meteo-pulse-auth'), false)
  await logout
  resolve(f.response(session(3600, 'new')))
  await restoring
  assert.equal(f.active(), null)
})

test('storage events synchronize login, token rotation, logout and clear without writing back', async t => {
  const f = await setup(t)
  const emit = key => { const event = new Event('storage'); event.key = key; f.window.dispatchEvent(event) }
  const loggedIn = session()
  f.values.set('meteo-pulse-auth', JSON.stringify(loggedIn)); emit('meteo-pulse-auth')
  assert.deepEqual(f.active(), loggedIn)
  const rotated = session(3600, 'new')
  f.values.set('meteo-pulse-auth', JSON.stringify(rotated)); emit('meteo-pulse-auth')
  assert.deepEqual(f.active(), rotated)
  f.values.delete('meteo-pulse-auth'); emit('meteo-pulse-auth')
  assert.equal(f.active(), null)
  f.auth.saveSession(loggedIn); f.values.clear(); emit(null)
  assert.equal(f.active(), null)
  t.mock.timers.tick(3_600_000); await f.flush()
  assert.equal(f.fetch.mock.callCount(), 0)
})

test('hidden tabs pause refresh and resume when visible', async t => {
  const f = await setup(t)
  f.auth.saveSession(session(120))
  f.document.visibilityState = 'hidden'; f.document.dispatchEvent(new Event('visibilitychange'))
  t.mock.timers.tick(120_000); await f.flush()
  assert.equal(f.fetch.mock.callCount(), 0)
  f.fetch.mock.mockImplementation(async () => f.response(session(3600, 'new')))
  f.document.visibilityState = 'visible'; f.document.dispatchEvent(new Event('visibilitychange'))
  t.mock.timers.tick(0); await f.flush()
  assert.equal(f.fetch.mock.callCount(), 1)
})

test('token updates preserve in-flight favorite city operations for the same account', () => {
  const guard = createPlacesSessionGuard()
  const { ticket } = guard.changeSession('account')
  assert.equal(guard.changeSession('account').accountChanged, false)
  assert.equal(guard.isCurrent(ticket), true)
  guard.changeSession(null)
  assert.equal(guard.isCurrent(ticket), false)
})

test('a refresh waiting for another tab reuses its rotated token without another request', async t => {
  const f = await setup(t)
  const old = session(0), renewed = session(3600, 'other-tab')
  f.values.set('meteo-pulse-auth', JSON.stringify(old))
  let release
  navigator.locks.request = async (_key, callback) => { await new Promise(resolve => { release = resolve }); return callback() }
  const restoring = f.auth.restoreSession()
  f.values.set('meteo-pulse-auth', JSON.stringify(renewed))
  release()
  assert.deepEqual(await restoring, renewed)
  assert.equal(f.fetch.mock.callCount(), 0)
})

test('a hung logout has a timeout signal and does not delay local logout', async t => {
  const f = await setup(t)
  const existing = session()
  f.auth.saveSession(existing)
  let reject
  f.fetch.mock.mockImplementation((_url, options) => {
    assert.ok(options.signal instanceof AbortSignal)
    return new Promise((_resolve, rejectRequest) => { reject = rejectRequest })
  })
  const logout = f.auth.signOut(existing)
  assert.equal(f.active(), null)
  reject(new DOMException('timeout', 'TimeoutError'))
  await assert.doesNotReject(logout)
})

test('storage-disabled browsers can refresh the in-memory session', async t => {
  const f = await setup(t)
  localStorage.getItem = localStorage.setItem = () => { throw new Error('blocked') }
  f.auth.saveSession(session(0))
  f.fetch.mock.mockImplementation(async () => f.response(session(3600, 'new')))
  assert.equal((await f.auth.restoreSession()).access_token, 'new')
})


test('real Google callback publishes to shared session, repeat login retains user ID and logout clears it', async t => {
  const existing = session()
  const f = await setup(t, existing, true)
  await f.auth.restoreSession()
  await f.auth.signInWithGoogle()
  f.location.href = 'https://meteo.example/?oauth=google&code=code'
  const google = { ...session(3600, 'google'), expires_in: 3600, token_type: 'bearer', provider_token: 'never-store-google-token' }
  f.fetch.mock.mockImplementation(async () => new Response(JSON.stringify(google), { headers: { 'Content-Type': 'application/json' } }))
  assert.equal(await f.auth.consumeGoogleCallback(), true)
  assert.equal(f.active().user.id, existing.user.id)
  assert.equal(f.active().access_token, 'google')
  assert.deepEqual(JSON.parse(f.values.get('meteo-pulse-auth')), JSON.parse(JSON.stringify(f.active())))
  assert.equal(f.pending.size, 0)
  assert.equal(f.active().provider_token, undefined)
  assert.ok(!f.values.get('meteo-pulse-auth').includes('never-store-google-token'))
  await f.auth.signOut(f.active())
  assert.equal(f.active(), null)
  assert.equal(f.values.has('meteo-pulse-auth'), false)
})
test('logout while Google exchange is in flight cannot resurrect shared session', async t => {
  const f = await setup(t, null, true)
  f.auth.saveSession(session())
  await f.auth.signInWithGoogle()
  f.location.href = 'https://meteo.example/?oauth=google&code=code'
  let resolve
  f.fetch.mock.mockImplementation(url => url.includes('/logout') ? Promise.reject(new Error('offline')) : new Promise(r => { resolve = r }))
  const exchanging = f.auth.consumeGoogleCallback()
  for (let i = 0; i < 50 && !resolve; i++) await Promise.resolve()
  assert.ok(resolve)
  await f.auth.signOut(f.active())
  resolve(new Response(JSON.stringify({ ...session(3600, 'late-google'), expires_in: 3600, token_type: 'bearer' }), { headers: { 'Content-Type': 'application/json' } }))
  await assert.rejects(exchanging, /GOOGLE_CALLBACK_STALE/)
  assert.equal(f.active(), null)
  assert.equal(f.pending.size, 0)
})
test('Google denial preserves an existing shared session and scrubs callback error', async t => {
  const f = await setup(t, null, true)
  const existing = session(); f.auth.saveSession(existing)
  await f.auth.signInWithGoogle()
  f.location.href = 'https://meteo.example/?oauth=google&error=access_denied'
  await assert.rejects(f.auth.consumeGoogleCallback(), /GOOGLE_DENIED/)
  assert.deepEqual(f.active(), existing)
  assert.equal(f.location.href, 'https://meteo.example/')
})
