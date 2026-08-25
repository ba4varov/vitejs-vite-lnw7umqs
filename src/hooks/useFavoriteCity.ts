import { useEffect, useState } from 'react'
import type { Coordinates, FavoriteCity } from '../types/weather'

const FAVORITE_KEY = 'bobbyWeatherFav'

export const useFavoriteCity = () => {
  const [favoriteCity, setFavoriteCity] = useState<FavoriteCity | null>(null)

  useEffect(() => {
    const savedFav = localStorage.getItem(FAVORITE_KEY)
    if (savedFav) {
      try {
        setFavoriteCity(JSON.parse(savedFav))
      } catch {
        localStorage.removeItem(FAVORITE_KEY)
      }
    }
  }, [])

  const toggleFavorite = (city: string, coords: Coordinates) => {
    if (favoriteCity && favoriteCity.name === city) {
      setFavoriteCity(null)
      localStorage.removeItem(FAVORITE_KEY)
    } else {
      const newFav = { name: city, lat: coords.lat, lon: coords.lon }
      setFavoriteCity(newFav)
      localStorage.setItem(FAVORITE_KEY, JSON.stringify(newFav))
    }
  }

  return { favoriteCity, toggleFavorite }
}
