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

// Preserve absent observations instead of coercing null to zero.
export function hourlyNumber(value, rounded = true) {
  return typeof value === "number" && Number.isFinite(value) ? (rounded ? Math.round(value) : value) : null
}

export function formatWeatherValue(value, unit = '') {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}${unit}` : '—'
}

export function forecastOverview(item, period, language) {
  const daily = period === 'day', bg = language === 'bg'
  const temperature = daily ? item.max : item.temp
  const temperatureLabel = bg ? (daily ? 'Дневна максимална температура' : 'Температура за часа') : (daily ? 'Daily maximum temperature' : 'Temperature for this hour')
  const rainLabel = bg ? (daily ? 'Общи дневни валежи' : 'Валежи за часа') : (daily ? 'Total daily precipitation' : 'Precipitation for this hour')
  const windLabel = bg ? (daily ? 'Дневна максимална скорост на вятъра' : 'Скорост на вятъра за часа') : (daily ? 'Daily maximum wind speed' : 'Wind speed for this hour')
  return { temperature: formatWeatherValue(temperature, '°C'), rain: formatWeatherValue(item.rain, bg ? ' мм' : ' mm'), wind: formatWeatherValue(item.wind, bg ? ' км/ч' : ' km/h'), temperatureLabel, rainLabel, windLabel, explanation: `${temperatureLabel}; ${rainLabel}; ${windLabel}` }
}

export function meanObservation(values) {
  const present = values.filter(value => typeof value === 'number' && Number.isFinite(value))
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null
}
