export const PLACE_LABELS_KEY = 'meteoPulsePlaceLabelsV1'

const normalized = value => String(value || '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase()
const normalizedRegion = value => normalized(value).replace(/^(oblast|област|province|region|county)\s+/, '')
const closeCoordinate = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.02
const sameValue = (left, right) => left != null && right != null && String(left) === String(right)

function metadataMatches(place, translations) {
  if (place.countryCode && !translations.some(result => normalized(result.country_code) === normalized(place.countryCode))) return false
  if (place.admin1Id != null && !translations.some(result => sameValue(result.admin1_id, place.admin1Id))) return false
  if (place.country && !translations.some(result => normalized(result.country) === normalized(place.country) || normalized(result.country_code) === normalized(place.country))) return false
  if (place.region && !translations.some(result => normalizedRegion(result.admin1) === normalizedRegion(place.region))) return false
  return true
}

export function matchGeocodingResult(place, resultSets) {
  const results = resultSets.flat()
  if (place.geonameId != null) return results.find(result => sameValue(result.id, place.geonameId)) || null

  const byId = new Map()
  for (const result of results) {
    if (!closeCoordinate(result.latitude, place.lat) || !closeCoordinate(result.longitude, place.lon)) continue
    const translations = byId.get(String(result.id)) || []
    translations.push(result)
    byId.set(String(result.id), translations)
  }
  const candidates = [...byId.values()].filter(translations => metadataMatches(place, translations))
  return candidates.length === 1 ? candidates[0][0] : null
}

export function labelFromResult(result) {
  return { name: result.name, region: result.admin1 || null, country: result.country || null }
}

export function identityFromResult(result) {
  return {
    geonameId: Number(result.id),
    countryCode: result.country_code || null,
    admin1Id: result.admin1_id == null ? null : Number(result.admin1_id)
  }
}

export function readLabelCache(storage) {
  try { const value = JSON.parse(storage?.getItem(PLACE_LABELS_KEY) || '{}'); return value && typeof value === 'object' ? value : {} } catch { return {} }
}

export function cachedLabel(storage, geonameId, language) {
  return geonameId == null ? null : readLabelCache(storage)[`${geonameId}:${language}`] || null
}

export function cacheLabel(storage, geonameId, language, label) {
  if (geonameId == null) return
  try {
    const cache = readLabelCache(storage)
    cache[`${geonameId}:${language}`] = label
    storage?.setItem(PLACE_LABELS_KEY, JSON.stringify(cache))
  } catch {}
}

export function createLocalizationGuard() {
  let generation = 0
  return {
    begin() { const id = ++generation; return { id, controller: new AbortController() } },
    invalidate(ticket) { ticket.controller.abort(); generation += 1 },
    isCurrent(ticket) { return ticket.id === generation && !ticket.controller.signal.aborted }
  }
}
