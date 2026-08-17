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
  return (
    <div className="fixed inset-0 z-[400] bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-discord-dark rounded-2xl shadow-2xl border border-discord-blurple/20 overflow-hidden">
        {server.banner_url && (
          <img src={server.banner_url} alt="" className="w-full h-32 object-cover" />
        )}
        <div className="p-6 text-center">
          {server.icon_url ? (
            <img
              src={server.icon_url}
              alt=""
              className="w-16 h-16 rounded-full object-cover mx-auto -mt-14 mb-3 border-4 border-discord-dark relative z-10"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-discord-blurple mx-auto -mt-14 mb-3 border-4 border-discord-dark relative z-10 flex items-center justify-center text-white font-bold text-xl">
              {server.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <h2 className="font-display text-xl font-bold text-white tracking-wide mb-2">
            Bem-vindo a {server.name}!
          </h2>
          <p className="text-sm text-discord-text-muted whitespace-pre-wrap leading-relaxed">
            {server.description}
          </p>
          <button onClick={onDismiss} className="mt-5 w-full py-2.5 rounded btn-primary text-sm">
            Entendi, vamos lá!
          </button>
        </div>
      </div>
    </div>
  )
}
