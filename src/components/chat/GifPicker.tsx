import { useEffect, useRef, useState } from 'react'
import { GIPHY_API_KEY } from '../../lib/config'
import { giphyRating } from '../../lib/adultContent'
import { CloseIcon, SearchIcon } from '../ui/icons'

interface GifResult {
  id: string
  url: string
  previewUrl: string
}

export function GifPicker({
  onSelect,
  onClose,
  adult = false,
}: {
  onSelect: (gifUrl: string) => void
  onClose: () => void
  /**
   * Modo adulto: só em canal +18 com o portão de idade já confirmado
   * (quem decide é o ChatArea). Usa `rating=r`, o nível mais permissivo
   * que a API da GIPHY oferece — ela não serve pornografia explícita.
   * Em todo o resto (canais comuns, DMs, grupos) continua `pg-13`.
   */
  adult?: boolean
}) {
  const rating = giphyRating(adult)
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<GifResult[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const firstLoadRef = useRef(true)

  useEffect(() => {
    inputRef.current?.focus()
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      abortRef.current?.abort()
    }
  }, [])

  // Antes havia DOIS efeitos buscando os GIFs "em alta" ao abrir (um no
  // mount e outro pro `query` vazio 400ms depois) — duas requisições
  // iguais. Agora é um só: a primeira busca sai na hora, as seguintes
  // esperam a pessoa parar de digitar.
  useEffect(() => {
    const delay = firstLoadRef.current ? 0 : 400
    firstLoadRef.current = false
    const timeout = setTimeout(() => void fetchGifs(query), delay)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, rating])

  async function fetchGifs(q: string) {
    // Sem chave configurada (VITE_GIPHY_API_KEY) a busca fica desligada
    // — ver lib/config.ts. Nem tenta a requisição.
    if (!GIPHY_API_KEY) {
      setLoading(false)
      setGifs([])
      return
    }
    // Cancela a busca anterior: sem isso, a resposta de "gat" podia chegar
    // DEPOIS da de "gato" e sobrescrever o resultado certo.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setLoadError(false)
    try {
      // GIPHY (não é mais o Tenor — veja o comentário em lib/config.ts
      // sobre o Google ter desligado o Tenor API de vez em 2026).
      // "trending" quando o campo de busca está vazio (equivalente ao
      // "em alta" que o Tenor tinha), "search" quando a pessoa digitou
      // algo. `rating=pg-13` (padrão) filtra conteúdo mais pesado, sem ser
      // excessivamente restritivo; em canal +18 confirmado vira `r`.
      const endpoint = q.trim()
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=24&rating=${rating}&lang=pt`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=24&rating=${rating}`
      const res = await fetch(endpoint, { signal: controller.signal })
      const data = await res.json()
      if (controller.signal.aborted) return
      // A GIPHY devolve um corpo com "meta.status"/"meta.msg" mesmo em
      // erro (chave inválida, cota estourada, etc.) em vez de só um HTTP
      // não-200 — sem checar isso, um erro de API parecia silenciosamente
      // "nenhum GIF encontrado" (igual uma busca sem resultado de
      // verdade), impossível de diferenciar. Agora loga o motivo real no
      // console (F12 no navegador, ou Ctrl+Shift+I no app desktop) e
      // mostra uma mensagem diferente pra quem está usando o app.
      if (!res.ok || data.meta?.status !== 200) {
        console.error('[GifPicker] GIPHY respondeu com erro:', res.status, data.meta ?? data)
        setLoadError(true)
        setGifs([])
        setLoading(false)
        return
      }
      const results: GifResult[] = (data.data ?? []).map((r: any) => ({
        id: r.id,
        url: r.images?.fixed_height?.url ?? r.images?.downsized?.url ?? r.images?.original?.url,
        previewUrl: r.images?.fixed_height_small?.url ?? r.images?.fixed_height?.url ?? r.images?.downsized?.url,
      }))
      setGifs(results.filter((g) => g.url))
    } catch (err) {
      if (controller.signal.aborted) return
      console.error('[GifPicker] Falha ao buscar GIFs (rede/CORS/etc):', err)
      setLoadError(true)
      setGifs([])
    }
    setLoading(false)
  }

  return (
    // Antes usava `left-0 right-0` pra esticar a largura toda — isso
    // funciona quando o elemento posicionado (ancestral mais próximo com
    // position != static) é o composer inteiro, mas quem envolve o
    // GifPicker é só o `<div className="relative shrink-0">` do próprio
    // botão de GIF (~32px), então "esticar de ponta a ponta" desse
    // wrapper deixava o painel inteiro espremido numa fatia minúscula,
    // cortando todo o texto. Com largura fixa (w-80) ancorada em left-0,
    // o painel abre pra direita a partir do botão em vez de tentar
    // preencher a largura do próprio botão.
    <div className="absolute bottom-full left-0 mb-3 w-80 max-w-[90vw] max-sm:fixed max-sm:left-2 max-sm:right-2 max-sm:bottom-[84px] max-sm:mb-0 max-sm:w-auto max-sm:max-w-none surface-elevated rounded-2xl overflow-hidden z-20 animate-pop-in" role="dialog" aria-label="Escolher GIF">
      <div className="p-2.5 border-b border-[var(--color-line)] flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar GIF…"
          aria-label="Buscar GIF"
          className="flex-1 min-w-0 bg-mv-canvas text-sm text-mv-text px-3 py-2 outline-none"
        />
        {adult && (
          <span
            title="Canal +18: resultados com classificação até R (o máximo da GIPHY)"
            className="chip !text-rose-300 !bg-rose-500/10 !border-rose-500/25 shrink-0 font-semibold tabular-nums"
          >
            +18
          </span>
        )}
        <button onClick={onClose} aria-label="Fechar" title="Fechar" className="icon-btn w-8 h-8 shrink-0">
          <CloseIcon className="w-4 h-4" aria-hidden />
        </button>
      </div>
      <div className="p-2 max-h-72 overflow-y-auto grid grid-cols-3 gap-1.5">
        {!GIPHY_API_KEY ? (
          <div className="col-span-3 flex flex-col items-center text-center gap-2 py-8 px-3">
            <p className="text-sm font-medium text-mv-text">Busca de GIFs desativada</p>
            <p className="text-xs text-mv-muted">A chave da GIPHY não foi configurada neste app.</p>
          </div>
        ) : loading ? (
          Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="aspect-video rounded-lg bg-white/[0.05] animate-pulse" style={{ animationDelay: `${i * 40}ms` }} />
          ))
        ) : loadError ? (
          <div className="col-span-3 flex flex-col items-center text-center gap-2 py-8 px-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-7 h-7 text-mv-muted" aria-hidden="true">
              <path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5v.01" />
              <path d="M3 3l18 18" />
            </svg>
            <p className="text-sm font-medium text-mv-text">GIFs indisponíveis</p>
            <p className="text-xs text-mv-muted">Verifique sua internet ou tente de novo em instantes.</p>
          </div>
        ) : gifs.length === 0 ? (
          <div className="col-span-3 flex flex-col items-center text-center gap-2 py-8 px-3">
            <SearchIcon className="w-7 h-7 text-mv-muted" aria-hidden />
            <p className="text-sm font-medium text-mv-text">Nenhum GIF encontrado</p>
            <p className="text-xs text-mv-muted">Tente outra palavra.</p>
          </div>
        ) : (
          gifs.map((gif) => (
            <button
              key={gif.id}
              onClick={() => onSelect(gif.url)}
              className="aspect-video rounded-lg overflow-hidden bg-white/[0.04] hover:ring-2 hover:ring-mv-accent hover:scale-[1.03] transition-all"
            >
              <img src={gif.previewUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
            </button>
          ))
        )}
      </div>
      {/* Atribuição exigida pelos termos da API da GIPHY ("Powered by
          GIPHY") — selo em texto, sem baixar logo de fora. */}
      <div className="flex items-center justify-center gap-2 py-1.5 border-t border-[var(--color-line)]">
        <span
          aria-label="Powered by GIPHY"
          className="inline-flex items-center gap-1 rounded-md bg-black px-2 py-0.5 text-[10px] font-semibold tracking-[0.04em] text-white ring-1 ring-white/10"
        >
          <span className="opacity-80">Powered by</span>
          <span className="font-black tracking-[0.06em]">GIPHY</span>
        </span>
        {adult && <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-mv-muted">classificação R</span>}
      </div>
    </div>
  )
}
