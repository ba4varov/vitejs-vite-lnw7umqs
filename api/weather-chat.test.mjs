import assert from 'node:assert/strict'
import test from 'node:test'
import { ALLOWED_INTENTS, findDailyForecast, geminiUnderstandingError, parseUnderstanding, validateChatInput } from './weather-chat-core.js'

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

const understanding = { intent: 'rain', requestedCity: null, timeScope: 'next_12h', targetDate: null, needsClarification: false, clarificationQuestion: null }

test('normalizes Gemini JSON without requestedCity without mutating it', () => {
  const input = { ...understanding }
  delete input.requestedCity
  assert.equal(parseUnderstanding(input, 'bg').requestedCity, null)
  assert.equal(Object.hasOwn(input, 'requestedCity'), false)
})

test('normalizes Gemini JSON without clarificationQuestion', () => {
  const input = { ...understanding }
  delete input.clarificationQuestion
  assert.equal(parseUnderstanding(input, 'bg').clarificationQuestion, null)
})

test('accepts umbrella and clothing question classifications', () => {
  assert.equal(parseUnderstanding(understanding, 'bg').intent, 'rain', 'Да взема ли чадър?')
  assert.equal(parseUnderstanding({ ...understanding, intent: 'clothing' }, 'bg').intent, 'clothing', 'Как да се облека?')
})

test('accepts a specific ISO date for Априлци', () => {
  const parsed = parseUnderstanding({ ...understanding, intent: 'other_city', requestedCity: 'Априлци', timeScope: 'specific_date', targetDate: '2026-09-06' }, 'bg')
  assert.deepEqual([parsed.requestedCity, parsed.timeScope, parsed.targetDate], ['Априлци', 'specific_date', '2026-09-06'])
})

test('rejects invalid Gemini responses strictly', () => {
  assert.equal(parseUnderstanding({ ...understanding, intent: 'invented' }, 'bg'), null)
  assert.equal(parseUnderstanding({ ...understanding, targetDate: '2026-02-30' }, 'bg'), null)
  assert.equal(parseUnderstanding({ ...understanding, unexpected: true }, 'bg'), null)
})

test('reports a date outside the available 15-day forecast by exact ISO lookup', () => {
  const days = Array.from({ length: 15 }, (_, i) => ({ date: `2026-09-${String(i + 2).padStart(2, '0')}` }))
  assert.equal(findDailyForecast(days, '2026-09-20'), null)
  assert.deepEqual(findDailyForecast(days, '2026-09-06'), { date: '2026-09-06' })
})

test('distinguishes invalid and unavailable Gemini responses', () => {
  assert.match(geminiUnderstandingError('invalid-json'), /невалиден отговор/)
  assert.match(geminiUnderstandingError('upstream-http'), /временно не е достъпен/)
})
