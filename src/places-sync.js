import { validPlace } from './places-core.js'

const codes = new Set(['PGRST301', 'PGRST302', 'PGRST303', 'PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', 'PGRST106', 'PGRST116', '42501', '42P01', '42703'])
export class PlacesSyncError extends Error {
  constructor(source, category, status = null, code = null) {
    super('PLACES_SYNC_FAILED')
    this.diagnostic = { source, category, status, code: codes.has(code) ? code : null }
  }
}
export function placesFailure(error) {
  if (error instanceof PlacesSyncError) return error.diagnostic.category
  reportPlacesFailure(error)
  return 'unknown'
}
export function reportPlacesFailure(error) {
  // Never log the Error, response body, URL, headers, account or place details.
  console.warn('places_sync', error instanceof PlacesSyncError ? error.diagnostic : { source: 'client', category: 'unknown', status: null, code: null })
}
function category(status, code) {
  if (status === 401 || ['PGRST301', 'PGRST302', 'PGRST303'].includes(code)) return 'session'
  if (status === 403 || code === '42501') return 'permission'
  if (status === 404 || ['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', 'PGRST106', '42P01', '42703'].includes(code)) return 'schema'
  if (code === 'PGRST116') return 'response'
  return status >= 500 ? 'server' : 'request'
}

export async function placesRequest({ base, anon, session, path, init = {}, accountSession, fetcher = fetch }) {
  const source = path.split('?')[0] === 'favorite_places' ? 'favorite_places'
    : path.split('?')[0] === 'place_settings' ? 'place_settings' : 'default_place'
  if (!base || !anon) throw new PlacesSyncError(source, 'configuration')
  let active = await accountSession(session.user.id)
  if (!active) throw new PlacesSyncError(source, 'session')
  for (let attempt = 0; attempt < 2; attempt++) {
    let response, data
    try {
      response = await fetcher(`${base}/rest/v1/${path}`, { ...init, signal: AbortSignal.timeout(10_000), headers: {
        apikey: anon, Authorization: `Bearer ${active.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...init.headers,
      } })
      data = response.status === 204 ? null : await response.json().catch(() => undefined)
    } catch (error) {
      throw new PlacesSyncError(source, error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network')
    }
    // Only reads retry automatically. Writes may have committed despite a lost response.
    if (response.status === 401 && !init.method && attempt === 0) {
      active = await accountSession(session.user.id, active.access_token)
      if (active) continue
    }
    if (!response.ok) throw new PlacesSyncError(source, category(response.status, data?.code), response.status, data?.code)
    if (data === undefined) throw new PlacesSyncError(source, 'response', response.status)
    return data
  }
}

export function placesSnapshot(rows, settings) {
  if (!Array.isArray(rows)) throw new PlacesSyncError('favorite_places', 'response')
  if (!Array.isArray(settings) || settings.length > 1 || settings.some(row => !row || !Object.hasOwn(row, 'default_place_id') || (row.default_place_id !== null && (typeof row.default_place_id !== 'string' || !row.default_place_id)))) {
    throw new PlacesSyncError('place_settings', 'response')
  }
  const places = rows.map(row => {
    if (!row || typeof row.id !== 'string' || !row.id || typeof row.latitude !== 'number' || typeof row.longitude !== 'number') throw new PlacesSyncError('favorite_places', 'response')
    const place = { id: row.id, geonameId: row.geoname_id == null ? null : Number(row.geoname_id), countryCode: row.country_code,
      admin1Id: row.admin1_id == null ? null : Number(row.admin1_id), name: row.name, region: row.region, country: row.country, lat: row.latitude, lon: row.longitude }
    if (!validPlace(place)) throw new PlacesSyncError('favorite_places', 'response')
    return place
  })
  return { places, defaultPlaceId: settings[0]?.default_place_id ?? null }
}

export function placesErrorText(category, lang) {
  const bg = lang === 'bg'
  const detail = {
    session: bg ? 'Сесията не може да бъде потвърдена. Опитай отново или влез отново.' : 'Your session could not be verified. Retry or sign in again.',
    permission: bg ? 'Достъпът до запазените места е отказан.' : 'Access to saved places was denied.',
    schema: bg ? 'Услугата за запазени места не е конфигурирана правилно.' : 'The saved places service is not configured correctly.',
    configuration: bg ? 'Синхронизацията не е конфигурирана.' : 'Synchronization is not configured.',
    network: bg ? 'Провери интернет връзката си.' : 'Check your internet connection.',
    timeout: bg ? 'Услугата не отговори навреме.' : 'The service did not respond in time.',
    response: bg ? 'Услугата върна непълен или невалиден отговор.' : 'The service returned an incomplete or invalid response.',
    server: bg ? 'Услугата е временно недостъпна.' : 'The service is temporarily unavailable.',
  }[category]
  return `${bg ? 'Местата не можаха да се синхронизират.' : 'Places could not be synchronized.'}${detail ? ` ${detail}` : ''}`
}
