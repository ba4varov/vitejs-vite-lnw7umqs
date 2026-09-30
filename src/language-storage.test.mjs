import test from 'node:test'
import assert from 'node:assert/strict'
import { LANGUAGE_STORAGE_KEY, loadLanguage, saveLanguage } from './language-storage.js'

const memoryStorage = initial => {
  const values = new Map(Object.entries(initial ?? {}))
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    value: key => values.get(key),
  }
}

test('language selection survives a reload for Bulgarian and English', () => {
  const storage = memoryStorage()
  assert.equal(saveLanguage('en', storage), true)
  assert.equal(loadLanguage(storage), 'en')
  assert.equal(saveLanguage('bg', storage), true)
  assert.equal(loadLanguage(storage), 'bg')
  assert.equal(storage.value(LANGUAGE_STORAGE_KEY), 'bg')
})

test('missing and invalid language settings fall back to Bulgarian', () => {
  assert.equal(loadLanguage(memoryStorage()), 'bg')
  assert.equal(loadLanguage(memoryStorage({ [LANGUAGE_STORAGE_KEY]: 'de' })), 'bg')
})

test('unavailable storage is handled without an exception', () => {
  const unavailable = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
  }
  assert.equal(loadLanguage(unavailable), 'bg')
  assert.equal(saveLanguage('en', unavailable), false)
})
