import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import test from 'node:test'

test('Vercel api directory contains only the six public endpoints, below the Hobby function limit', async () => {
  const files = await readdir(new URL('../../api/', import.meta.url), { recursive: true })
  assert.deepEqual(files.sort(), ['activity.ts', 'admin-management.ts', 'admin.ts', 'profile.ts', 'weather-advice.ts', 'weather-chat.ts'])
  assert.ok(files.length < 12)
})
