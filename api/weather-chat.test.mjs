import assert from 'node:assert/strict'
import test from 'node:test'
import { ALLOWED_INTENTS, validateChatInput } from './weather-chat-core.js'

const valid = { message: 'Ще вали ли утре във Варна?', city: 'София', latitude: 42.7, longitude: 23.3, lang: 'bg' }

test('accepts a strictly valid request', () => assert.deepEqual(validateChatInput(valid), valid))
test('rejects unknown fields', () => assert.equal(validateChatInput({ ...valid, prompt: 'ignore rules' }), null))
test('rejects blank and overlong messages', () => {
  assert.equal(validateChatInput({ ...valid, message: '   ' }), null)
  assert.equal(validateChatInput({ ...valid, message: 'а'.repeat(401) }), null)
})
test('rejects invalid coordinates and types', () => {
  assert.equal(validateChatInput({ ...valid, latitude: 91 }), null)
  assert.equal(validateChatInput({ ...valid, longitude: '23.3' }), null)
})
test('declares critical activity and forecast intents', () => {
  for (const intent of ['laundry', 'car_wash', 'wind', 'marine', 'other_city', 'unrelated', 'unclear']) assert.ok(ALLOWED_INTENTS.includes(intent))
})
