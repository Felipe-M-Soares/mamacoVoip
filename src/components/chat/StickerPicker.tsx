import { useEffect, useMemo, useRef, useState } from 'react'
import { getRecentStickers, searchStickers, type Sticker } from '../../lib/stickers'
import { CloseIcon, SearchIcon, StickerIcon } from '../ui/icons'

// Seletor de figurinhas do pacote original do app (lib/stickers.ts).
// Mesmo formato de popover do GifPicker, ancorado acima do botão.
export function StickerPicker({ onSelect, onClose }: { onSelect: (sticker: Sticker) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [recent] = useState(getRecentStickers)

  useEffect(() => {
    inputRef.current?.focus()
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const results = useMemo(() => searchStickers(query), [query])
  const searching = query.trim().length > 0

  function renderGrid(list: Sticker[], label: string) {
    return (
      <div role="group" aria-label={label} className="grid grid-cols-4 gap-1.5">
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s)}
            title={s.label}
            aria-label={`Enviar figurinha ${s.label}`}
            className="aspect-square rounded-xl p-1 bg-white/[0.03] hover:bg-white/[0.08] hover:scale-[1.06] focus-visible:bg-white/[0.08] transition-all"
          >
            <img src={s.url} alt="" draggable={false} loading="lazy" className="w-full h-full object-contain select-none" />
          </button>
        ))}
      </div>
    )
  }

  const sectionLabel = 'px-0.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted'

  return (
    <div
      className="absolute bottom-full left-0 mb-3 w-80 max-w-[90vw] surface-elevated rounded-2xl overflow-hidden z-20 animate-pop-in"
      role="dialog"
      aria-label="Escolher figurinha"
    >
      <div className="p-2.5 border-b border-[var(--color-line)] flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0">
          <SearchIcon className="w-4 h-4 text-mv-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar figurinha…"
            aria-label="Buscar figurinha"
            className="w-full bg-mv-canvas text-sm text-mv-text pl-8 pr-3 py-2 outline-none"
          />
        </div>
        <button onClick={onClose} aria-label="Fechar" title="Fechar" className="icon-btn w-8 h-8 shrink-0">
          <CloseIcon className="w-4 h-4" aria-hidden />
        </button>
      </div>
      <div className="p-2.5 max-h-80 overflow-y-auto space-y-3">
        {searching ? (
          results.length > 0 ? (
            renderGrid(results, 'Resultados')
          ) : (
            <div className="flex flex-col items-center text-center gap-2 py-8 px-3">
              <StickerIcon className="w-7 h-7 text-mv-muted" aria-hidden />
              <p className="text-sm font-medium text-mv-text">Nenhuma figurinha encontrada</p>
              <p className="text-xs text-mv-muted">Tente “gg”, “rindo” ou “macaco”.</p>
            </div>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <section>
                <p className={sectionLabel}>Recentes</p>
                {renderGrid(recent, 'Figurinhas recentes')}
              </section>
            )}
            <section>
              <p className={sectionLabel}>Pacote Mamacos</p>
              {renderGrid(results, 'Todas as figurinhas')}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
