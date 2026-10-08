import assert from 'node:assert/strict'
import test from 'node:test'
import { reverseGeocodeLocation } from './reverse-geocoding.js'

const responses = {
  bg: {
    address: {
      city: 'Варна',
      state: 'Област Варна',
      country: 'България',
      road: 'булевард „Владислав Варненчик“',
      house_number: '267'
    }
  },
  en: {
    address: {
      city: 'Varna',
      state: 'Varna',
      country: 'Bulgaria',
      road: 'Vladislav Varnenchik Boulevard',
      house_number: '267'
    }
  }
}

test('current-location heading, metadata, and address follow each UI language', async () => {
  const calls = []
  const fetcher = async url => {
    calls.push(url)
    const language = new URL(url).searchParams.get('accept-language')
    return { ok: true, json: async () => responses[language] }
  }

  const bulgarian = await reverseGeocodeLocation(43.2141, 27.9147, 'bg', { fetcher })
  const english = await reverseGeocodeLocation(43.2141, 27.9147, 'en', { fetcher })
  const bulgarianAgain = await reverseGeocodeLocation(43.2141, 27.9147, 'bg', { fetcher })

  assert.deepEqual(bulgarian, {
    name: 'Варна', region: 'Област Варна', country: 'България', address: 'булевард „Владислав Варненчик“ 267'
  })
  assert.deepEqual(english, {
    name: 'Varna', region: 'Varna', country: 'Bulgaria', address: 'Vladislav Varnenchik Boulevard 267'
  })
  assert.deepEqual(bulgarianAgain, bulgarian)
  assert.equal(calls.length, 3)
  for (const call of calls) {
    const params = new URL(call).searchParams
    assert.equal(params.get('format'), 'jsonv2')
    assert.equal(params.get('addressdetails'), '1')
    assert.equal(params.get('namedetails'), '1')
  }
})

test('reverse geocoding uses localized neighborhood fallback without changing coordinates', async () => {
  const fetcher = async url => {
    const parsed = new URL(url)
    assert.equal(parsed.searchParams.get('lat'), '48.8566')
    assert.equal(parsed.searchParams.get('lon'), '2.3522')
    return { ok: true, json: async () => ({ address: { town: 'Paris', suburb: 'Montmartre', country: 'France' } }) }
  }

  const location = await reverseGeocodeLocation(48.8566, 2.3522, 'en', { fetcher })
  assert.deepEqual(location, { name: 'Paris', region: null, country: 'France', address: 'Montmartre' })
})
