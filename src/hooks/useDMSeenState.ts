import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Retorna até quando a OUTRA pessoa da conversa leu — usado pra
// mostrar "Visto" embaixo da sua última mensagem quando ela já foi
// lida por quem recebeu.
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

    const channel = supabase
      .channel(`dm_seen:${convoId}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dm_read_state', filter: `conversation_id=eq.${convoId}` },
        fetchState
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [conversationId, otherUserId])

  return otherLastReadAt
}
