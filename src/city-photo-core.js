// Genuine, reviewed Wikimedia Commons files. Add additional cities only after
// verifying that each image depicts the city and its license permits reuse.
// File URLs and current license/credit come from Wikimedia's imageinfo API.
const REVIEWED_CITY_GALLERIES = Object.freeze({
  'bg-varna': Object.freeze([
    'File:SeaGardenVarna.jpg', // public domain, Sea Garden
    'File:Sea Garden (Varna).jpg', // CC BY 4.0, Sea Garden
    'File:Independence Square Varna.jpg', // public domain, city centre
    'File:Varna Archaeological Museum, main entrance.jpg', // CC0, landmark
  ]),
  'bg-sofia': Object.freeze([
    'File:Panorama of Sofia.jpg', // CC0
    'File:Panorama of Sofia 1.jpg', // CC0
    'File:A view of Sofia city center..JPG', // CC0
    'File:Panorama of Sofia with the National Palace of Culture, the National Stadium, Sofia University Rectorate and the Cathedral of St. Alexander Nevsky.jpg', // CC0
  ]),
})

export const CITY_PHOTO_CACHE_MS = 30 * 24 * 60 * 60 * 1000
const CACHE_PREFIX = 'meteoPulseCityPhotoGalleryV1:'
const API = 'https://commons.wikimedia.org/w/api.php'
const CLIENT_ID = 'MeteoPulse/1.0 (https://ba4varov-wheater.vercel.app)'

const isValidCityPoint = place => Number.isFinite(place?.lat) && Math.abs(place.lat) <= 90 &&
  Number.isFinite(place?.lon) && Math.abs(place.lon) <= 180 && Boolean(place?.name?.trim())

const normalizedName = name => String(name).normalize('NFKC').trim().toLocaleLowerCase('en-US').split(',')[0].trim()

// Country/name AND approximate city centre must agree. We must not use a nearby
// city landmark merely because GPS coordinates happen to fall within its radius.
export function cityPhotoGalleryKey(place) {
  if (!isValidCityPoint(place) || (place.countryCode && place.countryCode.toUpperCase() !== 'BG')) return null
  const name = normalizedName(place.name)
  const centres = [
    { key: 'bg-varna', aliases: ['варна', 'varna'], lat: 43.214, lon: 27.914, id: 726050 },
    { key: 'bg-sofia', aliases: ['софия', 'sofia'], lat: 42.6977, lon: 23.3219, id: 727011 },
  ]
  const city = centres.find(item => (item.aliases.includes(name) || Number(place.geonameId) === item.id) &&
    Math.abs(place.lat - item.lat) <= .13 && Math.abs(place.lon - item.lon) <= .19)
  return city?.key ?? null
}

export function reviewedPhotoTitles(cityKey) {
  return REVIEWED_CITY_GALLERIES[cityKey] || []
}

export function cityDayOrdinal(now, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit'
    })
    const parts = Object.fromEntries(fmt.formatToParts(now).map(part => [part.type, part.value]))
    return Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86_400_000)
  } catch {
    const d = new Date(now)
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
  }
}

const stableHash = value => [...value].reduce((hash, ch) => (Math.imul(hash, 31) + ch.codePointAt(0)) | 0, 17)
export function selectCityPhoto(photos, cityKey, dayOrdinal) {
  if (!Array.isArray(photos) || !photos.length || !cityKey || !Number.isInteger(dayOrdinal)) return null
  const index = ((stableHash(cityKey) + dayOrdinal) % photos.length + photos.length) % photos.length
  return photos[index]
}

const textOnly = value => String(value || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#0*39;|&apos;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 100)

function imageUrlValid(value) {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' &&
      ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(u.hostname) &&
      u.pathname.startsWith('/wikipedia/commons/')
  } catch { return false }
}

function licenseDetails(meta) {
  const short = String(meta?.LicenseShortName?.value || '').trim()
  const publicDomain = /^(?:public domain|pd(?:-|$)|cc0(?:\s|$))/i.test(short)
  const ccBy = /^CC BY (?:[234]\.0)(?:\s|$)/i.test(short)
  // Exclude CC BY-SA, GFDL, "all rights reserved", unknown and NC licenses.
  if (!publicDomain && !ccBy) return null
  const url = String(meta?.LicenseUrl?.value || '')
  const safeUrl = /^https?:\/\/creativecommons\.org\/(?:licenses\/by\/|publicdomain\/)/i.test(url)
    ? url.replace(/^http:/, 'https:') : ''
  return { license: short, licenseUrl: safeUrl }
}

