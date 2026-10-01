import { useEffect, useState } from 'react'
import { closeMedia, useOpenMedia } from '../../lib/mediaViewer'

// Tela cheia escura com a imagem/vídeo grande. Fecha com Esc, clique fora
// ou no X. Imagem: clique alterna entre "caber na tela" e tamanho real
// (com rolagem). Baixar salva o arquivo; "Abrir original" fica como opção.
export function MediaViewer() {
  const item = useOpenMedia()
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    setZoom(false)
    if (!item) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeMedia()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [item])

  if (!item) return null

  async function download() {
    if (!item) return
    try {
      const res = await fetch(item.src)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = item.name || (item.kind === 'video' ? 'video.mp4' : 'imagem.png')
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch {
      window.open(item.src, '_blank', 'noopener,noreferrer')
    }
  }

  const btn =
    'h-9 px-3 rounded-full bg-white/10 hover:bg-white/20 text-white text-[13px] font-medium flex items-center gap-1.5 transition-colors'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.name || 'Visualizar mídia'}
      className="fixed inset-0 z-[500] bg-black/90 flex flex-col animate-fade-in"
      onClick={closeMedia}
    >
      <div className="flex items-center gap-2 px-4 h-14 shrink-0" onClick={(e) => e.stopPropagation()}>
        <p className="flex-1 min-w-0 truncate text-sm text-white/80">{item.name}</p>
        <button type="button" onClick={() => void download()} className={btn}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4" aria-hidden>
            <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />
          </svg>
          Baixar
        </button>
        <a href={item.src} target="_blank" rel="noreferrer" className={btn} title="Abrir original no navegador">
          Abrir original
        </a>
        <button type="button" onClick={closeMedia} aria-label="Fechar" title="Fechar (Esc)" className={`${btn} !px-0 w-9 justify-center`}>
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden>
            <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
          </svg>
        </button>
      </div>
      <div className={`flex-1 min-h-0 flex p-4 pt-0 ${zoom ? 'overflow-auto' : 'items-center justify-center'}`}>
        {item.kind === 'video' ? (
          <video
            src={item.src}
            controls
            autoPlay
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full m-auto rounded-lg bg-black"
          />
        ) : (
          <img
            src={item.src}
            alt={item.name || ''}
            onClick={(e) => {
              e.stopPropagation()
              setZoom((z) => !z)
            }}
            className={
              zoom
                ? 'max-w-none m-auto cursor-zoom-out'
                : 'max-w-full max-h-full object-contain rounded-lg cursor-zoom-in select-none'
            }
          />
        )}
      </div>
    </div>
  )
}
