import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import test from 'node:test'

test('Vercel api directory contains eleven endpoints including the disabled operator function, below the Hobby limit', async () => {
  const files = await readdir(new URL('../../api/', import.meta.url), { recursive: true })
  assert.deepEqual(files.sort(), ['activity.ts', 'admin-management.ts', 'admin.ts', 'alerts.ts', 'planner.ts', 'profile.ts', 'push-key-diagnostics.ts', 'push-operator.ts', 'push.ts', 'weather-advice.ts', 'weather-chat.ts'])
  assert.ok(files.length < 12)
})
