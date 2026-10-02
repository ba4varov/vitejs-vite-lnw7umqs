import test from 'node:test'
import assert from 'node:assert/strict'
import { localizeAccountPlaces } from './account-place-localization.js'

test('English UI login never applies a Bulgarian stored default place as its display label', async () => {
  const stored = [{
    id: 'varna-favorite',
    name: 'Варна',
    region: 'Варна',
    country: 'България',
    lat: 43.2141,
    lon: 27.9147,
    isFavorite: true
  }]
  const labels = {
    en: { name: 'Varna', region: 'Varna', country: 'Bulgaria' },
    bg: { name: 'Варна', region: 'Варна', country: 'България' }
  }
  let language = 'en'

  const result = await localizeAccountPlaces(stored, 'varna-favorite', () => language,
    async (place, requestedLanguage) => ({ ...place, ...labels[requestedLanguage] }))

  assert.deepEqual(
    [result.preferred.name, result.preferred.region, result.preferred.country],
    ['Varna', 'Varna', 'Bulgaria']
  )
  assert.equal(result.localizedPlaces[0], result.preferred, 'the selected default comes from the localized list')
  assert.deepEqual([result.preferred.lat, result.preferred.lon], [43.2141, 27.9147])
  assert.equal(result.preferred.id, 'varna-favorite')
  assert.equal(result.preferred.isFavorite, true)
  assert.equal(stored[0].name, 'Варна', 'the account record is not rewritten')
})

test('account localization retries when the UI language changes in flight', async () => {
  const stored = [{ id: 'varna', name: 'Varna', lat: 43.2141, lon: 27.9147 }]
  let language = 'en'
  const requestedLanguages = []

  const result = await localizeAccountPlaces(stored, 'varna', () => language, async (place, requestedLanguage) => {
    requestedLanguages.push(requestedLanguage)
    if (requestedLanguage === 'en') language = 'bg'
    return { ...place, name: requestedLanguage === 'en' ? 'Varna' : 'Варна' }
  })

  assert.deepEqual(requestedLanguages, ['en', 'bg'])
  assert.equal(result.preferred.name, 'Варна')
})
