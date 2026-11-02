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

  const bulgarian = await reverseGeocodeLocation(43.2141, 27.9147, 'bg', { fetcher, accuracy: 25 })
  const english = await reverseGeocodeLocation(43.2141, 27.9147, 'en', { fetcher, accuracy: 25 })
  const bulgarianAgain = await reverseGeocodeLocation(43.2141, 27.9147, 'bg', { fetcher, accuracy: 25 })

  assert.deepEqual(bulgarian, {
    name: 'Варна', region: 'Област Варна', country: 'България', address: 'булевард „Владислав Варненчик“ 267', approximateLocation: null
  })
  assert.deepEqual(english, {
    name: 'Varna', region: 'Varna', country: 'Bulgaria', address: 'Vladislav Varnenchik Boulevard 267', approximateLocation: null
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

  const location = await reverseGeocodeLocation(48.8566, 2.3522, 'en', { fetcher, accuracy: 25 })
  assert.deepEqual(location, { name: 'Paris', region: null, country: 'France', address: null, approximateLocation: 'Montmartre' })
})

test('imprecise or unknown accuracy never discloses an address from reverse response', async () => {
  for (const accuracy of [undefined, 101, 3000, 259471]) {
    const fetcher = async url => {
      assert.equal(new URL(url).searchParams.get('zoom'), '10')
      return { ok: true, json: async () => responses.en }
    }
    const location = await reverseGeocodeLocation(43.2141, 27.9147, 'en', { fetcher, accuracy })
    assert.equal(location.name, 'Varna')
    assert.equal(location.address, null)
    assert.equal(location.approximateLocation, null)
  }
})

test('both reverse helpers apply the same street and approximate district policy', async () => {
  const {locationFromReverseGeocode} = await import('./current-location-localization.js')
  for (const accuracy of [0, 100, 101, 3000, 259471, undefined]) {
    const data={address:{city:'Varna',road:'Road',house_number:'12',suburb:'Troshevo'}}
    const result=await reverseGeocodeLocation(43.22,27.89,'en',{accuracy,fetcher:async()=>({ok:true,json:async()=>data})})
    const current=locationFromReverseGeocode(data,'My Location',accuracy)
    assert.equal(result.address,current.exactLocation)
    assert.equal(result.approximateLocation,current.approximateLocation)
  }
})
