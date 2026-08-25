import type { CitySuggestion, Language } from '../types/weather'

export const searchCities = async (query: string, lang: Language): Promise<CitySuggestion[]> => {
  if (query.length < 2) return []

  const res = await fetch(
    'https://geocoding-api.open-meteo.com/v1/search?name=' +
      encodeURIComponent(query) +
      '&count=10&language=' +
      lang +
      '&format=json',
  )
  const data = await res.json()
  return data.results || []
}

export const reverseGeocode = async (lat: number, lon: number, lang: Language) => {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=${lang}&zoom=18`,
  )
  return res.json()
}
