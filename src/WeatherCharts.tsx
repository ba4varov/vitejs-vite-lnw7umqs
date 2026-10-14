import { useState, useEffect, useRef } from 'react'
import { CHART_METRICS, chartSummary, chartTheme, chartValues, valueRange, visibleTimeIndexes } from './chart-utils.js'
import { chartCopy } from './chart-copy.js'

type ChartType = 'temp' | 'rain' | 'wind' | 'pressure' | 'aqi'

const formatChartValue = (value: number, type: ChartType) =>
  type === 'rain' ? value.toLocaleString('bg-BG', { maximumFractionDigits: 2 }) : Math.round(value).toString()

export const SingleChart = ({ hourly, darkMode, type, label, unit, color, height, loading = false, lang = 'bg' }: any) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const metric = CHART_METRICS[type as ChartType] || { icon: '◌', color, kind: 'line' }
  const chartColor = color || metric.color
  const values = chartValues(hourly, type) as Array<number | null>
  const summary = chartSummary(values) as { current: number, min: number, max: number } | null
  const allZeroRain = type === 'rain' && values.some(Number.isFinite) && values.every(value => value === null || value === 0)
  const [smallViewport, setSmallViewport] = useState(() => window.matchMedia('(max-width: 640px)').matches)
  const compact = smallViewport && type !== 'aqi'
  const copy = chartCopy[lang === 'en' ? 'en' : 'bg']
  const mobile = compact || (width > 0 && width < 520)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px)')
    const update = () => setSmallViewport(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const theme = chartTheme(darkMode, mobile, reducedMotion)
  const chartHeight = height || (compact ? 264 : mobile ? 232 : 264)
  const labels = hourly.slice(0, 24).map((item: any) => item?.hour || '--:--')

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const observer = new ResizeObserver(entries => setWidth(Math.round(entries[0].contentRect.width)))
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width || allZeroRain) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(chartHeight * dpr)
    canvas.style.width = `${width}px`; canvas.style.height = `${chartHeight}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, chartHeight)

    const pad = { left: compact ? 48 : mobile ? 42 : 48, right: compact ? 28 : 22, top: compact ? 64 : 16, bottom: 36 }
    const plotW = width - pad.left - pad.right, plotH = chartHeight - pad.top - pad.bottom
    const range = valueRange(values, type)
    const x = (index: number) => pad.left + (values.length <= 1 ? plotW / 2 : index * plotW / (values.length - 1))
    const y = (value: number) => pad.top + plotH - ((value - range.min) / (range.max - range.min)) * plotH

    ctx.font = `${compact ? 14 : 13}px ${getComputedStyle(document.body).fontFamily}`
    ctx.fillStyle = theme.text; ctx.strokeStyle = theme.grid; ctx.lineWidth = 1
    const tickValues: number[] = []
    if (type === 'pressure') {
      const bottom = Math.floor(range.min), top = Math.ceil(range.max)
      for (let value = bottom; value <= top; value += range.step) tickValues.push(value)
      if (tickValues.length < 2) tickValues.push(bottom + range.step)
    } else {
      for (let i = 0; i <= 4; i++) tickValues.push(range.min + (range.max - range.min) * i / 4)
    }
    ;[...new Set(tickValues.map(value => type === 'rain' ? Number(value.toFixed(1)) : Math.round(value)))].forEach(value => {
      const yy = y(value)
      if (yy < pad.top - 1 || yy > pad.top + plotH + 1) return
      ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(width - pad.right, yy); ctx.stroke()
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(String(value), pad.left - 7, yy)
    })

    ctx.textBaseline = 'bottom'; ctx.textAlign = 'center'
    let lastLabelRight = -Infinity
    visibleTimeIndexes(values.length, mobile).forEach(index => {
      const text = index === 0 ? copy.now : labels[index]
      const half = ctx.measureText(text).width / 2
      const xx = compact ? Math.max(half + 2, Math.min(width - half - 2, x(index))) : x(index)
      // Reserve the last hour before drawing intermediate mobile labels.
      const lastHalf = ctx.measureText(labels[values.length - 1] || '').width / 2
      const lastLeft = Math.min(width - lastHalf - 2, x(values.length - 1)) - lastHalf
      if (compact && (xx - half < lastLabelRight + 10 || (index !== values.length - 1 && index !== 0 && xx + half + 10 > lastLeft))) return
      ctx.fillText(text, xx, chartHeight - 5)
      lastLabelRight = xx + half
    })

    const drawSegment = (fill: boolean) => {
      let drawing = false
      values.forEach((value, index) => {
        if (value === null) { drawing = false; return }
        if (!drawing) { ctx.moveTo(x(index), y(value)); drawing = true } else ctx.lineTo(x(index), y(value))
      })
      if (fill) {
        const last = values.findLastIndex(Number.isFinite), first = values.findIndex(Number.isFinite)
        if (first >= 0) { ctx.lineTo(x(last), pad.top + plotH); ctx.lineTo(x(first), pad.top + plotH); ctx.closePath() }
      }
    }

    if (metric.kind === 'bar') {
      const slot = plotW / Math.max(values.length, 1), barWidth = Math.min(18, Math.max(4, slot * .58))
      values.forEach((value, index) => {
        if (value === null) return
        const top = y(value), bottom = y(0), h = Math.max(value > 0 ? 2 : 0, bottom - top)
        ctx.fillStyle = chartColor; ctx.beginPath(); ctx.roundRect(x(index) - barWidth / 2, bottom - h, barWidth, h, [4, 4, 0, 0]); ctx.fill()
      })
    } else {
      if (type !== 'pressure') {
        const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH)
        gradient.addColorStop(0, `${chartColor}24`); gradient.addColorStop(1, `${chartColor}00`)
        ctx.beginPath(); drawSegment(true); ctx.fillStyle = gradient; ctx.fill()
      }
      ctx.beginPath(); drawSegment(false); ctx.strokeStyle = chartColor; ctx.lineWidth = 2.25; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke()
    }
    if (activeIndex !== null && Number.isFinite(values[activeIndex])) {
      ctx.beginPath(); ctx.arc(x(activeIndex), y(values[activeIndex]!), 4, 0, Math.PI * 2)
      ctx.fillStyle = chartColor; ctx.fill(); ctx.strokeStyle = darkMode ? '#0f172a' : '#fff'; ctx.lineWidth = 2; ctx.stroke()
    }
  }, [activeIndex, allZeroRain, chartColor, chartHeight, darkMode, hourly, metric.kind, mobile, theme.grid, theme.text, type, values, width, compact, copy.now])

  const choosePoint = (clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !values.length) return
    const left = compact ? 48 : mobile ? 42 : 48
    setActiveIndex(Math.max(0, Math.min(values.length - 1, Math.round((clientX - rect.left - left) / Math.max(1, rect.width - left - (compact ? 28 : 22)) * (values.length - 1)))))
  }
  const currentValue = activeIndex === null ? null : values[activeIndex]
  const summaryText = !summary ? (loading ? (lang === 'bg' ? 'Зареждане…' : 'Loading…') : copy.noData) : type === 'wind'
    ? `${copy.now} ${formatChartValue(summary.current, type)} ${unit} · ${copy.max} ${formatChartValue(summary.max, type)} ${unit}`
    : type === 'rain' ? `${copy.total} ${formatChartValue(values.reduce((sum: number, value) => sum + (value || 0), 0), type)} ${unit} · ${copy.max} ${formatChartValue(summary.max, type)} ${unit}`
    : `${copy.now} ${formatChartValue(summary.current, type)}${type === 'temp' ? '°' : ` ${unit}`} · ${copy.min} ${formatChartValue(summary.min, type)}${type === 'temp' ? '°' : ` ${unit}`} · ${copy.max} ${formatChartValue(summary.max, type)}${type === 'temp' ? '°' : ` ${unit}`}`
  const accessible = `${label}. ${summaryText}. ${copy.period}`

  return <article className="mini-chart" aria-label={accessible}>
    <header className="chart-header"><span className="chart-icon" style={{ color: chartColor }} aria-hidden="true">{metric.icon}</span><div><h4>{label}</h4><p>{summaryText}</p></div></header>
    <p className="sr-only">{accessible} {copy.keyboard}</p>
    <div className="chart-frame" ref={frameRef} style={{ height: chartHeight }}>
      {allZeroRain ? <div className="no-rain" role="status"><span aria-hidden="true">🌧️</span><p>{copy.noRain}</p></div> : <>
        <canvas ref={canvasRef} tabIndex={0} role="img" aria-label={accessible}
          onMouseMove={event => choosePoint(event.clientX)} onMouseLeave={() => setActiveIndex(null)}
          onTouchStart={event => choosePoint(event.touches[0].clientX)}
          onTouchMove={event => choosePoint(event.touches[0].clientX)}
          onFocus={() => setActiveIndex(index => index ?? 0)} onBlur={() => setActiveIndex(null)}
          onKeyDown={event => { if (['ArrowRight', 'ArrowLeft'].includes(event.key)) event.preventDefault(); if (event.key === 'ArrowRight') setActiveIndex(i => Math.min(values.length - 1, (i ?? -1) + 1)); if (event.key === 'ArrowLeft') setActiveIndex(i => Math.max(0, (i ?? 1) - 1)) }} />
        {activeIndex !== null && <div className="chart-tooltip" role="status" style={{ left: `${Math.min(Math.max(78, width - 78), Math.max(78, 48 + activeIndex / Math.max(1, values.length - 1) * (width - 62)))}px`, background: theme.tooltipBackground, color: theme.tooltipText }}>{labels[activeIndex] || '--:--'} — {currentValue == null ? copy.noValue : `${formatChartValue(currentValue, type)}${type === 'temp' ? '°C' : ` ${unit}`}`}</div>}
      </>}
    </div>
  </article>
}

export const Chart = ({ hourly, darkMode, t, lang = 'bg' }: any) => {
  const chartsData = [
    { key: 'temp', label: t.temp, unit: '°C' }, { key: 'rain', label: t.rain, unit: t.mm },
    { key: 'wind', label: t.windChart, unit: t.windUnit }, { key: 'pressure', label: t.pressureChart, unit: t.hpa }
  ]
  const [selectedChart, setSelectedChart] = useState<ChartType>('temp')
  const [mobileCharts, setMobileCharts] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const updateLayout = () => setMobileCharts(query.matches)
    query.addEventListener('change', updateLayout)
    return () => query.removeEventListener('change', updateLayout)
  }, [])

  const visibleCharts = mobileCharts ? chartsData.filter(chart => chart.key === selectedChart) : chartsData

  return <section className="card charts-section" aria-labelledby="charts-title">
    <h3 id="charts-title">{t.chart}</h3>
    {mobileCharts && <div className="chart-selector" role="tablist" aria-label={t.chart}>
      {chartsData.map(chart => <button key={chart.key} type="button" role="tab" aria-selected={selectedChart === chart.key} className={selectedChart === chart.key ? 'active' : ''} onClick={() => setSelectedChart(chart.key as ChartType)}>{chart.label}</button>)}
    </div>}
    <div className="charts-grid">{visibleCharts.map(chart => <SingleChart key={chart.key} hourly={hourly} darkMode={darkMode} type={chart.key} label={chart.label} unit={chart.unit} lang={lang} />)}</div>
  </section>
}
