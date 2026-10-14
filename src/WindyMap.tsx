import { useEffect, useId, useRef, useState } from 'react'
import './WindyMap.css'

const copy = {
  bg: { fullscreen: 'На цял екран', close: 'Затвори', interact: 'Управлявай картата', scroll: 'Върни превъртането', hint: 'Превъртай страницата. За движение по картата избери „Управлявай картата“.', active: 'Картата е активна. За превъртане на страницата избери „Върни превъртането“.' },
  en: { fullscreen: 'Fullscreen', close: 'Close', interact: 'Interact with map', scroll: 'Return to scrolling', hint: 'Scroll the page. To move around the map, choose “Interact with map”.', active: 'Map interaction is active. To scroll the page, choose “Return to scrolling”.' },
}

export function WindyMap({ coords, lang, darkMode, title }: { coords: { lat: number; lon: number }; lang: 'bg' | 'en'; darkMode: boolean; title: string }) {
  const t = copy[lang], id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [interacting, setInteracting] = useState(false)
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 640px)').matches)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px)')
    const update = () => { setMobile(query.matches); setInteracting(false) }
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!expanded) return
    const body = document.body, position = window.scrollY
    const previous = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow }
    Object.assign(body.style, { position: 'fixed', top: `-${position}px`, width: '100%', overflow: 'hidden' })
    closeButton.current?.focus()
    return () => {
      Object.assign(body.style, previous)
      window.scrollTo({ top: position, behavior: 'instant' })
      if (window.matchMedia('(max-width: 640px)').matches) opener.current?.focus({ preventScroll: true })
      else frame.current?.focus({ preventScroll: true })
    }
  }, [expanded])

  const open = () => {
    const element = dialog.current!
    // The same iframe stays mounted in the same parent, including in the top layer.
    element.removeAttribute('open')
    element.showModal()
    setExpanded(true)
  }
  const close = () => {
    dialog.current!.close()
    dialog.current!.setAttribute('open', '')
    setExpanded(false)
    setInteracting(false)
  }
  return <div className="windy-wrapper" style={{ borderRadius: '12px', overflow: 'hidden', marginTop: '16px', background: darkMode ? '#1e293b' : '#f1f5f9' }}>
    <dialog ref={dialog} open className={`windy-view${expanded ? ' is-expanded' : ''}${interacting ? ' is-interacting' : ''}`} role={expanded ? 'dialog' : 'region'} aria-modal={expanded ? true : undefined} aria-label={title} onCancel={event => { event.preventDefault(); close() }} onKeyDown={event => {
      if (expanded && event.key === 'Tab' && event.shiftKey && document.activeElement === closeButton.current) {
        event.preventDefault()
        frame.current?.focus()
      }
    }}>
      <div className="windy-controls">
        {expanded ? <><span>{title}</span><button ref={closeButton} type="button" onClick={close}>{t.close}</button></> : <>
          <button ref={opener} type="button" onClick={open} aria-haspopup="dialog">{t.fullscreen}</button>
          <button type="button" aria-pressed={interacting} aria-controls={`${id}-frame`} onClick={() => setInteracting(value => !value)}>{interacting ? t.scroll : t.interact}</button>
        </>}
      </div>
      <p className="windy-hint" id={`${id}-hint`} aria-live="polite">{interacting ? t.active : t.hint}</p>
      <div className="windy-canvas">
        <iframe ref={frame} id={`${id}-frame`} width="100%" height="450"
          src={`https://embed.windy.com/embed2.html?lat=${coords.lat}&lon=${coords.lon}&detailLat=${coords.lat}&detailLon=${coords.lon}&width=650&height=450&zoom=6&level=surface&overlay=rain&product=ecmwf&menu=&message=&marker=true&calendar=now&city=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C&metricRain=mm&radarRange=-1`}
          frameBorder="0" title="Windy Map" style={{ display: 'block' }} tabIndex={mobile && !expanded && !interacting ? -1 : 0} aria-describedby={mobile && !expanded ? `${id}-hint` : undefined} />
        <div className="windy-scroll-shield" aria-hidden="true" />
      </div>
    </dialog>
  </div>
}
