import { useEffect, useRef, useState } from 'react'
import { loadTurnstile } from './turnstile-loader.js'

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
  reset: (widgetId: string) => void
}

declare global { interface Window { turnstile?: TurnstileApi } }

type Labels = { loading: string, ready: string, expired: string, error: string, retry: string }

export function Turnstile({ siteKey, lang, resetKey, onTokenChange, labels }: { siteKey: string, lang: 'bg' | 'en', resetKey: number, onTokenChange: (token: string | null) => void, labels: Labels }) {
  const host = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'expired' | 'error'>('loading')

  useEffect(() => {
    let active = true
    setStatus('loading')
    onTokenChange(null)
    loadTurnstile().then(api => {
      if (!active || !host.current) return
      widget.current = api.render(host.current, {
        sitekey: siteKey,
        language: lang,
        size: 'flexible',
        callback: (token: string) => { if (active) { setStatus('ready'); onTokenChange(token) } },
        'expired-callback': () => { if (active) { setStatus('expired'); onTokenChange(null) } },
        'error-callback': () => { if (active) { setStatus('error'); onTokenChange(null) } },
      })
    }).catch(() => { if (active) { setStatus('error'); onTokenChange(null) } })
    return () => {
      active = false
      onTokenChange(null)
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current)
      widget.current = null
    }
  }, [siteKey, lang, loadAttempt, onTokenChange])

  useEffect(() => {
    onTokenChange(null)
    if (widget.current && window.turnstile) {
      window.turnstile.reset(widget.current)
      setStatus('loading')
    }
  }, [resetKey, onTokenChange])

  return <div className="turnstile-field">
    <div ref={host} className="turnstile-widget" />
    <p className={`turnstile-status ${status === 'error' || status === 'expired' ? 'auth-error' : ''}`} role={status === 'error' || status === 'expired' ? 'alert' : 'status'}>
      {labels[status]}
    </p>
    {status === 'error' && <button type="button" className="auth-link turnstile-retry" onClick={() => setLoadAttempt(value => value + 1)}>{labels.retry}</button>}
  </div>
}
