import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

// The parent keys this presentation by forecast and advice; generation stays in App.
export function WeatherAdvice({ advice, lang }: { advice: string, lang: 'bg' | 'en' }) {
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)
  const textRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const text = textRef.current
    if (!text) return
    const mobile = window.matchMedia('(max-width: 640px)')
    let active = true
    let measuredWidth = -1
    let measuredLineHeight = -1
    let frame: number | undefined
    const measure = () => {
      if (!active) return
      measuredWidth = text.getBoundingClientRect().width
      measuredLineHeight = parseFloat(getComputedStyle(text).lineHeight)
      let overflowing = false
      if (mobile.matches && measuredWidth > 0) {
        // Measure an unclamped copy at the exact rendered width, including while
        // expanded. It is invisible, inaccessible and never participates in layout.
        const probe = text.cloneNode(true) as HTMLSpanElement
        probe.removeAttribute('id')
        probe.setAttribute('aria-hidden', 'true')
        Object.assign(probe.style, {
          position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
          display: 'block', width: `${measuredWidth}px`, height: 'auto',
          maxHeight: 'none', margin: '0', webkitLineClamp: 'unset',
        })
        text.parentElement!.appendChild(probe)
        overflowing = probe.getBoundingClientRect().height > measuredLineHeight * 2 + 0.5
        probe.remove()
      }
      setCanExpand(overflowing)
      if (!overflowing) setExpanded(false)
    }
    // Layout measurement prevents a redundant button from appearing on first paint.
    measure()
    // Native callbacks commit before their scheduled paint. Initial measurement
    // stays inside the layout effect.
    const remeasure = () => { if (active) flushSync(measure) }
    const scheduleMeasure = () => {
      if (!active || frame !== undefined) return
      // Coalesce observations before the next paint, outside RO delivery. A
      // synchronous React commit inside RO can resize other observed chart boxes.
      frame = requestAnimationFrame(() => { frame = undefined; remeasure() })
    }
    const observer = new ResizeObserver(() => {
      // Expansion changes height, not wrapping width; ignore those notifications.
      if (text.getBoundingClientRect().width !== measuredWidth || parseFloat(getComputedStyle(text).lineHeight) !== measuredLineHeight) scheduleMeasure()
    })
    observer.observe(text)
    mobile.addEventListener('change', remeasure)
    document.fonts.addEventListener('loadingdone', remeasure)
    void document.fonts.ready.then(remeasure)
    return () => {
      active = false
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
      mobile.removeEventListener('change', remeasure)
      document.fonts.removeEventListener('loadingdone', remeasure)
    }
  }, [advice, lang])

  return (
    <div className={`weather-advice${expanded ? ' is-expanded' : ''}`} style={{ marginTop: '12px', marginBottom: '12px', padding: '12px 16px', background: 'rgba(255,255,255,0.15)', borderRadius: '8px', fontStyle: 'italic', fontSize: '0.95rem', lineHeight: '1.4' }}>
      🤖 <strong>{lang === 'bg' ? 'Метео съвет:' : 'Meteo advice:'}</strong>{' '}<span ref={textRef} id="current-weather-advice" className="weather-advice-text">{advice}</span>
      {canExpand && <button type="button" className="advice-toggle" aria-expanded={expanded} aria-controls="current-weather-advice" onClick={() => setExpanded(value => !value)}>
        {lang === 'bg' ? (expanded ? 'Прибери съвета' : 'Прочети целия съвет') : (expanded ? 'Collapse advice' : 'Read full advice')}
      </button>}
    </div>
  )
}
