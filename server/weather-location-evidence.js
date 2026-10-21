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
    if (!text || text.length > 100) return
    text = text.replace(/\s+(?:област|обл\.?|region|province|state)\s+(.+)$/iu, ', $1')
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
    // Sentence grammar is not independent proper-name evidence. Explicit
    // locatives still retain names that happen to coincide with these words.
    if (words.every(word => /^(?:i|can|will|what|how|and|should|could|would|do|does|is|are|the|a|an)$/iu.test(word))) continue
    if (extractTimeScope(name) || words.length === 1 && extractRequestedDate(name)) continue
    if (parseDeterministicQuestion(name, lang)?.intent !== 'unrelated') continue
    if (match.index === 0 && words.length === 1 && !extractTimeScope(message.slice(name.length).trim().split(/\s/u)[0] ?? '')) continue
    add(name, 'name')
  }
  // A route supplies a destination; its origin is evidence, not the forecast
  // target. Comparisons/disjunctions keep every place eligible for clarification.
  const comparison = /(?<!\p{L})(?:или|между|сравни|сравнение|or|between|compare)(?!\p{L})/iu.test(message)
  // Names in a list need not be capitalized. Discover each slot before applying
  // the probe budget, including comma-separated places before a final 'or'.
  const list = message.match(/(?<!\p{L})(?:във|в|in|at|near|между|between|сравни|compare)\s+(.+)/iu)?.[1]
  if (comparison && list) for (const slot of list.split(/\s*(?:,|(?<!\p{L})(?:или|и|or|and)(?!\p{L}))\s*/iu)) {
    const name = extractRequestedCity(`in ${slot}`, lang)
    if (name && parseDeterministicQuestion(name, lang)?.intent === 'unrelated') add(name, 'syntax', true)
  }
  const route = message.match(/(?<!\p{L})(?:от|from)\s+(.+?)\s+(?:до|към|to|towards?)\s+(.+)/iu)
  if (route && !comparison) {
    const origin = extractRequestedCity(`in ${route[1]}`, lang)
    const destination = extractRequestedCity(`in ${route[2]}`, lang)
    if (origin && destination) {
      add(origin, 'syntax', true); add(destination, 'syntax', true)
      for (const candidate of candidates) {
        if (normalizePlaceName(candidate.text) === normalizePlaceName(origin)) candidate.role = 'origin'
        if (normalizePlaceName(candidate.text) === normalizePlaceName(destination)) candidate.role = 'destination'
      }
    }
  }
  // Attach raw comma-qualified region/country evidence even if AI drops it.
  // Proper-name tokens inside the qualifier are not additional destinations.
  for (const candidate of candidates.slice()) {
    const escaped = candidate.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const qualified = message.match(new RegExp(`${escaped},\\s*((?:(?:област|обл\\.?|region|province|state)\\s+)?[\\p{Lu}][\\p{L}'’.-]*(?:\\s+[\\p{Lu}][\\p{L}'’.-]*){0,3})`, 'u'))
    if (!qualified) continue
    const qualifier = qualified[1]
    if (/^(?:как|какво|каква|какъв|колко|дали|кога|къде|ще|what|how|when|where|whether|will|would|should|can|could|is|are)(?:\s|$)/iu.test(qualifier)) continue
    candidate.text += `, ${qualifier}`
    for (let index = candidates.length - 1; index >= 0; index--) {
      if (candidates[index] !== candidate && normalizePlaceName(qualifier).includes(normalizePlaceName(candidates[index].text))) candidates.splice(index, 1)
    }
  }
  for (const qualified of candidates.slice().filter(candidate => candidate.text.includes(','))) {
    const qualifier = normalizePlaceName(qualified.text.split(',').slice(1).join(' '))
    for (let index = candidates.length - 1; index >= 0; index--) {
      if (candidates[index] !== qualified && (normalizePlaceName(candidates[index].text) === qualifier || candidates[index].strength === 'name' && normalizePlaceName(candidates[index].text) === normalizePlaceName(qualified.text.split(',')[0]))) candidates.splice(index, 1)
    }
  }
  for (const candidate of candidates) if (comparison) candidate.role = 'comparison'
  // Keep the three parallel probes budget, but fail closed when evidence was
  // truncated. An omitted fourth place must never authorize the first one.
  const bounded = candidates.slice(0, 3)
  if (candidates.length > bounded.length || list && list.split(',').length > 3) bounded.overflow = true
  return bounded
}

