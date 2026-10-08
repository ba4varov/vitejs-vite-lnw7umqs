import { useEffect, useState } from 'react'
import { subscribeSession } from './auth-client'
import { adminRequest } from './admin-client'
export function AdminLink({ lang }: { lang: 'bg' | 'en' }) {
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    let controller: AbortController | undefined
    const unsubscribe = subscribeSession(session => {
      controller?.abort(); controller = new AbortController(); setAllowed(false)
      const signal = controller.signal
      if (session) void adminRequest(session, 'access', {}, signal).then(() => { if (!signal.aborted) setAllowed(true) }).catch(() => {})
    })
    return () => { controller?.abort(); unsubscribe() }
  }, [])
  return allowed ? <a className="lang-btn" href="/admin">{lang === 'bg' ? 'Администрация' : 'Administration'}</a> : null
}
