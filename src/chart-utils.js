export const CHART_METRICS = {
  temp: { field: 'temp', icon: '🌡️', color: '#f97316', kind: 'line' },
  rain: { field: 'rain', icon: '🌧️', color: '#3b82f6', kind: 'bar' },
  wind: { field: 'wind', icon: '🌬️', color: '#0d9488', kind: 'line' },
  pressure: { field: 'pressure', icon: '◉', color: '#8b5cf6', kind: 'line' },
  aqi: { field: 'aqi', icon: '◌', color: '#0ea5e9', kind: 'line' }
}

export function chartValues(hourly, type) {
  const field = CHART_METRICS[type]?.field || type
  return hourly.slice(0, 24).map(point => {
    if (point?.[field] === null || point?.[field] === undefined || point?.[field] === '') return null
    const value = Number(point?.[field])
    return Number.isFinite(value) ? value : null
  })
}

export function visibleTimeIndexes(length, mobile = false) {
  if (!length) return []
  const step = mobile ? 6 : 3
  const indexes = []
  for (let index = 0; index < length; index += step) indexes.push(index)
  if (indexes[indexes.length - 1] !== length - 1) indexes.push(length - 1)
  return indexes
}

export function valueRange(values, type) {
  const valid = values.filter(Number.isFinite)
  if (!valid.length) return { min: 0, max: 1, step: 1 }
  const low = Math.min(...valid), high = Math.max(...valid)
  if (type === 'rain') return { min: 0, max: Math.max(1, high * 1.12), step: Math.max(.1, high / 4) }
  const minimumPadding = type === 'pressure' ? 1 : type === 'temp' ? 2 : 1
  const padding = Math.max(minimumPadding, (high - low) * .12)
  const min = low - padding, max = high + padding
  const rawStep = (max - min) / 4
  return { min, max, step: type === 'pressure' ? Math.max(1, Math.ceil(rawStep)) : Math.max(1, Math.ceil(rawStep)) }
}

export function chartTheme(dark, mobile = false, reducedMotion = false) {
  return {
    text: dark ? '#cbd5e1' : '#475569',
    grid: dark ? 'rgba(203,213,225,.13)' : 'rgba(100,116,139,.14)',
    tooltipBackground: dark ? '#e2e8f0' : '#0f172a',
    tooltipText: dark ? '#0f172a' : '#f8fafc',
    timeLabelStep: mobile ? 6 : 3,
    animationDuration: reducedMotion ? 0 : 350,
    maintainAspectRatio: false
  }
}

export function chartSummary(values) {
  const valid = values.filter(Number.isFinite)
  return valid.length ? { current: values[0] ?? valid[0], min: Math.min(...valid), max: Math.max(...valid) } : null
}
