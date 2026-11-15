import { useEffect, useMemo, useState } from 'react'
import {
  cityDayOrdinal, cityPhotoGalleryKey, fetchCityPhotoGallery,
  readCityPhotoCache, saveCityPhotoCache, selectCityPhoto
} from './city-photo-core.js'

type Place = {
  name: string; lat: number; lon: number;
  geonameId?: number; countryCode?: string
}
type Photo = {
  id: string; url: string; author: string; filePage: string;
  license: string; licenseUrl: string
}

export function CityPhotoLayer({
  place, accepted, now, timeZone, lang
}: {
  place: Place; accepted: boolean; now: number; timeZone?: string; lang: 'bg' | 'en'
}) {
  const cityKey = accepted ? cityPhotoGalleryKey(place) : null
  const [gallery, setGallery] = useState<{ key: string; photos: Photo[] } | null>(null)
  const [failedUrl, setFailedUrl] = useState('')

  useEffect(() => {
    setGallery(null)
    setFailedUrl('')
    if (!cityKey) return

    const cached = readCityPhotoCache(cityKey, localStorage)
    if (cached) {
      setGallery({ key: cityKey, photos: cached })
      return
    }

    let active = true
    const controller = new AbortController()
    void fetchCityPhotoGallery(cityKey, { signal: controller.signal })
      .then(photos => {
        if (!active || photos.length < 2) return
        // Only a reviewed, sufficiently varied collection may replace the sky.
        saveCityPhotoCache(cityKey, photos, localStorage)
        setGallery({ key: cityKey, photos })
      })
      .catch(() => { /* Keep weather-driven background if Commons is unavailable. */ })

    return () => { active = false; controller.abort() }
  }, [cityKey])

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
      <span>{bg ? 'Снимка, не на живо:' : 'Photo, not live:'}</span>
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
