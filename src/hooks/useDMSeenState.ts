import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { changesChannel } from '../lib/realtimeChannel'

export function useDMSeenState(conversationId: string | null, otherUserId: string | null) {
  const [otherLastReadAt, setOtherLastReadAt] = useState<string | null>(null)

  useEffect(() => {
    if (!conversationId || !otherUserId) {
      setOtherLastReadAt(null)
      return
    }

    let cancelled = false
    const convoId = conversationId
    const otherId = otherUserId
    async function fetchState() {
      const { data } = await supabase
        .from('dm_read_state')
        .select('last_read_at')
        .eq('conversation_id', convoId)
        .eq('user_id', otherId)
        .maybeSingle()
      if (!cancelled) setOtherLastReadAt(data?.last_read_at ?? null)
    }
    fetchState()

    const channel = changesChannel(`dm_seen:${convoId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dm_read_state', filter: `conversation_id=eq.${convoId}` },
        (payload) => {
          const row = payload.new as { user_id?: string; last_read_at?: string } | null
          if (row?.user_id && row.user_id !== otherId) return
          if (row?.user_id === otherId && row.last_read_at) {
            if (!cancelled) setOtherLastReadAt(row.last_read_at)
            return
          }
          void fetchState()
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [conversationId, otherUserId])

  return otherLastReadAt
}
