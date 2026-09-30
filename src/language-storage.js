export const LANGUAGE_STORAGE_KEY = 'meteoPulseLanguage'

export const isLanguage = value => value === 'bg' || value === 'en'

export const loadLanguage = (storage) => {
  try {
    const source = storage ?? globalThis.localStorage
    const value = source.getItem(LANGUAGE_STORAGE_KEY)
    return isLanguage(value) ? value : 'bg'
  } catch {
    return 'bg'
  }
}

export const saveLanguage = (language, storage) => {
  if (!isLanguage(language)) return false
  try {
    const target = storage ?? globalThis.localStorage
    target.setItem(LANGUAGE_STORAGE_KEY, language)
    return true
  } catch {
    return false
  }
}
