export const LOCAL_PLACES_KEY = 'meteoPulsePlacesV1'

export function placeKey(place) {
  return `${Number(place.lat).toFixed(4)},${Number(place.lon).toFixed(4)}`
}

export function placeIdentity(place) {
  return place.geonameId != null ? `geo:${place.geonameId}` : `coords:${placeKey(place)}`
}

export function samePlace(left, right) {
  if (left?.geonameId != null && right?.geonameId != null) return String(left.geonameId) === String(right.geonameId)
  return placeKey(left) === placeKey(right)
}

export function validPlace(place) {
  return Boolean(place && typeof place.name === 'string' && place.name.trim().length > 0 && place.name.trim().length <= 120 &&
    Number.isFinite(Number(place.lat)) && Number(place.lat) >= -90 && Number(place.lat) <= 90 &&
    Number.isFinite(Number(place.lon)) && Number(place.lon) >= -180 && Number(place.lon) <= 180)
}

export function dedupePlaces(places) {
  const seen = new Set()
  return places.filter(validPlace).filter(place => {
    const key = placeKey(place)
    if (seen.has(key)) return false
    seen.add(key); return true
  })
}

export function requireMatchingPlace(places, requested) {
  const existing = places.find(place => placeKey(place) === placeKey(requested))
  if (!existing) throw new Error('PLACE_CONFLICT_NOT_FOUND')
  return existing
}

export function loadLocalPlaces(storage) {
  let current = [], hasMigrated = false
  try {
    const saved = storage.getItem(LOCAL_PLACES_KEY)
    hasMigrated = saved !== null
    current = JSON.parse(saved || '[]')
  } catch { hasMigrated = true }
  // The presence of the new key is the migration marker. Keep the legacy key
  // for rollback, but never resurrect it after the user empties the new list.
  if (!hasMigrated) try {
      const legacy = JSON.parse(storage.getItem('bobbyWeatherFav') || 'null')
      if (validPlace(legacy)) current.push(legacy)
    } catch {}
  const places = dedupePlaces(Array.isArray(current) ? current : [])
  storage.setItem(LOCAL_PLACES_KEY, JSON.stringify(places))
  return places
}
