import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const POLL_INTERVAL_MS = 20_000

// Não é 100% realtime de propósito: em vez de assinar mudanças em todas
// as tabelas de mensagens de todos os servidores do usuário (o que
// custaria uma subscription por canal/DM só pra badges), fazemos uma
// consulta agregada a cada 20s. Isso é um trade-off razoável pra um
// indicador de "não lido" — troca precisão ao segundo por muito menos
// conexões abertas.
export function useUnreadOverview() {
  const { user } = useAuth()
  const [unreadChannelIds, setUnreadChannelIds] = useState<Set<string>>(new Set())
  const [unreadServerIds, setUnreadServerIds] = useState<Set<string>>(new Set())
  const [unreadConversationIds, setUnreadConversationIds] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    if (!user) return

    const { data: memberRows } = await supabase.from('server_members').select('server_id').eq('user_id', user.id)
    const serverIds = (memberRows ?? []).map((m) => m.server_id)

    const { data: channelRows } =
      serverIds.length > 0
        ? await supabase.from('channels').select('id, server_id').in('server_id', serverIds).eq('type', 'text')
        : { data: [] as { id: string; server_id: string }[] }

    const channelIds = (channelRows ?? []).map((c) => c.id)

    const [{ data: latestMessages }, { data: readStates }] = await Promise.all([
      channelIds.length > 0
        ? supabase
            .from('messages')
            .select('channel_id, created_at')
            .in('channel_id', channelIds)
            .order('created_at', { ascending: false })
            .limit(1000)
        : Promise.resolve({ data: [] as { channel_id: string; created_at: string }[] }),
      supabase.from('channel_read_state').select('*').eq('user_id', user.id),
    ])

    const lastMessageByChannel = new Map<string, string>()
    for (const m of latestMessages ?? []) {
      if (!lastMessageByChannel.has(m.channel_id)) lastMessageByChannel.set(m.channel_id, m.created_at)
    }
    const readByChannel = new Map((readStates ?? []).map((r) => [r.channel_id, r.last_read_at]))

    const unreadChannels = new Set<string>()
    const unreadServers = new Set<string>()
    for (const channel of channelRows ?? []) {
      const lastMessage = lastMessageByChannel.get(channel.id)
      if (!lastMessage) continue
      const lastRead = readByChannel.get(channel.id)
      if (!lastRead || new Date(lastMessage) > new Date(lastRead)) {
        unreadChannels.add(channel.id)
        unreadServers.add(channel.server_id)
      }
    }

    const { data: convoRows } = await supabase
      .from('dm_conversations')
      .select('*')
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
    const convoIds = (convoRows ?? []).map((c) => c.id)

    const [{ data: latestDms }, { data: dmReadStates }] = await Promise.all([
      convoIds.length > 0
        ? supabase
            .from('dm_messages')
            .select('conversation_id, created_at')
            .in('conversation_id', convoIds)
            .order('created_at', { ascending: false })
            .limit(1000)
        : Promise.resolve({ data: [] as { conversation_id: string; created_at: string }[] }),
      supabase.from('dm_read_state').select('*').eq('user_id', user.id),
    ])

    const lastDmByConvo = new Map<string, string>()
    for (const m of latestDms ?? []) {
      if (!lastDmByConvo.has(m.conversation_id)) lastDmByConvo.set(m.conversation_id, m.created_at)
    }
    const readByConvo = new Map((dmReadStates ?? []).map((r) => [r.conversation_id, r.last_read_at]))

    const unreadConvos = new Set<string>()
    for (const id of convoIds) {
      const lastMessage = lastDmByConvo.get(id)
      if (!lastMessage) continue
      const lastRead = readByConvo.get(id)
      if (!lastRead || new Date(lastMessage) > new Date(lastRead)) unreadConvos.add(id)
    }

    setUnreadChannelIds(unreadChannels)
    setUnreadServerIds(unreadServers)
    setUnreadConversationIds(unreadConvos)
  }, [user])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  async function markChannelRead(channelId: string) {
    if (!user) return
    setUnreadChannelIds((prev) => {
      if (!prev.has(channelId)) return prev
      const next = new Set(prev)
      next.delete(channelId)
      return next
    })
    await supabase
      .from('channel_read_state')
      .upsert({ channel_id: channelId, user_id: user.id, last_read_at: new Date().toISOString() })
  }

  async function markConversationRead(conversationId: string) {
    if (!user) return
    setUnreadConversationIds((prev) => {
      if (!prev.has(conversationId)) return prev
      const next = new Set(prev)
      next.delete(conversationId)
      return next
    })
    await supabase
      .from('dm_read_state')
      .upsert({ conversation_id: conversationId, user_id: user.id, last_read_at: new Date().toISOString() })
  }

  return { unreadChannelIds, unreadServerIds, unreadConversationIds, markChannelRead, markConversationRead, refresh }
}
