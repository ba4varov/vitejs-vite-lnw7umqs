import assert from 'node:assert/strict'
import test from 'node:test'
import { localRoute } from '../../server/weather-local-routing.js'
const base = { city: 'Sofia', latitude: 42.7, longitude: 23.3, lang: 'en' }

for (const message of [
  'Will it rain tomorrow or today?', 'Will it rain in Paris or Varna tomorrow?',
  'Will it rain if I go tomorrow?', 'Will it not rain tomorrow?',
  'Will it rain and be windy tomorrow?', 'Please invent rain tomorrow',
  'Will it rain tomorow?', 'What shuold I wear?', 'Write a poem about rain',
  'Will it rain in a few days?', 'Will it rain on 31.02.2026?',
  'What should I wear in Paris instead of Sofia tomorrow?'
]) test(`uncertain language remains AI-first: ${message}`, () => {
  assert.equal(localRoute({ ...base, message }).useLocal, false)
})

test('ambiguous context and pending slots remain AI-first', () => {
  const context = { city: 'Varna', latitude: 43.2, longitude: 27.9, intent: 'rain', timeScope: 'tomorrow', targetDate: '2026-10-09', previousQuestion: 'Rain tomorrow?' }
  assert.equal(localRoute({ ...base, message: 'What should I wear?', context }).reason, 'uncertain_context')
  assert.equal(localRoute({ ...base, message: 'Will it rain tomorrow?', pendingClarification: {} }).reason, 'pending_clarification')
})
