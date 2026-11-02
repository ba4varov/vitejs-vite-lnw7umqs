import { acceptableAccuracy, MAX_ADDRESS_ACCURACY } from './location-accuracy.js'
import { reverseLocationDetails } from './reverse-location-details.js'
const closeCoordinate = (left, right) => Math.abs(Number(left) - Number(right)) <= 0.0001

export function quickCityAtCoordinates(quickCities, coords) {
  return quickCities.find(city => closeCoordinate(city.lat, coords.lat) && closeCoordinate(city.lon, coords.lon)) || null
}

export async function localizeCurrentLocation(current, language, quickCities, localizer, options = {}) {
  const quickCity = quickCityAtCoordinates(quickCities, current)
  if (quickCity) return { ...current, name: quickCity.name }
  if (current.geonameId == null) return current
  return localizer(current, language, options)
}

export function locationFromReverseGeocode(data, fallbackName, accuracy) {
  const address = data?.address || {}
  const name = address.city || address.town || address.village || address.county || fallbackName
  const detail = reverseLocationDetails(address, accuracy)
  return {
    name,
    region: address.state || address.county,
    country: address.country,
    exactLocation: detail.street,
    approximateLocation: detail.neighborhood
  }
}

export async function reverseGeocodeLocation(coords, language, options = {}) {
  const fetcher = options.fetcher || fetch
  const zoom = acceptableAccuracy(options.accuracy, MAX_ADDRESS_ACCURACY) ? 18 : 10
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(coords.lon)}&format=json&accept-language=${language}&zoom=${zoom}`
  const response = await fetcher(url, { signal: options.signal })
  if (!response.ok) throw new Error('Reverse geocoding failed')
  return response.json()
}
