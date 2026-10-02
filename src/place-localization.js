import { cacheLabel, cachedLabel, identityFromResult, labelFromResult, matchGeocodingResult } from './place-localization-core.js'
import { placeKey } from './places-core.js'

const endpoint = 'https://geocoding-api.open-meteo.com/v1'
const supportedLanguages = new Set(['bg', 'en'])

function defaultStorage() {
  try { return globalThis.localStorage } catch { return null }
}

async function json(url, fetcher, signal) {
  const response = await fetcher(url, { signal })
  if (!response.ok) throw new Error('Geocoding failed')
  return response.json()
}

async function getById(id, language, fetcher, signal) {
  const data = await json(`${endpoint}/get?id=${encodeURIComponent(id)}&language=${language}&format=json`, fetcher, signal)
  return data?.id == null ? null : data
}

export async function localizePlace(place, language, dependencies = {}) {
  if (!supportedLanguages.has(language)) throw new Error('Unsupported geocoding language')
  const fetcher = dependencies.fetcher || fetch
  const storage = dependencies.storage === undefined ? defaultStorage() : dependencies.storage
  const cached = cachedLabel(storage, place.geonameId, language)
  if (cached) return { ...place, ...cached }

  let identity = place.geonameId == null ? null : place
  if (!identity) {
    const queries = [...new Set([place.name, place.region].filter(Boolean))]
    const resultSets = []
    for (const query of queries) {
      for (const lookupLanguage of ['bg', 'en']) {
        const data = await json(`${endpoint}/search?name=${encodeURIComponent(query)}&count=100&language=${lookupLanguage}&format=json`, fetcher, dependencies.signal)
        resultSets.push(Array.isArray(data.results) ? data.results : [])
      }
    }
    const matched = matchGeocodingResult(place, resultSets)
    if (!matched) return place
    identity = { ...place, ...identityFromResult(matched) }
  }

  const localized = await getById(Number(identity.geonameId), language, fetcher, dependencies.signal)
  if (!localized) return identity
  const label = labelFromResult(localized)
  cacheLabel(storage, identity.geonameId, language, label)
  return { ...identity, ...identityFromResult(localized), ...label }
}

export async function localizePlaceSelection(places, selectedPlace, language, dependencies = {}) {
  const localizedPlaces = await Promise.all(places.map(place => localizePlace(place, language, dependencies).catch(() => place)))
  const selectedIndex = places.findIndex(place => placeKey(place) === placeKey(selectedPlace))
  const localizedSelection = selectedIndex >= 0
    ? localizedPlaces[selectedIndex]
    : await localizePlace(selectedPlace, language, dependencies).catch(() => selectedPlace)

  return { places: localizedPlaces, selectedPlace: localizedSelection }
}
