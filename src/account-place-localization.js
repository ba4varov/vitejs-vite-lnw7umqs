import { placeKey } from './places-core.js'

export function findLocalizedEquivalent(localizedPlaces, preferred) {
  if (!preferred) return undefined
  return localizedPlaces.find(place => preferred.id != null && place.id === preferred.id)
    || localizedPlaces.find(place => preferred.geonameId != null && String(place.geonameId) === String(preferred.geonameId))
    || localizedPlaces.find(place => placeKey(place) === placeKey(preferred))
}

/**
 * Localize an account snapshot against the language that is current when the
 * result is ready. If the language changes in flight, discard those labels and
 * try again before exposing either the list or its default place to the UI.
 */
export async function localizeAccountPlaces(places, defaultPlaceId, currentLanguage, localize) {
  while (true) {
    const language = currentLanguage()
    const localizedPlaces = await Promise.all(places.map(place => localize(place, language).catch(() => ({ ...place }))))
    if (language !== currentLanguage()) continue

    const preferred = places.find(place => place.id === defaultPlaceId)

    return {
      localizedPlaces,
      preferred: findLocalizedEquivalent(localizedPlaces, preferred)
    }
  }
}
