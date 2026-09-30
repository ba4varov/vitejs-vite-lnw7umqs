export const LOCAL_PLACES_KEY = 'meteoPulsePlacesV1'

export function placeKey(place) {
  return `${Number(place.lat).toFixed(4)},${Number(place.lon).toFixed(4)}`
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

export function loadLocalPlaces(storage) {
  let current = []
  try { current = JSON.parse(storage.getItem(LOCAL_PLACES_KEY) || '[]') } catch {}
  // Non-destructive legacy migration: keep bobbyWeatherFav intact for rollback.
  try {
    const legacy = JSON.parse(storage.getItem('bobbyWeatherFav') || 'null')
    if (validPlace(legacy)) current.push(legacy)
  } catch {}
  const places = dedupePlaces(Array.isArray(current) ? current : [])
  storage.setItem(LOCAL_PLACES_KEY, JSON.stringify(places))
  return places
}
