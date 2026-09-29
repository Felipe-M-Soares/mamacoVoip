import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import type { Server } from '../../types/database'

function seenKey(serverId: string, userId: string) {
  return `mamacos-welcome-seen:${serverId}:${userId}`
}

export function useServerWelcomeScreen(server: Server | null, userId: string | undefined) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!server || !userId || !server.description) {
      setShow(false)
      return
    }
    try {
      const seen = localStorage.getItem(seenKey(server.id, userId))
      setShow(!seen)
    } catch {
      setShow(false)
    }
  }, [server, userId])

  function dismiss() {
    if (server && userId) {
      try {
        localStorage.setItem(seenKey(server.id, userId), '1')
      } catch {
        // best-effort
      }
    }
    setShow(false)
  }

  return { show, dismiss }
}

export function ServerWelcomeModal({ server, onDismiss }: { server: Server; onDismiss: () => void }) {
  const hasBanner = Boolean(server.banner_url)
  // Portal no <body>: se algum ancestral tiver transform/filter, um
  // "fixed" dentro dele passa a ser relativo a esse ancestral (e o
  // overlay aparecia preso dentro da barra lateral).
  return createPortal(
    <div className="fixed inset-0 z-[400] bg-black/70 animate-fade-in flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-welcome-title"
        className="w-full max-w-md surface-elevated rounded-2xl overflow-hidden animate-pop-in"
      >
        {/* Com banner, mostra a capa do servidor; sem banner, uma faixa
            com o gradiente da marca — assim o ícone sempre tem onde
            "sentar" por cima (antes, sem banner, a margem negativa
            empurrava o ícone pra fora do cartão e ele aparecia cortado). */}
        {hasBanner ? (
          <img src={server.banner_url!} alt="" className="w-full h-32 object-cover" />
        ) : (
          <div aria-hidden="true" className="relative h-24 bg-brand-gradient overflow-hidden">
            <div className="absolute inset-0 auth-grid opacity-40" />
          </div>
        )}
        <div className="px-6 pb-6 text-center">
          {server.icon_url ? (
            <img
              src={server.icon_url}
              alt=""
              className="w-20 h-20 rounded-[22px] object-cover mx-auto mb-3 ring-[6px] ring-[var(--color-elevated)] relative z-10 -mt-10"
            />
          ) : (
            <div className="w-20 h-20 rounded-[22px] bg-discord-lighter mx-auto mb-3 ring-[6px] ring-[var(--color-elevated)] relative z-10 -mt-10 flex items-center justify-center font-display text-white font-semibold text-2xl">
              {server.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-discord-text-muted">Boas-vindas</p>
          <h2 id="server-welcome-title" className="font-display text-xl font-semibold text-white mt-1 mb-3">
            Bem-vindo a <span className="text-gradient">{server.name}</span>!
          </h2>
          <p className="text-[14px] text-discord-text-muted whitespace-pre-wrap leading-relaxed text-left rounded-xl bg-white/[0.02] border border-[var(--color-line)] px-4 py-3">
            {server.description}
          </p>
          <button onClick={onDismiss} className="mt-5 w-full h-10 btn-primary text-sm">
            Entendi, vamos lá!
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
