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

export function locationFromReverseGeocode(data, fallbackName) {
  const address = data?.address || {}
  const name = address.city || address.town || address.village || address.county || fallbackName
  const street = address.road || address.pedestrian || address.street
  const exactParts = street ? [street, address.house_number].filter(Boolean) :
    [address.suburb || address.neighbourhood || address.city_district].filter(Boolean)
  return {
    name,
    region: address.state || address.county,
    country: address.country,
    exactLocation: exactParts.length ? exactParts.join(' ') : null
  }
}

export async function reverseGeocodeLocation(coords, language, options = {}) {
  const fetcher = options.fetcher || fetch
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(coords.lon)}&format=json&accept-language=${language}&zoom=18`
  const response = await fetcher(url, { signal: options.signal })
  if (!response.ok) throw new Error('Reverse geocoding failed')
  return response.json()
}
