import { safeEntry } from './startup-lifecycle.js'
import { phases } from './startup-timing.js'
const counter = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000
const elapsed = n => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER
const exact = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(b).every(k => a[k] === b[k])
// Fail closed: no free text, URLs, identifiers or unknown fields are exportable.
// document/instance are existing tab-local counters, never account/device IDs.
export function startupReport(lifecycle, timing) {
 if (!lifecycle || Object.keys(lifecycle).sort().join() !== 'document,events' || !counter(lifecycle.document) || !Array.isArray(lifecycle.events) || lifecycle.events.length > 200 || !Array.isArray(timing) || timing.length > phases.size) throw Error('Unsafe diagnostic report')
 const events = lifecycle.events.map(entry => {
  const safe = safeEntry(entry)
  if (!safe || !elapsed(entry.ms) || !exact(entry, safe)) throw Error('Unsafe diagnostic entry')
  return safe
 })
 const times = timing.map(entry => {
  if (!entry || !phases.has(entry.phase) || !elapsed(entry.ms) || !exact(entry, {phase:entry.phase, ms:entry.ms})) throw Error('Unsafe timing entry')
  return {phase:entry.phase, ms:entry.ms}
 })
 return JSON.stringify({lifecycle:{document:lifecycle.document, events}, timing:times}, null, 2)
}
