const endpoint = 'https://nominatim.openstreetmap.org/reverse'

export async function reverseGeocodeLocation(lat, lon, language, dependencies = {}) {
  const fetcher = dependencies.fetcher || fetch
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: 'jsonv2',
    'accept-language': language,
    addressdetails: '1',
    namedetails: '1',
    zoom: '18'
  })
  const response = await fetcher(`${endpoint}?${params}`, { signal: dependencies.signal })
  if (!response.ok) throw new Error('Reverse geocoding failed')
  const data = await response.json()
  const address = data?.address || {}
  const name = address.city || address.town || address.village || address.municipality || address.county || null
  const region = address.state || address.region || address.county || null
  const country = address.country || null
  const street = address.road || address.pedestrian || address.street
  const neighborhood = address.suburb || address.neighbourhood || address.city_district
  const addressLabel = street ? [street, address.house_number].filter(Boolean).join(' ') : neighborhood || null

  return { name, region, country, address: addressLabel }
}
