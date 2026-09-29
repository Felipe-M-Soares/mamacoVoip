import { useEffect, useState } from 'react'
import { useConnectionStatus } from '../../hooks/useConnectionStatus'

export function ConnectionBanner() {
  const isOnline = useConnectionStatus()
  const [showReconnected, setShowReconnected] = useState(false)
  const [wasOffline, setWasOffline] = useState(false)

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true)
      return
    }
    if (wasOffline) {
      setShowReconnected(true)
      setWasOffline(false)
      const timer = setTimeout(() => setShowReconnected(false), 2500)
      return () => clearTimeout(timer)
    }
  }, [isOnline, wasOffline])

  if (!isOnline) {
    return (
      <div role="alert" className="fixed top-3 inset-x-0 z-[300] flex justify-center px-4 pointer-events-none">
        <div className="surface-elevated !border-rose-500/30 rounded-full pl-3 pr-4 py-2 flex items-center gap-2.5 animate-pop-in pointer-events-auto">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
          </span>
          <span className="text-sm text-discord-text font-medium">
            Sem conexão <span className="text-discord-text-muted font-normal">— tentando reconectar…</span>
          </span>
        </div>
      </div>
    )
  }

  if (showReconnected) {
    return (
      <div role="status" className="fixed top-3 inset-x-0 z-[300] flex justify-center px-4 pointer-events-none">
        <div className="surface-elevated !border-discord-green/30 rounded-full pl-3 pr-4 py-2 flex items-center gap-2.5 animate-pop-in">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-discord-green shrink-0">
            <path d="M1 9a15.9 15.9 0 0 1 22 0 1 1 0 0 1-1.4 1.4 13.9 13.9 0 0 0-19.2 0A1 1 0 0 1 1 9zm3.5 3.5a10 10 0 0 1 15 0 1 1 0 1 1-1.5 1.4 8 8 0 0 0-12 0 1 1 0 1 1-1.5-1.4zM8 16a6 6 0 0 1 8 0 1 1 0 1 1-1.4 1.5 4 4 0 0 0-5.2 0A1 1 0 1 1 8 16zm4 2.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" />
          </svg>
          <span className="text-sm text-discord-text font-medium">Conexão restabelecida</span>
        </div>
      </div>
    )
  }

  return null
}
