import { acceptableAccuracy, MAX_ADDRESS_ACCURACY } from './location-accuracy.js'
import { reverseLocationDetails } from './reverse-location-details.js'
const endpoint = 'https://nominatim.openstreetmap.org/reverse'

export async function reverseGeocodeLocation(lat, lon, language, dependencies = {}) {
  const fetcher = dependencies.fetcher || fetch
  const precise = acceptableAccuracy(dependencies.accuracy, MAX_ADDRESS_ACCURACY)
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: 'jsonv2',
    'accept-language': language,
    addressdetails: '1',
    namedetails: '1',
    zoom: precise ? '18' : '10'
  })
  const response = await fetcher(`${endpoint}?${params}`, { signal: dependencies.signal })
  if (!response.ok) throw new Error('Reverse geocoding failed')
  const data = await response.json()
  const address = data?.address || {}
  const name = address.city || address.town || address.village || address.municipality || address.county || null
  const region = address.state || address.region || address.county || null
  const country = address.country || null
  const detail = reverseLocationDetails(address, dependencies.accuracy)

  return { name, region, country, address: detail.street, approximateLocation: detail.neighborhood }
}
