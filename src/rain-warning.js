import { localHourEpoch } from '../server/planner-logic.js'

const HOUR = 3600000
// Product thresholds, independent of persisted notification kinds and official codes.
export function analyzeRain(forecast, now = Date.now()) {
  if (!forecast || !Array.isArray(forecast.hours) || !Number.isFinite(now)) return null
  let hours
  try {
    hours = forecast.hours.map(h => ({
      start: typeof h?.time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(h.time) ? localHourEpoch(h.time, forecast.timeZone) : null,
      rain: h?.rain,
    }))
  } catch { return null }
  const maxima = []
  for (const duration of [1, 6, 24]) {
    let best = null
    for (let i = 0; i + duration <= hours.length; i++) {
      const window = hours.slice(i, i + duration), start = window[0].start
      // Omit partial current hours and any incomplete, ambiguous or unordered window.
      if (start === null || start < now || start + duration * HOUR > now + 72 * HOUR ||
          window.some((h, j) => h.start !== start + j * HOUR || typeof h.rain !== 'number' || !Number.isFinite(h.rain) || h.rain < 0 || h.rain > 500)) continue
      const amount = Math.round(window.reduce((sum, h) => sum + h.rain, 0) * 1e9) / 1e9
      if (!best || amount > best.amount) best = { duration, amount, start, end: start + duration * HOUR }
    }
    if (best) maxima.push(best)
  }
  const candidates = maxima.map(w => ({ ...w, level: w.duration === 24 ? (w.amount >= 65 ? 3 : w.amount >= 35 ? 2 : w.amount >= 15 ? 1 : 0) : w.amount >= (w.duration === 6 ? 20 : 10) ? 2 : 0 }))
    .filter(w => w.level > 0).sort((a, b) => b.level - a.level || b.duration - a.duration)
  return { maxima, warning: candidates[0] || null }
}
