import { CITY_PHOTO_CACHE_MS, parseCityPhotoResponse } from './city-photo-core.js'

// Fallback for locations without an editorially reviewed gallery.
// Nearby GPS-tagged Commons files, NOT filename-only city guesses.
// The displayed images still need valid reuse licenses and attribution.
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const GEOCODE_API = 'https://geocoding-api.open-meteo.com/v1/search'
const APP_ID = 'MeteoPulse/1.0 (https://ba4varov-wheater.vercel.app)'
// Version 2 invalidates the old 30-day caches that could contain office photos.
const GALLERY_PREFIX = 'meteoPulseNearbyPhotosV2:'
const CENTRE_PREFIX = 'meteoPulseNearbyCentreV1:'
const CENTRE_CACHE_MS = 7 * 86_400_000
const API_RETRY_MS = 15 * 60_000
const EMPTY_RETRY_MS = 24 * 60 * 60_000
const MAX_CONCURRENT_LOOKUPS = 2
export const PHOTO_RADIUS_METRES = 4000

const pending = new Map()
const retryAfter = new Map()
const isPoint = p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) &&
  p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180 &&
  !(p.lat === 0 && p.lon === 0)
const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').trim().replace(/\s+/g, ' ')
const safeName = value => typeof value === 'string' && value.length >= 2 && value.length <= 80 &&
  /\p{L}/u.test(value) && !/[\d\\,;<>]/u.test(value) && !value.includes('/') &&
  !/^(?:my location|моето местоположение|current location|текущо местоположение)$/iu.test(value.trim())
const rounded = value => Number(value).toFixed(3)
const canonicalKey = center => `nearby:${rounded(center.lat)}:${rounded(center.lon)}`

// A city selected in search or quick cities already has coordinates for its
// centre. Raw GPS coordinates never enter the Commons query string.
export function autoCityPhotoRequest(place, source = 'search') {
  if (!isPoint(place) || !safeName(place?.name)) return null
  const gps = source === 'geolocation'
  const countryCode = /^[A-Z]{2}$/.test(String(place.countryCode || '').toUpperCase())
    ? place.countryCode.toUpperCase() : ''
  const key = gps
    ? `gps:${normalize(place.name)}:${countryCode}`
    : canonicalKey(place)
  return { key, gps, name: place.name.trim(), lat: place.lat, lon: place.lon, countryCode }
}

