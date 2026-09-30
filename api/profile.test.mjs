import test from 'node:test'
import assert from 'node:assert/strict'
import { authenticate, publicProfile, validDisplayName } from './profile-core.js'

test('profile only exposes safe user-owned and entitlement fields', () => {
  assert.deepEqual(publicProfile({ id: 'user-1', email: 'a@example.com' }, { display_name: 'Ana', secret: 'no' }, { plan: 'free', permissions: [] }), { id: 'user-1', email: 'a@example.com', name: 'Ana', plan: 'free', permissions: [] })
})
test('profile name validation rejects client attempts to inject profile data', () => {
  assert.equal(validDisplayName('Valid name'), true)
  assert.equal(validDisplayName({ name: 'x', plan: 'pro' }), false)
  assert.equal(validDisplayName('x'.repeat(81)), false)
})
test('server rejects missing and invalid sessions', async () => {
  assert.equal(await authenticate('https://example.supabase.co', 'anon', undefined), null)
  const user = await authenticate('https://example.supabase.co', 'anon', 'Bearer valid', async (_url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer valid')
    return { ok: true, json: async () => ({ id: 'user-1' }) }
  })
  assert.deepEqual(user, { id: 'user-1' })
  assert.equal(await authenticate('x', 'anon', 'Bearer expired', async () => ({ ok: false })), null)
})