function parsePhoto(page) {
  const info = page?.imageinfo?.[0]
  if (!page?.title?.startsWith('File:') || !info ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(info.mime) ||
      !Number.isFinite(info.width) || !Number.isFinite(info.height) ||
      info.width < 1050 || info.height < 680 || info.width / info.height < 1.2) return null
  const url = info.thumburl || info.url
  if (!imageUrlValid(url)) return null
  const rights = licenseDetails(info.extmetadata)
  if (!rights) return null
  const artist = textOnly(info.extmetadata?.Artist?.value || info.user)
  if (!artist && !/^(?:public domain|pd|cc0)/i.test(rights.license)) return null
  return {
    id: page.title,
    url,
    filePage: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(page.title.replace(/ /g, '_')),
    author: artist || 'Wikimedia Commons',
    license: rights.license,
    licenseUrl: rights.licenseUrl,
  }
}

export function parseCityPhotoResponse(response, titles) {
  const pages = Object.values(response?.query?.pages || {})
  const approved = new Map(pages.map(page => [String(page.title || '').replace(/_/g, ' ').toLowerCase(), page]))
  return titles.map(title => parsePhoto(approved.get(title.replace(/_/g, ' ').toLowerCase())))
    .filter(Boolean).slice(0, 8)
}

export function cityPhotoApiUrl(cityKey) {
  const titles = reviewedPhotoTitles(cityKey)
  if (!titles.length) return null
  const url = new URL(API)
  for (const [key, value] of Object.entries({
    action: 'query', format: 'json', origin: '*', prop: 'imageinfo',
    iiprop: 'url|size|mime|user|extmetadata', iiurlwidth: '1440', titles: titles.join('|')
  })) url.searchParams.set(key, value)
  return url.toString()
}

export async function fetchCityPhotoGallery(cityKey, { fetcher = fetch, signal } = {}) {
  const url = cityPhotoApiUrl(cityKey)
  if (!url) return []
  const response = await fetcher(url, { signal, headers: { 'Api-User-Agent': CLIENT_ID } })
  if (!response.ok) throw new Error('Commons photos unavailable')
  return parseCityPhotoResponse(await response.json(), reviewedPhotoTitles(cityKey))
}

export function readCityPhotoCache(cityKey, storage, now = Date.now()) {
  if (!reviewedPhotoTitles(cityKey).length || !storage) return null
  try {
    const item = JSON.parse(storage.getItem(CACHE_PREFIX + cityKey) || 'null')
    if (!item || !Number.isFinite(item.savedAt) || item.savedAt > now ||
        now - item.savedAt >= CITY_PHOTO_CACHE_MS || !Array.isArray(item.photos)) return null
    const photos = item.photos.filter(photo => photo && imageUrlValid(photo.url) &&
      typeof photo.filePage === 'string' && photo.filePage.startsWith('https://commons.wikimedia.org/wiki/') &&
      typeof photo.licenseUrl === 'string' &&
      (!photo.licenseUrl || photo.licenseUrl.startsWith('https://creativecommons.org/')) &&
      typeof photo.author === 'string' && typeof photo.license === 'string' &&
      photo.author.length <= 100 && photo.license.length <= 40)
    return photos.length >= 2 && photos.length === item.photos.length && photos.length <= 8 ? photos : null
  } catch { return null }
}

export function saveCityPhotoCache(cityKey, photos, storage, now = Date.now()) {
  if (!storage || !reviewedPhotoTitles(cityKey).length || !Array.isArray(photos) || photos.length < 2) return
  try {
    storage.setItem(CACHE_PREFIX + cityKey, JSON.stringify({ savedAt: now, photos: photos.slice(0, 8) }))
  } catch { /* localStorage quota/private mode: photos still work for this view */ }
}


/* Document-scoped request coalescing. React StrictMode rehearses effects; a
 * browser refresh, remount, or two consumers must not issue duplicate calls.
 * Do not abort the shared request when a component unmounts; the result is
 * cached for the city but stale consumers discard their local state update. */
const activePhotoRequests = new Map()
const cityPhotoBackoffUntil = new Map()
const PHOTO_RETRY_MS = 15 * 60 * 1000

export async function loadCityPhotoGallery(cityKey, {
  storage = null, fetcher = fetch, now = Date.now()
} = {}) {
  if (!reviewedPhotoTitles(cityKey).length) return []
  const cached = readCityPhotoCache(cityKey, storage, now)
  if (cached) return cached
  if (now < (cityPhotoBackoffUntil.get(cityKey) || 0)) return []
  if (activePhotoRequests.has(cityKey)) return activePhotoRequests.get(cityKey)

  const task = fetchCityPhotoGallery(cityKey, { fetcher })
    .then(photos => {
      if (photos.length < 2) {
        cityPhotoBackoffUntil.set(cityKey, Date.now() + PHOTO_RETRY_MS)
        return []
      }
      saveCityPhotoCache(cityKey, photos, storage)
      cityPhotoBackoffUntil.delete(cityKey)
      return photos
    })
    .catch(() => {
      cityPhotoBackoffUntil.set(cityKey, Date.now() + PHOTO_RETRY_MS)
      return []
    })
    .finally(() => { activePhotoRequests.delete(cityKey) })
  activePhotoRequests.set(cityKey, task)
  return task
}
