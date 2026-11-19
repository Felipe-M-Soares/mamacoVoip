import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { privateChannelParams } from '../lib/realtimeChannel'

export function useVoicePresence(channelId: string | null, skip = false) {
  const [userIds, setUserIds] = useState<string[]>([])

  useEffect(() => {
    if (!channelId || skip) {
      setUserIds([])
      return
    }

    let cancelled = false
    let activeChannel: ReturnType<typeof supabase.channel> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const topic = `voice:${channelId}`

    const trySubscribe = () => {
      if (cancelled) return

      const existing = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
      if (existing && existing.state !== 'closed' && existing.state !== 'errored') {
        retryTimer = setTimeout(trySubscribe, 250)
        return
      }

      const rt = supabase.channel(
        topic,
        privateChannelParams({
          config: { presence: { key: `observer-${Math.random().toString(36).slice(2)}` } },
        })
      )
      activeChannel = rt

      try {
        rt.on('presence', { event: 'sync' }, () => {
          const state = rt.presenceState()
          const ids = Object.keys(state).filter((key) => !key.startsWith('observer-'))
          setUserIds(ids)
        })
        rt.subscribe()
      } catch {
        supabase.removeChannel(rt)
        activeChannel = null
        retryTimer = setTimeout(trySubscribe, 250)
      }
    }

    trySubscribe()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (activeChannel) supabase.removeChannel(activeChannel)
    }
  }, [channelId, skip])

  return userIds
}
