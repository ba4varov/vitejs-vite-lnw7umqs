// Editorially verified city photography. URLs point directly at optimized
// Wikimedia Commons thumbnails, so these two commonly used cities do not wait
// for a metadata API round trip. Keep author, source and license visible.
// Source pages checked 2026-11-15; add entries only after checking the photo.
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/'
const BY4 = 'https://creativecommons.org/licenses/by/4.0/'

function photo(file, hash, author, license, licenseUrl, width=960) {
  const encoded = encodeURIComponent(file.replaceAll(' ', '_'))
  return Object.freeze({
    id: 'File:' + file,
    url: `https://upload.wikimedia.org/wikipedia/commons/thumb/${hash[0]}/${hash}/${encoded}/${width}px-${encoded}`,
    filePage: 'https://commons.wikimedia.org/wiki/File:' + encoded,
    author, license, licenseUrl,
  })
}

const FEATURED = Object.freeze({
  'featured:fr-paris': Object.freeze([
    photo('City view of Paris (Unsplash).jpg', '9a', 'Paul Dufour', 'CC0 1.0', CC0),
    photo('Philharmonie de Paris, view from balcony to city.jpg', 'a7', 'Gerda Arendt', 'CC0 1.0', CC0),
    photo('Paris Montmartre skyline during sunset 2026-01-03.jpg', '76', 'Renée Kools', 'CC BY 4.0', BY4),
  ]),
  'featured:ae-dubai': Object.freeze([
    photo('Dubai-Skyline-2019.jpg', '07', 'CommunistSquared', 'CC0 1.0', CC0),
    photo('View of Dubai.JPG', 'ef', 'Я', 'CC0 1.0', CC0),
  ]),
})

const normalized = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US').split(',')[0]
const validCoords = place => Number.isFinite(place?.lat) && Number.isFinite(place?.lon)
const near = (place, lat, lon) => Math.abs(place.lat - lat) < .11 && Math.abs(place.lon - lon) < .16

export function featuredCityPhotoKey(place) {
  if (!validCoords(place)) return null
  const name = normalized(place.name)
  const country = String(place.countryCode || '').toUpperCase()
  if (['париж','paris'].includes(name) && (!country || country === 'FR') &&
      near(place,48.8566,2.3522)) return 'featured:fr-paris'
  if (['дубай','dubai'].includes(name) && (!country || country === 'AE') &&
      near(place,25.2048,55.2708)) return 'featured:ae-dubai'
  return null
}

export function featuredCityPhotos(key) {
  return FEATURED[key] || []
}
