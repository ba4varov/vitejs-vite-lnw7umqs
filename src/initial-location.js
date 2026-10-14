import { startupTiming } from './startup-timing.js'
export const INITIAL_LOCATION_TIMEOUT = 4500

// One bounded startup election, shared by StrictMode's effect rehearsal.
// Default-place resolution and permission/GPS run concurrently; a known default
// wins over GPS. A settled election never accepts another automatic result.
export function createInitialLocation({ navigator: browser, timeout = INITIAL_LOCATION_TIMEOUT, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let started = false, settled = false, defaultsDone = true, gpsDone = false
  let gps = null, timer, resolve
  const result = new Promise(done => { resolve = done })
  const finish = selection => {
    if (settled) return false
    settled = true
    cancel(timer)
    startupTiming.mark('location:ready')
    resolve(selection)
    return true
  }
  const complete = () => { if (defaultsDone && gpsDone) finish(gps || { source: 'fallback' }) }
  return {
    get settled() { return settled },
    waitForDefault() { if (!settled) { defaultsDone = false; startupTiming.mark('default:start') } },
    defaultResolved(place) {
      if (!defaultsDone) startupTiming.mark('default:end')
      if (settled) return false
      defaultsDone = true
      if (place) return finish({ source: 'place', place })
      complete()
      return true
    },
    manual() { finish({ source: 'manual' }) },
    start() {
      if (started || settled) return result
      started = true
      startupTiming.mark('permission:start')
      timer = schedule(() => finish(gps || { source: 'fallback' }), timeout)
      // Automatic access must not display a permission prompt. Unsupported or
      // stalled Permissions APIs fall back; the explicit location button can ask.
      Promise.resolve().then(() => browser?.permissions?.query({ name: 'geolocation' })).then(permission => {
        startupTiming.mark('permission:end')
        if (settled) return
        if (permission?.state !== 'granted' || !browser?.geolocation?.getCurrentPosition) { gpsDone = true; complete(); return }
        startupTiming.mark('gps:start')
        browser.geolocation.getCurrentPosition(position => {
          startupTiming.mark('gps:end')
          if (settled) return
          const lat = position?.coords?.latitude, lon = position?.coords?.longitude
          if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) { gpsDone = true; complete(); return }
          gps = { source: 'geolocation', lat, lon }
          gpsDone = true
          complete()
        }, () => { startupTiming.mark('gps:end'); if (!settled) { gpsDone = true; complete() } }, { timeout, maximumAge: 60000 })
      }).catch(() => { startupTiming.mark('permission:end'); if (!settled) { gpsDone = true; complete() } })
      return result
    },
  }
}