// Only used locally to confirm a named town, never sent to a third party.
const distanceMetres = (a, b) => {
  const rad = Math.PI / 180
  const latDelta = (b.lat - a.lat) * rad
  const lonDelta = (b.lon - a.lon) * rad
  const h = Math.sin(latDelta / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(lonDelta / 2) ** 2
  return 12_742_000 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
}

export function selectVerifiedCityCentre(results, request) {
  if (!request?.gps || !isPoint(request) || !safeName(request.name)) return null
  const candidates = (Array.isArray(results) ? results : [])
    .filter(item => isPoint({ lat: item.latitude, lon: item.longitude }) &&
      normalize(item.name) === normalize(request.name) &&
      (!request.countryCode || String(item.country_code || '').toUpperCase() === request.countryCode))
    .map(item => ({ lat: item.latitude, lon: item.longitude, distance: distanceMetres(request, {
      lat: item.latitude, lon: item.longitude
    }) }))
    // Reject distant namesakes; the raw GPS point is used only locally here.
    .filter(item => item.distance <= 35_000)
    .sort((a, b) => a.distance - b.distance)
  return candidates[0] ? { lat: candidates[0].lat, lon: candidates[0].lon } : null
}

const cachedCentre = (storage, request, now) => {
  if (!storage) return null
  try {
    const entry = JSON.parse(storage.getItem(CENTRE_PREFIX + request.key) || 'null')
    if (!entry || !Number.isFinite(entry.savedAt) || now < entry.savedAt ||
      now - entry.savedAt >= CENTRE_CACHE_MS || !isPoint(entry.center) ||
      distanceMetres(request, entry.center) > 35_000) return null
    return entry.center
  } catch { return null }
}
const saveCentre = (storage, request, center, now) => {
  try { storage?.setItem(CENTRE_PREFIX + request.key, JSON.stringify({ center, savedAt: now })) }
  catch { /* private browser storage */ }
}

export async function getCityCentre(request, { fetcher = fetch, storage = null, lang = 'en', now = Date.now() } = {}) {
  if (!request?.gps) return isPoint(request) ? { lat: request.lat, lon: request.lon } : null
  const cached = cachedCentre(storage, request, now)
  if (cached) return cached
  const url = new URL(GEOCODE_API)
  for (const [key, value] of Object.entries({
    name: request.name, count: '10', language: lang === 'bg' ? 'bg' : 'en', format: 'json'
  })) url.searchParams.set(key, value)
  // Sends ONLY the settlement name; no device latitude or longitude.
  const response = await fetcher(url.toString())
  if (!response.ok) throw new Error('City centre lookup failed')
  const data = await response.json()
  const center = selectVerifiedCityCentre(data?.results, request)
  if (center) saveCentre(storage, request, center, now)
  return center
}

export function nearbyPhotoSearchUrl(center) {
  if (!isPoint(center)) return null
  const u = new URL(COMMONS_API)
  for (const [k, v] of Object.entries({
    action: 'query', format: 'json', origin: '*',
    list: 'geosearch', gsprimary: 'all', gsnamespace: '6',
    gsradius: String(PHOTO_RADIUS_METRES), gslimit: '60',
    gscoord: `${center.lat}|${center.lon}`
  })) u.searchParams.set(k, v)
  return u.toString()
}

const excludeTitle = /(?:\b(?:logo|map|flag|poster|selfie|portrait|signature|diagram|screenshot|menu|advertisement|passport|ticket|coat.of.arms|drawing|painting|scan|svg|watermark)\b|карта|портрет|плакат)/iu
const scenicTitle = /(?:panoram|skyline|cityscape|city.view|city.centre|city.center|aerial|landscape|square|street|park|harbor|harbour|cathedral|monument|boulevard|old.town|город|панорам|площад|улица|парка|centre.ville|stadtansicht|vista.de.la.ciudad)/iu
const unsafeSceneTitle = /(?:office|meeting|portrait|selfie|person|people|man.at|woman.at|worker|employee|reception|interior|lobby|workspace|conference|workshop|conference.room|hotel.room|shop|store|mall|businessman|businesswoman|headshot|desk|cubicle|camera|phone|computer|graduation)/iu
const cityNameAliases = {
  'пловдив':'plovdiv', 'бургас':'burgas', 'лондон':'london',
  'париж':'paris', 'нюйорк':'newyork', 'токио':'tokyo',
  'дубай':'dubai', 'варна':'varna', 'софия':'sofia',
}
const citySlug = text => normalize(text).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]/gu,'')
function matchesCity(title, name) {
  if (!name) return true
  const label = citySlug(name)
  const alias = cityNameAliases[label] || label
  return alias.length >= 3 && citySlug(title).includes(alias)
}
const photoExt = /\.(?:jpe?g|png|webp)$/iu

