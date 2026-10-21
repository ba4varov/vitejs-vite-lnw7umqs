import assert from 'node:assert/strict'
import { semanticFixture } from './bobi-language-corpus.mjs'

// Wire response and expected handler outcome are separate contracts.
export function efficiencySemantic(item) {
  return semanticFixture({ intent: item.intent, requestedCity: item.citySource === 'context' ? null : item.place.name,
    citySource: item.citySource ?? 'explicit', timeScope: item.timeScope,
    targetDate: item.timeScope === 'specific_date' ? item.targetDate : null,
    timeSource: item.timeSource ?? 'explicit', turnType: item.context ? 'follow_up' : 'new_question' })
}
export function geminiResponse(semantic) {
  return { model: 'offline-fixture', payload: { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(semantic) }] } }] } }
}
export function checkOutcome(result, expected) {
  const { body, calls } = result
  const errors = []
  const verify = check => { try { check() } catch (error) { errors.push(error.message) } }
  // Clarification responses may expose intent=unclear while preserving the
  // known intent in pendingClarification. Check that semantic snapshot.
  verify(() => assert.equal((body.needsClarification ? body.pendingClarification?.understanding : body)?.intent, expected.intent, 'intent'))
  verify(() => assert.equal(body.needsClarification, expected.needsClarification, 'clarification'))
  const snapshot = body.needsClarification ? body.pendingClarification?.understanding : body
  verify(() => assert.equal(snapshot?.targetDate, expected.targetDate, 'date'))
  verify(() => assert.equal(snapshot?.timeScope, expected.timeScope, 'time scope'))
  verify(() => assert.equal(body.pendingClarification?.missing ?? null, expected.missing ?? null, 'missing field'))
  const weather = calls.filter(url => !url.hostname.startsWith('geocoding-'))
  if (expected.needsClarification) {
    verify(() => assert.equal(weather.length, 0, 'clarification must not fetch weather'))
    verify(() => assert.equal(body.context, undefined, 'no confirmed coordinates on clarification'))
  } else {
    verify(() => assert.equal(body.context?.latitude, expected.place.latitude, 'context latitude'))
    verify(() => assert.equal(body.context?.longitude, expected.place.longitude, 'context longitude'))
    verify(() => assert.ok(weather.some(url => url.hostname === 'api.open-meteo.com'), 'forecast fetched'))
    for (const url of weather) {
      verify(() => assert.equal(Number(url.searchParams.get('latitude')), expected.place.latitude, 'upstream latitude'))
      verify(() => assert.equal(Number(url.searchParams.get('longitude')), expected.place.longitude, 'upstream longitude'))
    }
  }
  assert.deepEqual(errors, [], 'All semantic and geography checks')
}
export const efficiencyExpected = item => ({ intent: item.intent, needsClarification: false,
  timeScope: item.timeScope, targetDate: item.targetDate, place: item.place })
