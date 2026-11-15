import { useEffect, useMemo, useState } from 'react'
import { autoCityPhotoRequest, loadNearbyCityGallery } from './city-photo-auto.js'
import {
  cityDayOrdinal, cityPhotoGalleryKey, loadCityPhotoGallery, selectCityPhoto
} from './city-photo-core.js'

type Place = {
  name: string; lat: number; lon: number;
  geonameId?: number; countryCode?: string; country?: string
}
type Photo = {
  id: string; url: string; author: string; filePage: string;
  license: string; licenseUrl: string
}

export function CityPhotoLayer({
  place, accepted, now, timeZone, lang, source
}: {
  place: Place; accepted: boolean; now: number; timeZone?: string; lang: 'bg' | 'en';
  source?: 'default' | 'quick' | 'search' | 'place' | 'geolocation'
}) {
  const curatedKey = accepted ? cityPhotoGalleryKey(place) : null
  const automatic = accepted && !curatedKey ? autoCityPhotoRequest(place, source) : null
  const cityKey = curatedKey || automatic?.key || null
  const [gallery, setGallery] = useState<{ key: string; photos: Photo[] } | null>(null)
  const [failedUrl, setFailedUrl] = useState('')

  useEffect(() => {
    setGallery(null)
    setFailedUrl('')
    if (!cityKey) return

    let active = true
    // localStorage may be disabled by browser privacy settings.
    let storage: Storage | null = null
    try { storage = window.localStorage } catch { /* in-memory view still works */ }
    // Editorial picks take priority. Automatic candidates are not shown when
    // there is insufficient licensed, geotag-verified variety for this city.
    const request = curatedKey
      ? loadCityPhotoGallery(curatedKey, { storage })
      : automatic ? loadNearbyCityGallery(automatic, { storage, lang }) : Promise.resolve([])
    void request.then(photos => {
      if (active && photos.length >= 2) setGallery({ key: cityKey, photos })
    })
    return () => { active = false }
  }, [cityKey, curatedKey, lang])

  const day = cityDayOrdinal(new Date(now), timeZone)
  const photo: Photo | null = useMemo(
    () => gallery && gallery.key === cityKey ? selectCityPhoto(gallery.photos, cityKey, day) : null,
    [gallery, cityKey, day]
  )
  if (!photo || photo.url === failedUrl) return null

  const bg = lang === 'bg'
  return <>
    <img
      key={photo.url}
      className="weather-city-photo"
      src={photo.url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailedUrl(photo.url)}
    />
    <div className="weather-city-photo-credit">
      <span>{bg ? 'Снимка (изрязана, не на живо):' : 'Photo (cropped, not live):'}</span>
      <a href={photo.filePage} target="_blank" rel="noopener noreferrer"
        title={bg ? 'Източник и автор · Wikimedia Commons. Визуално изрязана за оформление.' : 'Source and author · Wikimedia Commons. Cropped for layout.'}>
        {photo.author}
      </a>
      <span aria-hidden="true">·</span>
      <a href={photo.licenseUrl || photo.filePage} target="_blank" rel="noopener noreferrer">
        {photo.license}
      </a>
    </div>
  </>
}