// This verifies location evidence only; it never changes the weather intent or
// time interpretation. Probe calls are bounded and parallel; the API caches them.
const samePlace = (a, b) => a && b && !('ambiguous' in a) && !('ambiguous' in b) && a.latitude === b.latitude && a.longitude === b.longitude

export async function groundLocation(candidates, requestedCity, explicitAI, resolve) {
  if (candidates.overflow) return { status: 'ambiguous', requestedCity: null, candidates: candidates.length }
  candidates = candidates.filter(candidate => candidate.role !== 'origin')
  if (!candidates.length) return { status: 'none', candidates: 0 }
  // The explicit destination is grounded independently of the interpreter's
  // citySource. A stale AI origin/context cannot redirect this route.
  const destination = candidates.find(candidate => candidate.role === 'destination')
  if (destination) { requestedCity = destination.text; explicitAI = true }

  const qualifiedCandidate = candidates.find(candidate => candidate.text.includes(',') && candidate.anchored)
  if (qualifiedCandidate) { requestedCity = qualifiedCandidate.text; explicitAI = true }
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
  if (candidates.some(candidate => candidate.role === 'comparison') && candidates.length > 1) return { status: 'ambiguous', requestedCity: null, candidates: candidates.length }
  // A qualified semantic place must be checked as a whole. A popular result
  // for the bare name cannot erase an explicitly specified region/country.
  if (explicitAI && requestedCity?.includes(',') && anchored && !sameQuery && !candidates.some(candidate => candidate.role === 'comparison')) {
    const qualified = aiPlace
    if (qualified && !('ambiguous' in qualified)) return { status: 'verified', place: qualified, candidates: candidates.length }
    return { status: qualified ? 'ambiguous' : 'unverified', requestedCity, candidates: candidates.length }
  }
  // A semantic subspan is its own geocoding candidate. Rejected surrounding
  // prose is not a geographic contradiction. An independently verified other
  // place (or an independently ambiguous name) still needs clarification.
  if (explicitAI && anchored && !sameQuery && aiPlace && !('ambiguous' in aiPlace)) {
    const conflict = probes.some(({ place }) => place && !samePlace(place, aiPlace))
    if (conflict) return { status: 'ambiguous', requestedCity: null, candidates: candidates.length }
    return { status: 'verified', place: aiPlace, candidates: candidates.length }
  }
  if (places.length === 1 && !probes.some(({ place }) => place && 'ambiguous' in place)) {
    const place = places[0]
    const locativeEvidence = probes.some(probe => samePlace(probe.place, place) && (probe.candidate.anchored ?? probe.candidate.strength !== 'name'))
    const semanticAgreement = explicitAI && (samePlace(sameQuery?.place, place) || samePlace(aiPlace, place))
    if (!locativeEvidence && !semanticAgreement) return { status: 'ambiguous', requestedCity: null, candidates: candidates.length }
    return { status: 'verified', place, candidates: candidates.length }
  }
  if (explicitAI && sameQuery?.place && !('ambiguous' in sameQuery.place)) return { status: 'verified', place: sameQuery.place, candidates: candidates.length }
  const ambiguous = probes.filter(({ place }) => place && 'ambiguous' in place)
  if (places.length > 1 || ambiguous.length) return { status: 'ambiguous', requestedCity: !places.length && ambiguous.length === 1 ? ambiguous[0].candidate.text : null, candidates: candidates.length }
  if (strong.length) return { status: 'unverified', requestedCity: strong[0].text, candidates: candidates.length }
  return { status: 'none', candidates: candidates.length }
}
