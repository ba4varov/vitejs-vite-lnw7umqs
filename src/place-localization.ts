import type { Place } from './places-client'
import { cacheLabel, cachedLabel, labelFromResult, matchGeocodingResult } from './place-localization-core.js'

const endpoint = 'https://geocoding-api.open-meteo.com/v1/search'

export async function localizePlace(place: Place, language: 'bg' | 'en', signal?: AbortSignal): Promise<Place> {
  const cached = cachedLabel(localStorage, place.geonameId, language)
  if (cached) return { ...place, ...cached }

  const queries = [...new Set([place.name, place.region].filter(Boolean) as string[])]
  for (const query of queries) {
    const response = await fetch(`${endpoint}?name=${encodeURIComponent(query)}&count=100&language=${language}&format=json`, { signal })
    if (!response.ok) throw new Error('Geocoding failed')
    const data = await response.json()
    const result = matchGeocodingResult(place, Array.isArray(data.results) ? data.results : [])
    if (result) {
      const label = labelFromResult(result)
      cacheLabel(localStorage, result.id, language, label)
      return { ...place, geonameId: Number(result.id), ...label }
    }
  }
  return place
}
