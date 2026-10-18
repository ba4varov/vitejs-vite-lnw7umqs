import { extractRequestedCity, extractRequestedDate, extractTimeScope, parseDeterministicQuestion } from './weather-chat-core.js'

export const normalizePlaceName = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

// Generic one-edit/transposition distance, not a table of misspelled words.
export function oneEditApart(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return a === b
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) rows[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1)
  }
  return rows[a.length][b.length] <= 1
}

export function collectLocationCandidates(message, lang = 'bg') {
  const candidates = [], seen = new Set()
  const add = (text, strength, anchored = strength !== 'name') => {
    if (!text || text.length > 100 || candidates.length >= 3) return
    const key = normalizePlaceName(text)
    if (!key || seen.has(key)) return
    seen.add(key); candidates.push({ text, strength, anchored })
  }
  add(extractRequestedCity(message, lang), 'syntax')
  // Recover a locative construction by comparing its connector to the existing
  // grammar. Only geocoding can turn the resulting text into a verified place.
  const connectors = lang === 'bg' ? ['във'] : ['in', 'at', 'near']
  for (const match of message.matchAll(/(?<!\p{L})(\p{L}{1,5})(?=\s)/gu)) {
    const token = match[1].toLocaleLowerCase()
    if (connectors.includes(token)) continue
    const connector = connectors.find(value => oneEditApart(token, value))
    if (!connector) continue
    const rewritten = message.slice(0, match.index) + connector + message.slice(match.index + match[1].length)
    const candidate = extractRequestedCity(rewritten, lang)
    if (candidate && parseDeterministicQuestion(candidate, lang)?.intent === 'unrelated') add(candidate, /^\p{Lu}/u.test(candidate) && token.length > 1 ? 'connector' : 'name', true)
  }
  // Proper-name evidence is independent of the connector. Sentence-initial
  // grammar words and standalone temporal/measure words are not place evidence.
  for (const match of message.matchAll(/(?<!\p{L})(\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){0,3})/gu)) {
    const name = match[1].replace(/[.!?]+$/u, '')
    const words = name.split(/\s/u)
    if (name.length < 2) continue
    if (extractTimeScope(name) || words.length === 1 && extractRequestedDate(name)) continue
    if (parseDeterministicQuestion(name, lang)?.intent !== 'unrelated') continue
    if (match.index === 0 && words.length === 1 && !extractTimeScope(message.slice(name.length).trim().split(/\s/u)[0] ?? '')) continue
    add(name, 'name')
  }
  return candidates
}

// This verifies location evidence only; it never changes the weather intent or
// time interpretation. Probe calls are bounded and parallel; the API caches them.
const samePlace = (a, b) => a && b && !('ambiguous' in a) && !('ambiguous' in b) && a.latitude === b.latitude && a.longitude === b.longitude

export async function groundLocation(candidates, requestedCity, explicitAI, resolve) {
  if (!candidates.length) return { status: 'none', candidates: 0 }
  const sameCandidate = requestedCity && candidates.find(candidate => normalizePlaceName(candidate.text) === normalizePlaceName(requestedCity))
  const anchored = requestedCity && candidates.some(candidate => {
    const raw = normalizePlaceName(candidate.text), canonical = normalizePlaceName(requestedCity.split(',')[0])
    return raw === canonical || raw.startsWith(canonical + ' ') || raw.endsWith(' ' + canonical) || raw.includes(' ' + canonical + ' ') || Math.min(raw.length, canonical.length) >= 4 && oneEditApart(raw, canonical)
  })
  const [probes, aiPlace] = await Promise.all([
    Promise.all(candidates.map(async candidate => ({ candidate, place: await resolve(candidate.text) }))),
    explicitAI && requestedCity && !sameCandidate ? resolve(requestedCity) : null
  ])
  const unique = new Map()
  for (const { place } of probes) if (place && !('ambiguous' in place)) unique.set(`${place.latitude}:${place.longitude}`, place)
  const places = [...unique.values()]
  const strong = candidates.filter(candidate => candidate.strength !== 'name')
  const sameQuery = sameCandidate && probes.find(({ candidate }) => candidate === sameCandidate)
  // A qualified semantic place must be checked as a whole. A popular result
  // for the bare name cannot erase an explicitly specified region/country.
  if (explicitAI && requestedCity?.includes(',') && anchored && !sameQuery) {
    const qualified = aiPlace
    if (qualified && !('ambiguous' in qualified)) return { status: 'verified', place: qualified, candidates: candidates.length }
    return { status: qualified ? 'ambiguous' : 'unverified', requestedCity, candidates: candidates.length }
  }
  if (places.length === 1 && !probes.some(({ place }) => place && 'ambiguous' in place)) {
    const place = places[0]
    const locativeEvidence = probes.some(probe => samePlace(probe.place, place) && (probe.candidate.anchored ?? probe.candidate.strength !== 'name'))
    const semanticAgreement = explicitAI && (samePlace(sameQuery?.place, place) || samePlace(aiPlace, place))
    if (!locativeEvidence && !semanticAgreement) return { status: 'ambiguous', requestedCity: null, candidates: candidates.length }
    return { status: 'verified', place, candidates: candidates.length }
  }
  if (explicitAI && sameQuery?.place && !('ambiguous' in sameQuery.place)) return { status: 'verified', place: sameQuery.place, candidates: candidates.length }
  if (explicitAI && requestedCity && anchored && !sameQuery) {
    if (aiPlace && !('ambiguous' in aiPlace) && (!places.length || places.some(place => place.latitude === aiPlace.latitude && place.longitude === aiPlace.longitude))) return { status: 'verified', place: aiPlace, candidates: candidates.length }
  }
  const ambiguous = probes.filter(({ place }) => place && 'ambiguous' in place)
  if (places.length > 1 || ambiguous.length) return { status: 'ambiguous', requestedCity: !places.length && ambiguous.length === 1 ? ambiguous[0].candidate.text : null, candidates: candidates.length }
  if (strong.length) return { status: 'unverified', requestedCity: strong[0].text, candidates: candidates.length }
  return { status: 'none', candidates: candidates.length }
}
