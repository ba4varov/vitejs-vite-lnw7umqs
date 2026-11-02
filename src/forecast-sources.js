import { startupTiming } from './startup-timing.js'
import { hourlyNumber, meanObservation, valuesByTime } from './weather-utils.js'

// A request generation owns all three sources. Abort reduces wasted work; the
// generation + location checks also protect JSON parsing and ignored aborts.
export const FORECAST_REFRESH_MS = 15 * 60 * 1000
export const FORECAST_MAX_AGE_MS = 30 * 60 * 1000
export function forecastFreshness(updated, now = Date.now()) {
  const age = updated == null ? Infinity : now - Number(updated)
  return { usable: age >= 0 && age <= FORECAST_MAX_AGE_MS, fresh: age >= 0 && age < FORECAST_REFRESH_MS }
}
// Document-scoped: a React remount or city change must not bypass provider cooldown.
const providerGate = { until: 0 }
export function createForecastRequests(fetcher = (...args) => fetch(...args), { now = Date.now, gate = providerGate } = {}) {
  let generation = 0, controller
  return {
    cancel() { generation++; controller?.abort() },
    start(urls, isLocationCurrent, onSupplement) {
      controller?.abort()
      const ownController = controller = new AbortController()
      const ticket = ++generation
      const current = () => ticket === generation && isLocationCurrent()
      const read = async (url, source) => {
        if (source === 'weather' && now() < gate.until) throw Object.assign(new Error('Provider cooling down'), { status: 503 })
        if (source === 'weather') startupTiming.mark('weather:start')
        const response = await fetcher(url, { signal: ownController.signal })
        if (source === 'weather') startupTiming.mark('weather:response')
        if (!response.ok) {
          if (source === 'weather' && [503, 429].includes(response.status)) {
            const retry = response.headers?.get('Retry-After')
            const seconds = retry && /^\d+$/.test(retry.trim()) ? Number(retry) : NaN
            const deadline = Number.isFinite(seconds) ? now() + seconds * 1000 : Date.parse(retry)
            gate.until = Math.max(gate.until, now() + FORECAST_REFRESH_MS, Number.isFinite(deadline) ? deadline : 0)
          }
          throw Object.assign(new Error('Forecast source unavailable'), { status: response.status })
        }
        const data = await response.json()
        startupTiming.mark(source === 'weather' ? 'weather:parsed' : `${source}:end`)
        return data
      }
      // Launch every source before awaiting any one of them. Each supplementary
      // branch consumes its rejection independently, even if the main fails.
      const main = read(urls.weather, 'weather').catch(error => { startupTiming.mark('weather:error'); throw error })
      for (const source of now() < gate.until ? [] : ['marine', 'aqi']) {
        void read(urls[source], source).then(data => {
          const fields = source === 'marine' ? ['sea_surface_temperature'] : ['european_aqi', 'pm10', 'pm2_5']
          const hasCurrent = fields.some(field => Object.hasOwn(data?.current || {}, field))
          const hasHourly = Array.isArray(data?.hourly?.time) && fields.some(field => Array.isArray(data?.hourly?.[field]))
          if (!hasCurrent && !hasHourly) throw new Error('Incomplete forecast source')
          if (current()) onSupplement(source, data)
        }).catch(() => { startupTiming.mark(`${source}:end`); if (current()) onSupplement(source, null) })
      }
      return { main, current }
    },
  }
}

export function enrichForecast(weather, hourly, daily, sources) {
  const marine = sources?.marine, aqi = sources?.aqi
  const sea = valuesByTime(marine?.hourly, 'sea_surface_temperature')
  const air = valuesByTime(aqi?.hourly, 'european_aqi')
  return {
    weather: weather && { ...weather,
      seaTemp: hourlyNumber(marine?.current?.sea_surface_temperature),
      aqi: hourlyNumber(aqi?.current?.european_aqi),
      pm10: hourlyNumber(aqi?.current?.pm10, false),
      pm25: hourlyNumber(aqi?.current?.pm2_5, false),
    },
    hourly: hourly.map(hour => ({ ...hour, seaTemp: hourlyNumber(sea.get(hour.time)), aqi: hourlyNumber(air.get(hour.time)) })),
    daily: daily.map(day => ({ ...day, seaTemp: hourlyNumber(meanObservation(day.seaTimes.map(time => sea.get(time)))) })),
  }
}
