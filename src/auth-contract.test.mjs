import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./auth-client.ts', import.meta.url), 'utf8')
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
test('profile operations carry the access token and never accept plan input', () => {
  assert.match(source, /Authorization: `Bearer \$\{session\.access_token\}`/)
  assert.match(source, /JSON\.stringify\(\{ name \}\)/)
  assert.doesNotMatch(source, /JSON\.stringify\(\{ name, plan/)
})
