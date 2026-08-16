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
      <div className="fixed top-0 inset-x-0 z-[300] bg-gradient-to-r from-red-950 via-discord-darker to-red-950 border-b border-red-900/60">
        <div className="max-w-3xl mx-auto px-4 py-2 flex items-center justify-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-red-300 shrink-0">
            <path d="M3.6 3.6a1 1 0 0 0-1.4 1.4l3.4 3.4A15.9 15.9 0 0 0 1 12.5a1 1 0 0 0 1.6 1.2 13.9 13.9 0 0 1 3.4-2.9l2 2A9.9 9.9 0 0 0 5.4 15a1 1 0 0 0 1.5 1.3 8 8 0 0 1 2.8-2l1.9 1.9a5.9 5.9 0 0 0-2 1.3A1 1 0 0 0 11 19l1-1 6.6 6.6a1 1 0 0 0 1.4-1.4l-16.4-16.4v-3.2zM12 4c-1 0-2 .1-3 .3l1.8 1.8A14 14 0 0 1 23 12.5a1 1 0 0 1-1.6 1.2 12 12 0 0 0-3.8-3.1l1.5 1.5a10 10 0 0 1 2.5 1.7 1 1 0 0 1-1.3 1.5 8 8 0 0 0-2-1.3l1.5 1.5c.6.3 1.1.7 1.6 1.1a1 1 0 0 1-1.3 1.5 6 6 0 0 0-1-.8L21.4 17A16 16 0 0 0 12 4z" />
          </svg>
          <span className="text-sm text-red-200 font-medium">Sem conexão com a internet — tentando reconectar...</span>
        </div>
      </div>
    )
  }

  if (showReconnected) {
    return (
      <div className="fixed top-0 inset-x-0 z-[300] bg-gradient-to-r from-green-950 via-discord-darker to-green-950 border-b border-discord-green/40">
        <div className="max-w-3xl mx-auto px-4 py-2 flex items-center justify-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-discord-green shrink-0" />
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-discord-green shrink-0">
            <path d="M1 9a15.9 15.9 0 0 1 22 0 1 1 0 0 1-1.4 1.4 13.9 13.9 0 0 0-19.2 0A1 1 0 0 1 1 9zm3.5 3.5a10 10 0 0 1 15 0 1 1 0 1 1-1.5 1.4 8 8 0 0 0-12 0 1 1 0 1 1-1.5-1.4zM8 16a6 6 0 0 1 8 0 1 1 0 1 1-1.4 1.5 4 4 0 0 0-5.2 0A1 1 0 1 1 8 16zm4 2.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" />
          </svg>
          <span className="text-sm text-discord-green font-medium">Conexão restabelecida</span>
        </div>
      </div>
    )
  }

  return null
}
