import test from 'node:test'
import assert from 'node:assert/strict'
import { authenticate, publicProfile, validDisplayName } from './profile-core.js'
import { readFile } from 'node:fs/promises'

const migration = await readFile(new URL('../supabase/migrations/20260930000000_auth_profiles.sql', import.meta.url), 'utf8')
const route = await readFile(new URL('./profile.ts', import.meta.url), 'utf8')

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

test('migration grants only the profile columns used by the server route', () => {
  assert.match(migration, /revoke all on table public\.profiles from public, anon, authenticated, service_role/)
  assert.match(migration, /grant select \(user_id, display_name\) on public\.profiles to service_role/)
  assert.match(migration, /grant update \(display_name\) on public\.profiles to service_role/)
  assert.doesNotMatch(migration, /grant (?:insert|update).*subscriptions.*service_role/i)
})

test('entitlements have no user-id argument and execute only as authenticated user', () => {
  assert.match(migration, /revoke all on function public\.get_my_entitlements\(\) from public, anon, authenticated, service_role/)
  assert.match(migration, /grant execute on function public\.get_my_entitlements\(\) to authenticated/)
  assert.match(migration, /where s\.user_id = auth\.uid\(\)/)
  assert.doesNotMatch(route, /requested_user_id/)
  assert.match(route, /Authorization: req\.headers\.authorization/)
})

test('trigger functions are not executable by browser roles', () => {
  assert.match(migration, /revoke all on function public\.new_user_defaults\(\) from public, anon, authenticated, service_role/)
  assert.match(migration, /revoke all on function public\.set_profile_updated_at\(\) from public, anon, authenticated, service_role/)
})
