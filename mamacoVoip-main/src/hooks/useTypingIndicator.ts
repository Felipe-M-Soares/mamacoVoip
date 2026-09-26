import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

const TYPING_TIMEOUT_MS = 4000
const SEND_THROTTLE_MS = 2000

export function useTypingIndicator(channelId: string | null, userId: string | undefined) {
  const [typingUserIds, setTypingUserIds] = useState<string[]>([])
  const channelRef = useRef<RealtimeChannel | null>(null)
  const timeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const lastSentRef = useRef(0)

  useEffect(() => {
    setTypingUserIds([])
    if (!channelId) return

    const rt = supabase.channel(`typing:${channelId}`, { config: { broadcast: { self: false } } })
    rt.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const uid = payload?.userId as string | undefined
      if (!uid || uid === userId) return
      setTypingUserIds((prev) => (prev.includes(uid) ? prev : [...prev, uid]))
      clearTimeout(timeoutsRef.current[uid])
      timeoutsRef.current[uid] = setTimeout(() => {
        setTypingUserIds((prev) => prev.filter((id) => id !== uid))
      }, TYPING_TIMEOUT_MS)
    })
    rt.subscribe()
    channelRef.current = rt

    return () => {
      supabase.removeChannel(rt)
      Object.values(timeoutsRef.current).forEach(clearTimeout)
      timeoutsRef.current = {}
    }
  }, [channelId, userId])

  function notifyTyping() {
    if (!channelRef.current || !userId) return
    const now = Date.now()
    // Não manda um broadcast a cada tecla — no máximo 1 a cada 2s já é
    // suficiente pra manter o indicador vivo do outro lado.
    if (now - lastSentRef.current < SEND_THROTTLE_MS) return
    lastSentRef.current = now
    channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { userId } })
  }

  return { typingUserIds, notifyTyping }
}
