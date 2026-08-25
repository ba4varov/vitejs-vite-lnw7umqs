import { useRef, useState } from 'react'
import { searchCities } from '../services/locationService'
import type { CitySuggestion, Language } from '../types/weather'

export const useCitySearch = (lang: Language) => {
  const [searchInput, setSearchInput] = useState('')
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([])
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchInput = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      try {
        setSuggestions(await searchCities(val, lang))
      } catch {
        setSuggestions([])
      }
    }, 300)
  }

  const clearSearch = () => {
    setSearchInput('')
    setSuggestions([])
  }

  return { searchInput, suggestions, setSuggestions, handleSearchInput, clearSearch }
}
