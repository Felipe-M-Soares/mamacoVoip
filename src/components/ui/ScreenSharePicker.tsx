import { useEffect, useState } from 'react'
import type { ScreenShareSource } from '../../hooks/useGamePresence'

export function ScreenSharePicker() {
  const [sources, setSources] = useState<ScreenShareSource[] | null>(null)

  useEffect(() => {
    if (!window.electronAPI) return
    return window.electronAPI.onScreenShareSources(setSources)
  }, [])

  if (!sources) return null

  function choose(id: string | null) {
    window.electronAPI?.selectScreenShareSource(id).catch(() => {
      // best-effort — cancelar o compartilhamento não deve nunca quebrar a tela
    })
    setSources(null)
  }

  return (
    <div
      className="fixed inset-0 z-[400] bg-black/70 flex items-center justify-center p-4"
      onClick={() => choose(null)}
    >
      <div
        className="bg-discord-dark rounded-lg shadow-2xl max-w-2xl w-full p-5 border border-white/5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold text-white tracking-wide mb-1">
          Escolha o que compartilhar
        </h2>
        <p className="text-xs text-discord-text-muted mb-4">Uma tela inteira ou só uma janela específica</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[55vh] overflow-y-auto pr-1">
          {sources.map((s) => (
            <button
              key={s.id}
              onClick={() => choose(s.id)}
              className="text-left rounded-lg overflow-hidden border-2 border-transparent hover:border-discord-blurple transition-colors bg-discord-darker"
            >
              <img src={s.thumbnail} alt={s.name} className="w-full aspect-video object-cover bg-black" />
              <p className="text-xs text-discord-text px-2 py-1.5 truncate">{s.name}</p>
            </button>
          ))}
        </div>

        <button onClick={() => choose(null)} className="mt-4 w-full py-2.5 rounded btn-secondary">
          Cancelar
        </button>
      </div>
    </div>
  )
}
