import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { adminText } from './admin-i18n.js'
test('both languages cover plan, provider, health and copy labels',()=>{
  for(const lang of ['bg','en']) for(const key of ['free','pro','email','google','copy','copyFailed','lastSuccess','scope','available','problem']) assert.ok(adminText[lang][key])
  assert.notEqual(adminText.bg.free,'free'); assert.notEqual(adminText.bg.google,'google')
})
test('favorites SQL checks membership before reading and exposes only an authenticated read',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261008010000_admin_user_favorites.sql',import.meta.url),'utf8')
  assert.ok(sql.indexOf('raise insufficient_privilege')<sql.indexOf('from public.favorite_places'))
  assert.match(sql,/security definer set search_path = ''/)
  assert.match(sql,/where f.user_id = selected_id/)
  assert.match(sql,/revoke all .* from public, anon, authenticated, service_role/)
  assert.match(sql,/grant execute .* to authenticated/)
})