export function nearbyPhotoTitles(results, center, cityName = '') {
  if (!isPoint(center)) return []
  const seen = new Set()
  return (Array.isArray(results) ? results : [])
    .filter(file => file?.ns === 6 && typeof file.title === 'string' &&
      file.title.startsWith('File:') && photoExt.test(file.title) &&
      scenicTitle.test(file.title) && !unsafeSceneTitle.test(file.title) &&
      matchesCity(file.title, cityName) && !excludeTitle.test(file.title) &&
      isPoint({ lat: file.lat, lon: file.lon }) &&
      distanceMetres(center, { lat: file.lat, lon: file.lon }) <= PHOTO_RADIUS_METRES)
    .map(file => ({
      title: file.title,
      distance: distanceMetres(center, { lat: file.lat, lon: file.lon }),
      score: scenicTitle.test(file.title) ? 2 : 0
    }))
    .sort((a, b) => b.score - a.score || a.distance - b.distance)
    .filter(file => {
      const key = normalize(file.title)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 24)
    .map(file => file.title)
}

export function nearbyPhotoMetadataUrl(titles) {
  if (!Array.isArray(titles) || !titles.length || titles.length > 12 ||
    titles.some(title => typeof title !== 'string' || !title.startsWith('File:'))) return null
  const u = new URL(COMMONS_API)
  for (const [k, v] of Object.entries({
    action: 'query', format: 'json', origin: '*', prop: 'imageinfo',
    iiprop: 'url|size|mime|user|extmetadata', iiurlwidth: '960',
    titles: titles.join('|')
  })) u.searchParams.set(k, v)
  return u.toString()
}

async function readCommons(url, fetcher) {
  const response = await fetcher(url, { headers: { 'Api-User-Agent': APP_ID } })
  if (!response.ok) throw new Error('Commons images unavailable')
  return response.json()
}

export async function fetchNearbyCityPhotos(center, { fetcher = fetch, cityName = '' } = {}) {
  const url = nearbyPhotoSearchUrl(center)
  if (!url) return []
  const discovered = await readCommons(url, fetcher)
  // One bounded metadata call rather than repeatedly fetching ever more files.
  // If no genuine scenic city photos are found, retain the weather background.
  const titles = nearbyPhotoTitles(discovered?.query?.geosearch, center, cityName).slice(0, 12)
  if (!titles.length) return []
  const metadataUrl = nearbyPhotoMetadataUrl(titles)
  const response = await readCommons(metadataUrl, fetcher)
  return parseCityPhotoResponse(response, titles).slice(0, 8)
}

// The cache contains no raw GPS coordinates and no third-party links apart
// from strictly allowed Commons image / file URLs and CC attribution URLs.
const allowedPhoto = photo => {
  if (!photo || typeof photo.id !== 'string' || !photo.id.startsWith('File:') ||
    typeof photo.author !== 'string' || !photo.author.trim() || photo.author.length > 100 ||
    !/^(?:CC BY [234]\.0|CC0(?: |$)|PD(?:-|$)|Public domain)/iu.test(photo.license || '') ||
    typeof photo.licenseUrl !== 'string' || typeof photo.filePage !== 'string') return false
  try {
    const img = new URL(photo.url), file = new URL(photo.filePage)
    return img.protocol === 'https:' && img.hostname === 'upload.wikimedia.org' &&
      img.pathname.startsWith('/wikipedia/commons/') &&
      file.protocol === 'https:' && file.hostname === 'commons.wikimedia.org' &&
      file.pathname.startsWith('/wiki/') &&
      (!photo.licenseUrl || photo.licenseUrl.startsWith('https://creativecommons.org/'))
  } catch { return false }
}

export function readNearbyCache(key, storage, now = Date.now()) {
  if (!key || !storage) return null
  try {
    const entry = JSON.parse(storage.getItem(GALLERY_PREFIX + key) || 'null')
    return entry && Number.isFinite(entry.savedAt) && now >= entry.savedAt &&
      now - entry.savedAt < CITY_PHOTO_CACHE_MS && Array.isArray(entry.photos) &&
      entry.photos.length >= 2 && entry.photos.length <= 8 &&
      entry.photos.every(allowedPhoto) ? entry.photos : null
  } catch { return null }
}
export function saveNearbyCache(key, photos, storage, now = Date.now()) {
  if (!key || !storage || !Array.isArray(photos) || photos.length < 2 ||
    photos.length > 8 || !photos.every(allowedPhoto)) return
  try { storage.setItem(GALLERY_PREFIX + key, JSON.stringify({ savedAt: now, photos })) }
  catch { /* storage disabled or quota full */ }
}

// StrictMode effects and rapid city switches share the lookup. Concurrent
// searches are bounded to protect Wikimedia's servers and the user's data.
export function loadNearbyCityGallery(request, {
  storage = null, fetcher = fetch, lang = 'en', now = Date.now()
} = {}) {
  if (!request?.key) return Promise.resolve([])
  const pendingTask = pending.get(request.key)
  if (pendingTask) return pendingTask
  const center = !request.gps ? { lat: request.lat, lon: request.lon } : null
  const cached = center ? readNearbyCache(canonicalKey(center), storage, now) : null
  if (cached) return Promise.resolve(cached)
  if (now < (retryAfter.get(request.key) || 0) || pending.size >= MAX_CONCURRENT_LOOKUPS)
    return Promise.resolve([])

  const task = (async () => {
    const resolved = await getCityCentre(request, { fetcher, storage, lang, now })
    if (!resolved) {
      retryAfter.set(request.key, Date.now() + EMPTY_RETRY_MS)
      return []
    }
    const photoKey = canonicalKey(resolved)
    const fromCache = readNearbyCache(photoKey, storage, now)
    if (fromCache) return fromCache
    const photos = await fetchNearbyCityPhotos(resolved, { fetcher, cityName: request.name })
    if (photos.length < 2) {
      retryAfter.set(request.key, Date.now() + EMPTY_RETRY_MS)
      return []
    }
    saveNearbyCache(photoKey, photos, storage, now)
    retryAfter.delete(request.key)
    return photos
  })().catch(() => {
    retryAfter.set(request.key, Date.now() + API_RETRY_MS)
    return []
  }).finally(() => { pending.delete(request.key) })
  pending.set(request.key, task)
  return task
}
