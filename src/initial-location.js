import { startupTiming } from './startup-timing.js'
import { acceptedPosition } from './location-accuracy.js'
export const INITIAL_LOCATION_TIMEOUT = 4500

// A single election survives StrictMode rehearsal. The startup deadline releases
// the UI, not an outstanding browser permission decision. Only that request may
// deliver a late result, until a default or a user action takes ownership.
export function createInitialLocation({ navigator: browser, confirmed = null, timeout = INITIAL_LOCATION_TIMEOUT, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let started = false, settled = false, defaultsDone = true, gpsDone = false
  let gps = null, timer, resolve, reason, permission, requested = false, lateAllowed = false, closed = false
  const listeners = new Set()
  const statusListeners = new Set()
  // The forecast deadline does not end a browser permission/GPS operation.
  // Keep its UI pending even when a confirmed fallback owns the forecast.
  const status = () => {
    if (!closed && (!settled || (!permission && !gpsDone) || (requested && !gpsDone))) return 'pending'
    return !closed && permission === 'prompt' && !requested ? 'allow' : 'retry'
  }
  const notifyStatus = () => { for (const listener of statusListeners) listener(status()) }
  const result = new Promise(done => { resolve = done })
  const fallback = () => reason ? { source: 'fallback', reason } : { source: 'fallback' }
  const finish = selection => {
    if (settled) return false
    settled = true
    cancel(timer)
    startupTiming.mark('location:ready')
    resolve(selection)
    notifyStatus()
    return true
  }
  const deliver = selection => {
    if (closed) return
    if (!settled) { finish(selection); closed = true }
    else if (lateAllowed) { lateAllowed = false; closed = true; for (const listener of listeners) listener(selection) }
    notifyStatus()
  }
  const complete = () => { if (defaultsDone && gpsDone) deliver(gps || fallback()) }
  const request = () => {
    if (closed || settled || requested || !defaultsDone) return
    // A manual choice survives reload. A previously accepted GPS location may
    // follow travel silently with granted permission, but never prompts again.
    if (confirmed && (confirmed.source !== 'geolocation' || permission !== 'granted')) {
      deliver({ source: 'place', place: confirmed, confirmed: true }); return
    }
    if (permission === 'denied') { reason = 'denied'; gpsDone = true; complete(); return }
    requested = true
    startupTiming.mark('gps:start')
    const fail = error => {
      if (gpsDone || closed) return
      startupTiming.mark('gps:end')
      reason = error?.code === 1 ? 'denied' : 'unavailable'
      gpsDone = true
      if (settled) deliver(fallback()); else complete()
    }
    try {
      browser.geolocation.getCurrentPosition(position => {
        if (gpsDone || closed) return
        startupTiming.mark('gps:end')
        gpsDone = true
        if (!acceptedPosition(position?.coords)) reason = 'accuracy'
        else gps = { source: 'geolocation', lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy }
        if (settled) deliver(gps || fallback()); else complete()
      }, fail, { timeout, maximumAge: 60000 })
    } catch (error) { fail(error) }
  }
  return {
    get settled() { return settled },
    get status() { return status() },
    subscribeStatus(listener) { statusListeners.add(listener); return () => statusListeners.delete(listener) },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    waitForDefault() { if (!settled) { defaultsDone = false; startupTiming.mark('default:start') } },
    defaultResolved(place) {
      if (!defaultsDone) startupTiming.mark('default:end')
      if (settled) return false
      defaultsDone = true
      if (place) { closed = true; return finish({ source: 'place', place }) }
      if (permission) request()
      complete()
      return true
    },
    manual() { closed = true; lateAllowed = false; finish({ source: 'manual' }); notifyStatus() },
    start() {
      if (started || settled) return result
      started = true
      startupTiming.mark('permission:start')
      timer = schedule(() => {
        lateAllowed = requested && !gpsDone && !confirmed
        finish(gps || fallback())
      }, timeout)
      if (!browser?.geolocation?.getCurrentPosition) {
        gpsDone = true
        startupTiming.mark('permission:end')
        complete()
        return result
      }
      // Safari and other browsers without Permissions API still support the
      // standard geolocation permission flow. A stalled query remains bounded.
      Promise.resolve().then(() => browser?.permissions?.query({ name: 'geolocation' })).catch(() => null).then(status => {
        startupTiming.mark('permission:end')
        if (closed) return
        permission = status?.state || 'prompt'
        if (!settled) request()
        notifyStatus()
      })
      return result
    },
  }
}
