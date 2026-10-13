import { Children, useCallback, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react'

const query = '(max-width: 640px)'
const snapshot = () => window.matchMedia(query).matches
const serverSnapshot = () => false

// Stable keys and one parent let React move existing DOM nodes, preserving state,
// and drafts. No wrapper or CSS order separates reading order
// from the visual order, and the desktop grid keeps its original direct children.
export function ForecastSectionOrder({ children, dashboardRef }: { children: ReactNode; dashboardRef: RefObject<HTMLElement | null> }) {
  const scrollPositions = useRef<Array<[Element, number]>>([])
  const subscribe = useCallback((notify: () => void) => {
    const media = window.matchMedia(query)
    const update = () => {
      // Moving a scroll-snap container can reset its offset even when its DOM
      // identity survives. Capture before React moves it, restore before paint.
      scrollPositions.current = Array.from(dashboardRef.current?.querySelectorAll('.hourly-row, .daily-grid') ?? [], row => [row, row.scrollLeft])
      notify()
    }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [dashboardRef])
  const mobile = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  useLayoutEffect(() => {
    for (const [row, left] of scrollPositions.current) row.scrollLeft = left
    scrollPositions.current = []
  }, [mobile])
  const [chat, hourly, daily] = Children.toArray(children)
  return mobile ? [hourly, daily, chat] : [chat, hourly, daily]
}
