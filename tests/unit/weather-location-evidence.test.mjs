import assert from 'node:assert/strict'
import test from 'node:test'
import { collectLocationCandidates, oneEditApart, groundLocation, normalizePlaceName } from '../../server/weather-location-evidence.js'
import { connectorVariants, locationCorpus } from '../helpers/location-language-corpus.mjs'

for (const [base, alphabet] of [['във', 'уое'], ['in', 'aeo'], ['near', 'iea']]) for (const word of connectorVariants(base, alphabet)) test(`generic edit/transposition grammar ${base}/${word}`, () => {
  assert.equal(oneEditApart(word, base), true)
})
for (const { lang, place, message, variation } of locationCorpus()) test(`generated place candidates ${lang}/${place.name}/${variation}`, () => {
  const candidates = collectLocationCandidates(message, lang)
  assert.ok(candidates.length <= 3)
  assert.ok(candidates.some(item => normalizePlaceName(item.text) === normalizePlaceName(place.name)))
})

test('a single geographically verified mention overrides a null/inherited city', async () => {
  const place = { name: 'Varna', latitude: 43.2, longitude: 27.9, timezone: 'Europe/Sofia' }
  const result = await groundLocation([{ text: 'Varna', strength: 'connector' }], null, false, async () => place)
  assert.equal(result.status, 'verified')
  assert.equal(result.place, place)
})

test('several real places require clarification unless explicit semantics chooses a verified one', async () => {
  const places = { Varna: { name: 'Varna', latitude: 43.2, longitude: 27.9, timezone: 'UTC' }, Sofia: { name: 'Sofia', latitude: 42.7, longitude: 23.3, timezone: 'UTC' } }
  const evidence = Object.keys(places).map(text => ({ text, strength: 'syntax' }))
  const resolve = async name => places[name]
  assert.equal((await groundLocation(evidence, null, false, resolve)).status, 'ambiguous')
  const chosen = await groundLocation(evidence, 'Varna', true, resolve)
  assert.equal(chosen.status, 'verified')
  assert.equal(chosen.place, places.Varna)
})

test('strong unsupported place evidence is not a license to inherit context', async () => {
  assert.equal((await groundLocation([{ text: 'Unknown', strength: 'connector' }], null, false, async () => null)).status, 'unverified')
})

for (const text of ['Will it rain tomorrow?', 'Как да се облека?', 'Next Sunday?', 'What should I wear?', 'Вятър 31.2 км/ч силен ли е?']) test(`ordinary weather/time text is not a place: ${text.length}`, () => {
  assert.deepEqual(collectLocationCandidates(text, /[а-я]/iu.test(text) ? 'bg' : 'en'), [])
})


test('a real place sharing an unanchored proper name does not silently replace context', async () => {
  const result = await groundLocation([{ text: 'Reading', strength: 'name' }], null, false, async () => ({ name: 'Reading', latitude: 51.45, longitude: -0.97, timezone: 'Europe/London' }))
  assert.equal(result.status, 'ambiguous')
})

for (const suffix of ['how should I dress', 'can I walk', 'will it rain', 'what is the temperature']) test(`semantic subspan survives rejected surrounding prose: ${suffix}`, async () => {
  const place = { name: 'Lake District', latitude: 54.5, longitude: -3.1667 }
  const evidence = [{ text: `Lake District ${suffix}`, strength: 'syntax', anchored: true }]
  const resolve = async query => query === place.name ? place : null
  const result = await groundLocation(evidence, place.name, true, resolve)
  assert.equal(result.status, 'verified')
  assert.equal(result.place, place)
})

test('a semantic subspan cannot conceal independently conflicting geography', async () => {
  const places = { 'Lake District': { latitude: 54.5, longitude: -3.1667 }, Paris: { latitude: 48.85, longitude: 2.35 } }
  const result = await groundLocation([{ text: 'Lake District how should I dress', strength: 'syntax' }, { text: 'Paris', strength: 'name' }], 'Lake District', true, async query => places[query] ?? null)
  assert.equal(result.status, 'ambiguous')
})

for (const [lang, place, clauses] of [
  ['bg', 'Долна баня', ['как да се облека', 'може ли да се разходя', 'ще вали ли', 'колко градуса ще е']],
  ['en', 'Barton under Needwood', ['what should I wear', 'can I walk', 'will it rain', 'how cold will it be']]
]) for (const clause of clauses) for (const lowercase of [false, true]) test(`locative extraction ends before a clause ${lang}/${clause}/${lowercase}`, () => {
  const name = lowercase ? place.toLowerCase() : place
  const message = lang === 'bg' ? `Утре ще съм в ${name} ${clause}` : `Tomorrow I will be in ${name} ${clause}`
  const evidence = collectLocationCandidates(message, lang)
  assert.ok(evidence.some(candidate => candidate.text === name && candidate.anchored))
  assert.ok(evidence.every(candidate => !candidate.text.includes(clause)))
})

test('ambiguous semantic geocoding is never treated as a confirmed subspan', async () => {
  const result = await groundLocation([{ text: 'Springfield how should I dress', strength: 'syntax' }], 'Springfield', true, async name => name === 'Springfield' ? { ambiguous: true, name, options: ['A', 'B'] } : null)
  assert.notEqual(result.status, 'verified')
})

test('a longer verified geographic name is a real conflict, not surrounding prose', async () => {
  const places = { Paris: { latitude: 48.85, longitude: 2.35 }, 'Paris Texas': { latitude: 33.66, longitude: -95.55 } }
  const result = await groundLocation([{ text: 'Paris Texas', strength: 'syntax' }], 'Paris', true, async name => places[name])
  assert.equal(result.status, 'ambiguous')
})
