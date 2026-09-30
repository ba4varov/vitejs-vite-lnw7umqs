import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { authCallbackView } from './auth-flow.js'

const source = await readFile(new URL('./auth-client.ts', import.meta.url), 'utf8')
const payload = await readFile(new URL('./captcha-payload.js', import.meta.url), 'utf8')
const ui = await readFile(new URL('./AuthPanel.tsx', import.meta.url), 'utf8')

test('registration, confirmation resend and password recovery use Supabase Auth endpoints', () => {
  for (const endpoint of ['/signup?redirect_to=', "'/resend'", '/recover?redirect_to=', "'/user'"]) assert.match(source, new RegExp(endpoint.replace(/[?]/g, '\\?')))
  assert.match(ui, /password !== confirmation/)
})
test('login persists a refreshable session and logout revokes and removes it', () => {
  assert.match(source, /grant_type=password/)
  assert.match(source, /grant_type=refresh_token/)
  assert.match(source, /localStorage\.removeItem\(storageKey\)/)
  assert.match(source, /'\/logout'/)
})
test('ordinary login closes without requesting a profile and keeps the authenticated navigation', () => {
  const loginBranch = ui.match(/if \(view === 'login'\)[^\n]+/)?.[0] || ''
  assert.match(loginBranch, /setSession\(active\); changeView\('closed'\)/)
  assert.doesNotMatch(loginBranch, /profileRequest/)
  assert.match(ui, /session \? <>.*openProfile.*t\.profile.*logout.*t\.logout/s)
})
test('only confirmed signup callbacks open the profile automatically', () => {
  const confirmedUser = { email_confirmed_at: '2026-09-30T12:00:00Z' }
  assert.equal(authCallbackView('signup', confirmedUser), 'profile')
  assert.equal(authCallbackView('signup', {}), 'closed')
  assert.equal(authCallbackView('magiclink', confirmedUser), 'closed')
  assert.equal(authCallbackView('invite', confirmedUser), 'closed')
  assert.equal(authCallbackView(undefined, confirmedUser), 'closed')
  assert.equal(authCallbackView('recovery', confirmedUser), 'password')
})
test('restored sessions stay closed and profiles load on profile opening', () => {
  assert.match(ui, /useState<View>\('closed'\)/)
  assert.equal(authCallbackView(undefined, { email_confirmed_at: '2026-09-30T12:00:00Z' }), 'closed')
  assert.match(ui, /const openProfile = async \(\) => .*profileRequest\(session\)/)
})
test('password recovery remains in its dedicated view after a successful update', () => {
  assert.match(ui, /view === 'password'.*updatePassword.*setPassword\(''\).*setMessage\(t\.success\)/)
  assert.doesNotMatch(ui, /view === 'password'.*setView\('profile'\)/)
})
test('profile operations carry the access token and never accept plan input', () => {
  assert.match(source, /Authorization: `Bearer \$\{session\.access_token\}`/)
  assert.match(source, /JSON\.stringify\(\{ name \}\)/)
  assert.doesNotMatch(source, /JSON\.stringify\(\{ name, plan/)
})
test('all password forms use an independent accessible non-submit visibility toggle', () => {
  assert.match(ui, /function PasswordField/)
  assert.match(ui, /type="button" className="password-toggle"/)
  assert.match(ui, /aria-label=\{visible \? hideLabel : showLabel\}/)
  assert.match(ui, /showPassword: 'Покажи паролата', hidePassword: 'Скрий паролата'/)
  assert.match(ui, /showPassword: 'Show password', hidePassword: 'Hide password'/)
  assert.match(ui, /<PasswordField label=\{t\.confirm\}/)
})
test('protected direct REST calls use the GoTrue captcha payload field', () => {
  assert.match(payload, /gotrue_meta_security: \{ captcha_token: captchaToken \}/)
  for (const operation of ['signUp', 'signIn', 'resendConfirmation', 'resetPassword']) {
    assert.match(source, new RegExp(`function ${operation}\\([^)]*captchaToken`))
  }
  assert.doesNotMatch(source, /options\s*:\s*\{\s*captchaToken/)
})
test('UI requires a fresh token and resets it after every protected network attempt', () => {
  assert.match(ui, /captchaConfigured && !captchaToken/)
  assert.match(ui, /if \(captchaSent\).*setCaptchaToken\(null\).*setCaptchaReset/s)
  assert.match(ui, /finally \{ setCaptchaToken\(null\); setCaptchaReset/)
  assert.match(ui, /const changeView = .*setCaptchaToken\(null\)/)
})
