import test from 'node:test'
import assert from 'node:assert/strict'
import { withCaptcha } from './captcha-payload.js'

test('puts a Turnstile token in the direct GoTrue REST payload', () => {
  assert.deepEqual(withCaptcha({ email: 'person@example.com' }, 'one-use-token'), {
    email: 'person@example.com',
    gotrue_meta_security: { captcha_token: 'one-use-token' },
  })
})

test('preserves the rollout behavior when no site token is supplied', () => {
  const body = { email: 'person@example.com' }
  assert.strictEqual(withCaptcha(body), body)
  assert.deepEqual(body, { email: 'person@example.com' })
})
