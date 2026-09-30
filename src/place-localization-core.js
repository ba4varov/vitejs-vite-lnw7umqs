export const PLACE_LABELS_KEY = 'meteoPulsePlaceLabelsV1'

const normalized = value => String(value || '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase()
const closeCoordinate = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.02

export function matchGeocodingResult(place, results) {
  if (place.geonameId != null) return results.find(result => String(result.id) === String(place.geonameId)) || null
  const nearby = results.filter(result => closeCoordinate(result.latitude, place.lat) && closeCoordinate(result.longitude, place.lon))
  const metadataMatches = nearby.filter(result =>
    (!place.country || normalized(result.country) === normalized(place.country) || normalized(result.country_code) === normalized(place.country)) &&
    (!place.region || normalized(result.admin1) === normalized(place.region)))
  const candidates = metadataMatches.length ? metadataMatches : (!place.country && !place.region ? nearby : [])
  return candidates.length === 1 ? candidates[0] : null
}

export function labelFromResult(result) {
  return { name: result.name, region: result.admin1 || null, country: result.country || null }
}

export function readLabelCache(storage) {
  try { const value = JSON.parse(storage.getItem(PLACE_LABELS_KEY) || '{}'); return value && typeof value === 'object' ? value : {} } catch { return {} }
}

export function cachedLabel(storage, geonameId, language) {
  return geonameId == null ? null : readLabelCache(storage)[`${geonameId}:${language}`] || null
}

export function cacheLabel(storage, geonameId, language, label) {
  if (geonameId == null) return
  const cache = readLabelCache(storage)
  cache[`${geonameId}:${language}`] = label
  storage.setItem(PLACE_LABELS_KEY, JSON.stringify(cache))
}
