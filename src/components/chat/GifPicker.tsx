import { useEffect, useRef, useState } from 'react'
import { TENOR_API_KEY } from '../../lib/config'

interface TenorGif {
  id: string
  url: string
  previewUrl: string
}

export function GifPicker({ onSelect, onClose }: { onSelect: (gifUrl: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<TenorGif[]>([])
  const [loading, setLoading] = useState(false)
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
    try {
      const endpoint = q.trim()
        ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${TENOR_API_KEY}&client_key=mamacos_voip&limit=24&contentfilter=medium&media_filter=tinygif,gif`
        : `https://tenor.googleapis.com/v2/featured?key=${TENOR_API_KEY}&client_key=mamacos_voip&limit=24&contentfilter=medium&media_filter=tinygif,gif`
      const res = await fetch(endpoint)
      const data = await res.json()
      const results: TenorGif[] = (data.results ?? []).map((r: any) => ({
        id: r.id,
        url: r.media_formats?.gif?.url ?? r.media_formats?.tinygif?.url,
        previewUrl: r.media_formats?.tinygif?.url ?? r.media_formats?.gif?.url,
      }))
      setGifs(results.filter((g) => g.url))
    } catch {
      setGifs([])
    }
    setLoading(false)
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-discord-darker border border-black/40 rounded-lg shadow-xl overflow-hidden z-20">
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
        GIFs via Tenor
      </p>
    </div>
  )
}
