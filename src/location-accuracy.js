// City forecasts tolerate a few kilometres, not an ISP's regional centroid.
export const MAX_FORECAST_ACCURACY = 3000
export const MAX_ADDRESS_ACCURACY = 100
export const LAST_LOCATION_KEY = 'meteoPulseConfirmedLocationV1'

export function validCoordinates(lat, lon) {
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180
}
export function acceptableAccuracy(accuracy, limit = MAX_FORECAST_ACCURACY) {
  return Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= limit
}
export function acceptedPosition(coords) {
  return validCoordinates(coords?.latitude, coords?.longitude) && acceptableAccuracy(coords?.accuracy)
}
export function saveConfirmedLocation(location, storage) {
  if (!validCoordinates(location?.lat, location?.lon) || !['manual', 'geolocation'].includes(location?.source)) return
  if (location.source === 'geolocation' && !acceptableAccuracy(location.accuracy)) return
  // Never persist street addresses, account IDs, or unverified legacy defaults.
  const { lat, lon, name, source, accuracy, geonameId, countryCode, admin1Id, region, country } = location
  try { (storage ?? globalThis.localStorage)?.setItem(LAST_LOCATION_KEY, JSON.stringify({ lat, lon, name, source, accuracy, geonameId, countryCode, admin1Id, region, country })) } catch { /* Storage can be disabled. */ }
}
export function loadConfirmedLocation(storage) {
  try {
    const place = JSON.parse((storage ?? globalThis.localStorage)?.getItem(LAST_LOCATION_KEY) || 'null')
    if (!validCoordinates(place?.lat, place?.lon) || typeof place?.name !== 'string' || !place.name.trim()) return null
    if (place.source !== 'manual' && !(place.source === 'geolocation' && acceptableAccuracy(place.accuracy))) return null
    return place
  } catch { return null }
}
