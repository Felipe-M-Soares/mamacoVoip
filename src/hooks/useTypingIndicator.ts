import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { openSharedChannel } from '../lib/realtimeChannel'

const TYPING_TIMEOUT_MS = 5000
const SEND_THROTTLE_MS = 3000
const EMPTY: string[] = []

export function useTypingIndicator(channelId: string | null, userId: string | undefined) {
  const [typing, setTyping] = useState<{ key: string | null; ids: string[] }>({ key: channelId, ids: EMPTY })
  const channelRef = useRef<RealtimeChannel | null>(null)
  const timeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const lastSentRef = useRef(0)

  useEffect(() => {
    setTyping({ key: channelId, ids: EMPTY })
    lastSentRef.current = 0
    if (!channelId) return

    const removeUser = (uid: string) => {
      clearTimeout(timeoutsRef.current[uid])
      delete timeoutsRef.current[uid]
      setTyping((prev) => (prev.ids.includes(uid) ? { key: prev.key, ids: prev.ids.filter((id) => id !== uid) } : prev))
    }

    const close = openSharedChannel(`typing:${channelId}`, { config: { broadcast: { self: false } } }, (rt) => {
      rt.on('broadcast', { event: 'typing' }, ({ payload }) => {
        const uid = payload?.userId as string | undefined
        if (!uid || uid === userId) return
        setTyping((prev) => (prev.ids.includes(uid) ? prev : { key: prev.key, ids: [...prev.ids, uid] }))
        clearTimeout(timeoutsRef.current[uid])
        timeoutsRef.current[uid] = setTimeout(() => removeUser(uid), TYPING_TIMEOUT_MS)
      })
      rt.on('broadcast', { event: 'stop_typing' }, ({ payload }) => {
        const uid = payload?.userId as string | undefined
        if (uid) removeUser(uid)
      })
      rt.subscribe()
      channelRef.current = rt
    })

    const timeouts = timeoutsRef.current
    return () => {
      close()
      channelRef.current = null
      Object.values(timeouts).forEach(clearTimeout)
      timeoutsRef.current = {}
    }
  }, [channelId, userId])

  const notifyTyping = useCallback(() => {
    if (!channelRef.current || !userId) return
    const now = Date.now()
    if (now - lastSentRef.current < SEND_THROTTLE_MS) return
    lastSentRef.current = now
    void channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { userId } })
  }, [userId])

  const stopTyping = useCallback(() => {
    if (!channelRef.current || !userId || lastSentRef.current === 0) return
    lastSentRef.current = 0
    void channelRef.current.send({ type: 'broadcast', event: 'stop_typing', payload: { userId } })
  }, [userId])

  const typingUserIds = typing.key === channelId ? typing.ids : EMPTY

  return { typingUserIds, notifyTyping, stopTyping }
}
