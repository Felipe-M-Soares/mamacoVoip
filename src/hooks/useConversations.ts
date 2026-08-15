import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { DMConversation, DMMessage, Profile } from '../types/database'

export type ConversationWithDetails = DMConversation & {
  otherProfile: Profile
  lastMessage: DMMessage | null
}

export function useConversations() {
  const { user } = useAuth()
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!user) {
      setConversations([])
      setLoading(false)
      return
    }
    setLoading(true)

    const { data: convos } = await supabase
      .from('dm_conversations')
      .select('*')
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)

    if (!convos || convos.length === 0) {
      setConversations([])
      setLoading(false)
      return
    }

    const otherIds = convos.map((c) => (c.user_a === user.id ? c.user_b : c.user_a))
    const { data: profiles } = await supabase.from('profiles').select('*').in('id', otherIds)
    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))

    const withDetails = await Promise.all(
      convos.map(async (c): Promise<ConversationWithDetails | null> => {
        const otherId = c.user_a === user.id ? c.user_b : c.user_a
        const otherProfile = profileById.get(otherId)
        if (!otherProfile) return null

        const { data: lastMessages } = await supabase
          .from('dm_messages')
          .select('*')
          .eq('conversation_id', c.id)
          .order('created_at', { ascending: false })
          .limit(1)

        return { ...c, otherProfile, lastMessage: lastMessages?.[0] ?? null }
      })
    )

    const filtered = withDetails.filter((c): c is ConversationWithDetails => c !== null)
    filtered.sort((a, b) => {
      const aTime = a.lastMessage?.created_at ?? a.created_at
      const bTime = b.lastMessage?.created_at ?? b.created_at
      return new Date(bTime).getTime() - new Date(aTime).getTime()
    })

    setConversations(filtered)
    setLoading(false)
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function openConversationWith(otherUserId: string) {
    const { data, error } = await supabase.rpc('get_or_create_dm', { p_other_user_id: otherUserId })
    if (!error) await refresh()
    return { error: error?.message ?? null, conversation: data ?? undefined }
  }

  return { conversations, loading, refresh, openConversationWith }
}
