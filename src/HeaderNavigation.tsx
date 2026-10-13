import { useEffect, useRef, useState, type ReactNode } from 'react'

// One mounted set of controls serves both layouts, including AuthPanel's dialogs.
export function HeaderNavigation({ lang, notifications, children }: { lang: 'bg' | 'en'; notifications: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const label = lang === 'bg' ? 'Меню' : 'Menu'
  const closeLabel = lang === 'bg' ? 'Затвори менюто' : 'Close menu'

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) toggle.current?.focus()
  }

  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)')
    const resize = () => {
      if (media.matches && root.current?.querySelector('.auth-backdrop')) {
        // Keep the modal's original trigger available when it restores focus.
        setOpen(true)
      }
      if (!media.matches) {
        if (document.activeElement === toggle.current || document.activeElement?.classList.contains('mobile-menu-close')) {
          panel.current?.querySelector<HTMLElement>('.auth-nav > button, a[href], .lang-btn')?.focus()
        }
        setOpen(false)
      }
    }
    media.addEventListener('change', resize)
    return () => media.removeEventListener('change', resize)
  }, [])

  useEffect(() => {
    if (!open) return
    if (!root.current?.querySelector('.auth-backdrop')) panel.current?.querySelector<HTMLElement>('.auth-nav > button:not(:disabled), a[href], .lang-btn')?.focus()
    const escape = (event: KeyboardEvent) => {
      // Authentication owns Escape and focus while its existing modal is open.
      if (event.key !== 'Escape' || event.defaultPrevented || root.current?.querySelector('.auth-backdrop')) return
      event.preventDefault()
      close(true)
    }
    const outside = (event: PointerEvent) => {
      if (root.current?.querySelector('.auth-backdrop')) return
      if (!panel.current?.contains(event.target as Node) && !toggle.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('keydown', escape)
    document.addEventListener('pointerdown', outside)
    return () => {
      document.removeEventListener('keydown', escape)
      document.removeEventListener('pointerdown', outside)
    }
  }, [open])

  return <div className="header-btns" ref={root} onBlurCapture={event => {
    if (open && event.relatedTarget && !panel.current?.contains(event.relatedTarget as Node) && event.relatedTarget !== toggle.current && !root.current?.querySelector('.auth-backdrop')) close()
  }}>
    <div id="header-menu" ref={panel} className={`header-menu${open ? ' is-open' : ''}`}>
      <div className="mobile-menu-heading"><strong>{label}</strong><button type="button" className="mobile-menu-close" aria-label={closeLabel} onClick={() => close(true)}><span aria-hidden="true">×</span></button></div>
      {children}
    </div>
    {notifications}
    <button ref={toggle} type="button" className="mobile-menu-toggle" aria-label={open ? closeLabel : (lang === 'bg' ? 'Отвори менюто' : 'Open menu')} aria-expanded={open} aria-controls="header-menu" onClick={() => open ? close(true) : setOpen(true)}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">{open ? <path d="m6 6 12 12M6 18 18 6" /> : <path d="M4 6h16M4 12h16M4 18h16" />}</svg>
    </button>
  </div>
}
