import type { AuthSession } from './auth-client'
import { accountSession } from './auth-client'
import { placesRequest, placesSnapshot, reportPlacesFailure } from './places-sync.js'
import { dedupePlaces, LOCAL_PLACES_KEY, loadLocalPlaces, requireMatchingPlace, validPlace } from './places-core.js'

export type Place = { id?: string, geonameId?: number | null, countryCode?: string | null, admin1Id?: number | null, name: string, region?: string | null, country?: string | null, lat: number, lon: number }
export type PlacesSnapshot = { places: Place[], defaultPlaceId: string | null }
const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

async function rest(session: AuthSession, path: string, init: RequestInit = {}) {
  try { return await placesRequest({ base, anon, session, path, init, accountSession }) }
  catch (error) { reportPlacesFailure(error); throw error }
}

export async function fetchPlaces(session: AuthSession): Promise<PlacesSnapshot> {
  const [places, settings] = await Promise.all([
    rest(session, 'favorite_places?select=id,geoname_id,country_code,admin1_id,name,region,country,latitude,longitude&order=created_at.asc'),
    rest(session, 'place_settings?select=default_place_id')
  ])
  try { return placesSnapshot(places, settings) }
  catch (error) { reportPlacesFailure(error); throw error }
}

export async function addPlace(session: AuthSession, place: Place): Promise<Place> {
  if (!validPlace(place)) throw new Error('INVALID_PLACE')
  const rows = await rest(session, 'favorite_places?on_conflict=user_id,latitude_key,longitude_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ geoname_id: place.geonameId || null, country_code: place.countryCode || null, admin1_id: place.admin1Id || null, name: place.name.trim(), region: place.region || null, country: place.country || null, latitude: place.lat, longitude: place.lon }) })
  let saved: Place | undefined
  try { saved = placesSnapshot(rows, []).places[0] }
  catch (error) { reportPlacesFailure(error); throw error }
  if (saved) return saved
  const snapshot = await fetchPlaces(session)
  return requireMatchingPlace(snapshot.places, place)
}
export const removePlace = (session: AuthSession, id: string) => rest(session, `favorite_places?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' })
export const setPlaceIdentity = (session: AuthSession, id: string, place: Place) => rest(session, `favorite_places?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ geoname_id: place.geonameId, country_code: place.countryCode || null, admin1_id: place.admin1Id || null }) })
export const setDefaultPlace = (session: AuthSession, id: string | null) => rest(session, 'rpc/set_my_default_place', { method: 'POST', body: JSON.stringify({ place_id: id }) })
export async function importPlaces(session: AuthSession, places: Place[]) { for (const place of dedupePlaces(places)) await addPlace(session, place); return fetchPlaces(session) }
export function localPlaces() { return loadLocalPlaces(localStorage) as Place[] }
export function saveLocalPlaces(places: Place[]) { localStorage.setItem(LOCAL_PLACES_KEY, JSON.stringify(dedupePlaces(places))) }
