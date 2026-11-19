import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { openSharedChannel } from '../lib/realtimeChannel'
import { useAuth } from '../hooks/useAuth'

interface PresenceContextValue {
  onlineIds: Set<string>
}

export const PresenceContext = createContext<PresenceContextValue>({ onlineIds: new Set() })

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [onlineIds, setOnlineIds] = useState<Set<string>>(EMPTY_SET)

  useEffect(() => {
    if (!userId) {
      setOnlineIds(EMPTY_SET)
      return
    }

    return openSharedChannel('presence:online', { config: { presence: { key: userId } } }, (channel) => {
      channel
        .on('presence', { event: 'sync' }, () => {
          const next = new Set(Object.keys(channel.presenceState()))
          setOnlineIds((prev) => (sameSet(prev, next) ? prev : next))
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            void channel.track({ online_at: new Date().toISOString() })
          }
        })
    })
  }, [userId])

  const value = useMemo(() => ({ onlineIds }), [onlineIds])
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
}

const EMPTY_SET: Set<string> = new Set()

function sameSet(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}
