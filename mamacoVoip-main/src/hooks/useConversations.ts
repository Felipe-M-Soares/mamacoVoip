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

    // Só traz conversas que a pessoa NÃO apagou do próprio lado (ver
    // hideConversation abaixo e 003_social_FIX_dm_delete.sql) — apagar
    // uma conversa só esconde ela pra quem apagou, então o filtro
    // precisa considerar de que lado (user_a ou user_b) essa pessoa está.
    const { data: convos } = await supabase
      .from('dm_conversations')
      .select('*')
      .or(`and(user_a.eq.${user.id},hidden_for_a.eq.false),and(user_b.eq.${user.id},hidden_for_b.eq.false)`)

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

  // Sem isso, uma conversa nova (a PRIMEIRA mensagem ou convite que
  // alguém te manda, sem vocês nunca terem se falado antes por DM) só
  // aparecia na lista de quem RECEBEU depois de recarregar o app
  // manualmente — quem manda já via na hora (por causa do refresh()
  // manual que openConversationWith já chama do lado de quem inicia),
  // mas o outro lado não tinha nenhum jeito de saber que uma conversa
  // nova existe sem esse recarregamento. O filtro do Realtime só aceita
  // uma comparação por vez, e a pessoa pode estar tanto em "user_a"
  // quanto em "user_b" — por isso duas inscrições separadas em vez de
  // uma só com "ou".
  useEffect(() => {
    if (!user) return
    // Esse hook é chamado de vários componentes ao mesmo tempo
    // (MainLayout, HomeSidebar, FriendsPanel, etc.) — cada um monta seu
    // próprio efeito. Se todos pedissem um canal com o MESMO nome
    // (`dm_conversations:${user.id}`), o cliente do Supabase devolveria
    // o canal já existente (e já inscrito) em vez de criar um novo — e
    // encadear `.on()` num canal que já chamou `.subscribe()` derruba o
    // app com "cannot add postgres_changes callbacks ... after
    // subscribe()". Por isso cada montagem usa um nome de canal único
    // (mesmo filtro, mesma tabela — só o nome muda).
    const uniqueSuffix = Math.random().toString(36).slice(2)
    const channel = supabase
      .channel(`dm_conversations:${user.id}:${uniqueSuffix}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_conversations', filter: `user_a=eq.${user.id}` },
        () => refresh()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_conversations', filter: `user_b=eq.${user.id}` },
        () => refresh()
      )
      // UPDATE também importa aqui: é assim que uma conversa apagada
      // "reaparece" quando a outra pessoa manda uma mensagem nova (ver
      // o gatilho on_dm_message_unhide_conversation) — sem isso, a
      // pessoa só via a conversa de volta depois de reabrir o app.
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'dm_conversations', filter: `user_a=eq.${user.id}` },
        () => refresh()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'dm_conversations', filter: `user_b=eq.${user.id}` },
        () => refresh()
      )
      .subscribe((status, err) => {
        if (status !== 'SUBSCRIBED') {
          console.error('[useConversations] Status da inscrição em tempo real:', status, err ?? '')
        }
      })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, refresh])

  async function openConversationWith(otherUserId: string) {
    const { data, error } = await supabase.rpc('get_or_create_dm', { p_other_user_id: otherUserId })
    if (!error) await refresh()
    return { error: error?.message ?? null, conversation: data ?? undefined }
  }

  // "Apaga" a conversa só da SUA lista (a outra pessoa continua vendo
  // normalmente) — ver o comentário grande em
  // 003_social_FIX_dm_delete.sql pro porquê de não ser um delete de
  // verdade. Se a outra pessoa mandar mensagem de novo depois, a
  // conversa reaparece sozinha.
  async function hideConversation(conversationId: string) {
    const { error } = await supabase.rpc('hide_dm_conversation', { p_conversation_id: conversationId })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  return { conversations, loading, refresh, openConversationWith, hideConversation }
}
