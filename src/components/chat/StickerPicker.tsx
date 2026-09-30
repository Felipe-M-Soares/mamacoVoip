import { useEffect, useMemo, useRef, useState } from 'react'
import {
  STICKER_PACKS,
  getRecentStickers,
  getSticker,
  searchStickers,
  stickersInPack,
  type Sticker,
  type StickerPackId,
} from '../../lib/stickers'
import { CloseIcon, SearchIcon, StickerIcon } from '../ui/icons'

// Seletor de figurinhas dos pacotes originais do app (lib/stickers.ts),
// com uma aba por pacote (e "Recentes").
// Mesmo formato de popover do GifPicker, ancorado acima do botão.
export function StickerPicker({ onSelect, onClose }: { onSelect: (sticker: Sticker) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [recent] = useState(getRecentStickers)
  const [tab, setTab] = useState<StickerPackId | 'recentes'>(() => (getRecentStickers().length > 0 ? 'recentes' : 'mamacos'))

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
      {!searching && (
        <div role="tablist" aria-label="Pacotes de figurinhas" className="flex gap-1 px-2.5 pt-2 overflow-x-auto">
          {recent.length > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'recentes'}
              onClick={() => setTab('recentes')}
              title="Recentes"
              className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                tab === 'recentes' ? 'bg-mv-accent/20 ring-1 ring-inset ring-mv-accent/50' : 'hover:bg-white/[0.06]'
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5 text-mv-muted" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              <span className="sr-only">Recentes</span>
            </button>
          )}
          {STICKER_PACKS.map((p) => {
            const cover = getSticker(p.coverId)
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={tab === p.id}
                onClick={() => setTab(p.id)}
                title={p.label}
                className={`shrink-0 w-10 h-10 p-1 rounded-xl transition-colors ${
                  tab === p.id ? 'bg-mv-accent/20 ring-1 ring-inset ring-mv-accent/50' : 'hover:bg-white/[0.06]'
                }`}
              >
                {cover && <img src={cover.url} alt="" draggable={false} className="w-full h-full object-contain" />}
                <span className="sr-only">{p.label}</span>
              </button>
            )
          })}
        </div>
      )}
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
        ) : tab === 'recentes' ? (
          renderGrid(recent, 'Figurinhas recentes')
        ) : (
          <section>
            <p className={sectionLabel}>{STICKER_PACKS.find((p) => p.id === tab)?.label}</p>
            {renderGrid(stickersInPack(tab), `Pacote ${STICKER_PACKS.find((p) => p.id === tab)?.label ?? ''}`)}
          </section>
        )}
      </div>
    </div>
  )
}
