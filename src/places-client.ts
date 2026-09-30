import type { AuthSession } from './auth-client'
import { dedupePlaces, LOCAL_PLACES_KEY, loadLocalPlaces, requireMatchingPlace, validPlace } from './places-core.js'

export type Place = { id?: string, geonameId?: number | null, countryCode?: string | null, admin1Id?: number | null, name: string, region?: string | null, country?: string | null, lat: number, lon: number }
export type PlacesSnapshot = { places: Place[], defaultPlaceId: string | null }
const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

async function rest(session: AuthSession, path: string, init: RequestInit = {}) {
  if (!base || !anon) throw new Error('SYNC_NOT_CONFIGURED')
  const response = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...init.headers } })
  const data = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.message || 'SYNC_FAILED')
  return data
}

export async function fetchPlaces(session: AuthSession): Promise<PlacesSnapshot> {
  const [places, settings] = await Promise.all([
    rest(session, 'favorite_places?select=id,geoname_id,country_code,admin1_id,name,region,country,latitude,longitude&order=created_at.asc'),
    rest(session, 'place_settings?select=default_place_id')
  ])
  return { places: (places || []).map((p: any) => ({ id: p.id, geonameId: p.geoname_id == null ? null : Number(p.geoname_id), countryCode: p.country_code, admin1Id: p.admin1_id == null ? null : Number(p.admin1_id), name: p.name, region: p.region, country: p.country, lat: Number(p.latitude), lon: Number(p.longitude) })), defaultPlaceId: settings?.[0]?.default_place_id || null }
}

export async function addPlace(session: AuthSession, place: Place): Promise<Place> {
  if (!validPlace(place)) throw new Error('INVALID_PLACE')
  const rows = await rest(session, 'favorite_places?on_conflict=user_id,latitude_key,longitude_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ geoname_id: place.geonameId || null, country_code: place.countryCode || null, admin1_id: place.admin1Id || null, name: place.name.trim(), region: place.region || null, country: place.country || null, latitude: place.lat, longitude: place.lon }) })
  if (rows?.[0]) return { id: rows[0].id, geonameId: rows[0].geoname_id == null ? null : Number(rows[0].geoname_id), countryCode: rows[0].country_code, admin1Id: rows[0].admin1_id == null ? null : Number(rows[0].admin1_id), name: rows[0].name, region: rows[0].region, country: rows[0].country, lat: Number(rows[0].latitude), lon: Number(rows[0].longitude) }
  const snapshot = await fetchPlaces(session)
  return requireMatchingPlace(snapshot.places, place)
}
export const removePlace = (session: AuthSession, id: string) => rest(session, `favorite_places?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' })
export const setPlaceIdentity = (session: AuthSession, id: string, place: Place) => rest(session, `favorite_places?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ geoname_id: place.geonameId, country_code: place.countryCode || null, admin1_id: place.admin1Id || null }) })
export const setDefaultPlace = (session: AuthSession, id: string | null) => rest(session, 'rpc/set_my_default_place', { method: 'POST', body: JSON.stringify({ place_id: id }) })
export async function importPlaces(session: AuthSession, places: Place[]) { for (const place of dedupePlaces(places)) await addPlace(session, place); return fetchPlaces(session) }
export function localPlaces() { return loadLocalPlaces(localStorage) as Place[] }
export function saveLocalPlaces(places: Place[]) { localStorage.setItem(LOCAL_PLACES_KEY, JSON.stringify(dedupePlaces(places))) }
