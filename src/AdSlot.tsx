type AdSlotProps = {
  label?: string
  size?: 'banner' | 'rectangle'
}

export function AdSlot({ label = 'Рекламно пространство', size = 'banner' }: AdSlotProps) {
  return (
    <aside className={`ad-slot ad-slot-${size}`} aria-label={label} data-ad-slot={size}>
      {!import.meta.env.PROD && (
        <span className="ad-slot-placeholder" aria-hidden="true">
          <span>AD</span> {label} · само в режим за разработка
        </span>
      )}
    </aside>
  )
}
