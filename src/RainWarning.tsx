import { useMemo } from 'react'
import { analyzeRain } from './rain-warning.js'

export function RainWarning({ forecast, city, lang, updated }: { forecast: any; city: string; lang: 'bg' | 'en'; updated: Date | null }) {
  const result = useMemo(() => analyzeRain(forecast, updated?.getTime()), [forecast, updated])
  const warning = result?.warning
  if (!warning || !updated) return null
  const bg = lang === 'bg'
  const title = warning.level === 3 ? (bg ? 'Много голямо количество валежи' : 'Very high rainfall accumulation') : warning.level === 1 ? (bg ? 'Повишено внимание за валежи' : 'Increased attention for rainfall') : (bg ? 'Очакват се значителни валежи' : 'Significant rainfall expected')
  const formatter = new Intl.DateTimeFormat(bg ? 'bg-BG' : 'en-GB', { timeZone: forecast.timeZone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const format = (epoch: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(epoch).map(part => [part.type, part.value]))
    return `${parts.day} ${parts.month}, ${parts.hour}:${parts.minute}`
  }
  const period = (start: number, end: number) => `${format(start)} – ${format(end)}${bg ? ' ч.' : ''}`
  const intense = warning.duration === 24 ? result.maxima.find(w => w.duration === 6 && w.amount >= 20) : null
  const amount = new Intl.NumberFormat(bg ? 'bg-BG' : 'en-GB', { maximumFractionDigits: 1 }).format(warning.amount)
  return <section className="rain-warning" aria-labelledby="rain-warning-title">
    <h2 id="rain-warning-title">⚠ {bg ? 'Внимание: ' : 'Attention: '}{title}</h2>
    <p><strong>{city} · {amount} {bg ? 'мм за' : 'mm over'} {warning.duration} {bg ? 'часа' : 'hours'}</strong></p>
    <p className="rain-warning-period">{period(warning.start, warning.end)}<small>{bg ? 'Местно време' : 'Local time'}</small></p>
    <p>{bg ? 'Възможно е локално задържане на вода и затруднено придвижване. Следете актуализациите на прогнозата и официалните предупреждения.' : 'Local water accumulation and travel disruption are possible. Follow forecast updates and official warnings.'}</p>
    {intense && <p>{bg ? 'Интензивни натрупани валежи' : 'Intense rainfall accumulation'}: {new Intl.NumberFormat(bg ? 'bg-BG' : 'en-GB', { maximumFractionDigits: 1 }).format(intense.amount)} {bg ? 'мм за 6 часа' : 'mm over 6 hours'} · {period(intense.start, intense.end)}</p>}
    <small>{bg ? 'Ориентировъчно предупреждение по вътрешни продуктови прагове, а не официален код. Източник' : 'Indicative warning using internal product thresholds, not an official warning code. Source'}: Open-Meteo · {bg ? 'Обновено' : 'Updated'}: {format(updated.getTime())}{bg ? ' ч.' : ''}</small>
  </section>
}
