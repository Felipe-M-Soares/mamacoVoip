import { useEffect, useRef } from 'react'
import { useWindowPlace } from '../../lib/windowTitle'
function toHex(css: string): string | null {
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 1, 1)
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

export function TitleBar() {
  const place = useWindowPlace()
  const barRef = useRef<HTMLDivElement>(null)
  const isElectron = Boolean(window.electronAPI?.isElectron)

  useEffect(() => {
    if (!isElectron) return
    let last = ''
    const apply = () => {
      const el = barRef.current
      if (!el) return
      const cs = getComputedStyle(el)
      const color = toHex(cs.backgroundColor)
      const symbolColor = toHex(getComputedStyle(document.body).color) ?? '#f3efee'
      if (!color) return
      const key = color + symbolColor
      if (key === last) return
      last = key
      void window.electronAPI?.setTitleBarColors?.({ color, symbolColor }).catch(() => {})
    }
    apply()
    const obs = new MutationObserver(() => requestAnimationFrame(apply))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    obs.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] })
    return () => obs.disconnect()
  }, [isElectron])

  if (!isElectron) return null

  return (
    <div
      ref={barRef}
      className="h-10 shrink-0 flex items-center gap-2.5 px-3.5 bg-mv-side border-b border-[var(--color-line)] relative z-10 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <img src="/logo-192.png" alt="" className="w-5 h-5 rounded-md shrink-0 ring-1 ring-[var(--color-line-strong)]" />
      <span className="font-display font-semibold text-[13px] text-mv-muted">Mamacos <span className="text-mv-text">Voip</span></span>
      {place && (
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 max-w-[40%] pointer-events-none">
          {place.iconUrl ? (
            <img src={place.iconUrl} alt="" className="w-4 h-4 rounded-[5px] object-cover shrink-0" />
          ) : null}
          <span className="font-display font-semibold text-[13px] text-mv-text truncate">{place.label}</span>
        </div>
      )}
    </div>
  )
}
