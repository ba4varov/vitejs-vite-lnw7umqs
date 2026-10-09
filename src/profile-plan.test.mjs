import test from 'node:test'
import assert from 'node:assert/strict'
import { profilePlanLabel } from './profile-plan.js'

for (const [lang, free, pro, loading, unavailable] of [
  ['bg', 'Безплатен', 'Pro план', 'Зареждане…', 'Планът не е наличен'],
  ['en', 'Free', 'Pro plan', 'Loading…', 'Plan unavailable'],
]) {
  test(`${lang}: server Free and Pro labels`, () => {
    assert.equal(profilePlanLabel('free', lang), free)
    assert.equal(profilePlanLabel('pro', lang), pro)
  })
  test(`${lang}: pending, failed and unknown plans never default to Free`, () => {
    for (const plan of [undefined, null, 'free', 'pro', 'unknown']) {
      assert.equal(profilePlanLabel(plan, lang, true), loading)
      assert.equal(profilePlanLabel(plan, lang, false, true), unavailable)
    }
    for (const plan of [undefined, null, 'unknown']) assert.equal(profilePlanLabel(plan, lang), unavailable)
  })
}
