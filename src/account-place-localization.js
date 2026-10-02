/**
 * Localize an account snapshot against the language that is current when the
 * result is ready. If the language changes in flight, discard those labels and
 * try again before exposing either the list or its default place to the UI.
 */
export async function localizeAccountPlaces(places, defaultPlaceId, currentLanguage, localize) {
  while (true) {
    const language = currentLanguage()
    const localizedPlaces = await Promise.all(places.map(place => localize(place, language).catch(() => place)))
    if (language !== currentLanguage()) continue

    return {
      localizedPlaces,
      preferred: localizedPlaces.find(place => place.id === defaultPlaceId)
    }
  }
}
