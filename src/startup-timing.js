// Opt-in, page-lifetime diagnostics. Only fixed phase names and elapsed numbers;
// no URLs, coordinates, city names, response bodies, storage, or telemetry.
const phases = new Set(['module', 'react', 'permission:start', 'permission:end', 'gps:start', 'gps:end', 'default:start', 'default:end', 'location:ready', 'reverse:start', 'reverse:end', 'weather:start', 'weather:response', 'weather:parsed', 'weather:processed', 'weather:error', 'card:commit', 'card:paint', 'marine:end', 'aqi:end'])
export function createStartupTiming(enabled, now = () => performance.now()) {
  const events = []
  return {
    enabled,
    mark(phase) {
      if (!enabled || !phases.has(phase) || events.some(event => event.phase === phase)) return
      events.push({ phase, ms: Math.round(now() * 10) / 10 })
    },
    snapshot() { return events.map(event => ({ ...event })) },
  }
}
export const startupTiming = createStartupTiming(typeof location !== 'undefined' && new URLSearchParams(location.search).get('startupTiming') === '1')
if (typeof window !== 'undefined' && new URLSearchParams(location.search).get('startupTiming') === '1') {
  Object.defineProperty(window, 'meteoStartupTiming', { value: () => startupTiming.snapshot(), configurable: true })
}
startupTiming.mark('module')
