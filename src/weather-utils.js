// Open-Meteo returns hourly timestamps in the requested location's local time.
// Compare them with the API's own current timestamp, not the visitor's clock.
export function findHourlyStartIndex(times, currentTime) {
  if (!Array.isArray(times) || !times.length || !currentTime) return 0
  const currentHour = String(currentTime).slice(0, 13)
  const index = times.findIndex(time => String(time).slice(0, 13) >= currentHour)
  return index < 0 ? times.length : index
}

export function valuesByTime(hourly, field) {
  if (!Array.isArray(hourly?.time) || !Array.isArray(hourly?.[field])) return new Map()
  return new Map(hourly.time.map((time, index) => [time, hourly[field][index] ?? null]))
}
