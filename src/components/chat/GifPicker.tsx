import { useEffect, useRef, useState } from 'react'
import { GIPHY_API_KEY } from '../../lib/config'

interface GifResult {
  id: string
  url: string
  previewUrl: string
}

export function GifPicker({ onSelect, onClose }: { onSelect: (gifUrl: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<GifResult[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    fetchGifs('') // "em alta" ao abrir, sem precisar digitar nada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timeout = setTimeout(() => fetchGifs(query), 400)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  async function fetchGifs(q: string) {
    setLoading(true)
    setLoadError(false)
    try {
      // GIPHY (não é mais o Tenor — veja o comentário em lib/config.ts
      // sobre o Google ter desligado o Tenor API de vez em 2026).
      // "trending" quando o campo de busca está vazio (equivalente ao
      // "em alta" que o Tenor tinha), "search" quando a pessoa digitou
      // algo. `rating=pg-13` filtra conteúdo mais pesado, sem ser
      // excessivamente restritivo.
      const endpoint = q.trim()
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13&lang=pt`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=24&rating=pg-13`
      const res = await fetch(endpoint)
      const data = await res.json()
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
    <div className="absolute bottom-full left-0 mb-1 w-80 max-w-[90vw] bg-discord-darker border border-black/40 rounded-lg shadow-xl overflow-hidden z-20">
      <div className="p-2 border-b border-black/20 flex items-center gap-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar GIF..."
          className="flex-1 bg-discord-darker text-sm text-discord-text px-3 py-1.5 rounded outline-none"
        />
        <button onClick={onClose} className="text-discord-text-muted hover:text-white shrink-0">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
          </svg>
        </button>
      </div>
      <div className="p-2 max-h-72 overflow-y-auto grid grid-cols-3 gap-1.5">
        {loading ? (
          <div className="col-span-3 flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
          </div>
        ) : loadError ? (
          <p className="col-span-3 text-center text-xs text-discord-text-muted py-8 px-2">
            Não foi possível carregar GIFs agora. Verifique sua internet ou tente de novo em instantes.
          </p>
        ) : gifs.length === 0 ? (
          <p className="col-span-3 text-center text-xs text-discord-text-muted py-8">Nenhum GIF encontrado.</p>
        ) : (
          gifs.map((gif) => (
            <button
              key={gif.id}
              onClick={() => onSelect(gif.url)}
              className="aspect-video rounded overflow-hidden bg-discord-darker hover:ring-2 hover:ring-discord-blurple transition-shadow"
            >
              <img src={gif.previewUrl} alt="" className="w-full h-full object-cover" />
            </button>
          ))
        )}
      </div>
      <p className="text-[10px] text-discord-text-muted text-center py-1 border-t border-black/20">
        GIFs via GIPHY
      </p>
    </div>
  )
}
