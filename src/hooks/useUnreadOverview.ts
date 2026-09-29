import { useCallback, useEffect, useRef, useState } from 'react'
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
  // Só o ID — o objeto `user` muda a cada renovação do token, o que antes
  // reiniciava o intervalo e disparava uma rodada extra de consultas.
  const userId = user?.id ?? null
  const [unreadChannelIds, setUnreadChannelIds] = useState<Set<string>>(EMPTY_SET)
  const [unreadServerIds, setUnreadServerIds] = useState<Set<string>>(EMPTY_SET)
  const [unreadConversationIds, setUnreadConversationIds] = useState<Set<string>>(EMPTY_SET)
  // Leituras feitas localmente (ao abrir um canal/conversa). Uma consulta
  // que já estava em andamento quando a pessoa abriu o canal voltava com o
  // `last_read_at` antigo e fazia a bolinha de não lido REAPARECER num
  // canal que ela acabou de ler. Com isso, vale sempre a leitura mais nova.
  const localReadsRef = useRef<Map<string, string>>(new Map())
  const inFlightRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!userId || inFlightRef.current) return
    inFlightRef.current = true
    try {
      const latestRead = (id: string, remote: string | undefined) => {
        const local = localReadsRef.current.get(id)
        if (!local) return remote
        if (!remote) return local
        return local > remote ? local : remote
      }

      // As duas metades (canais de servidor e DMs) não dependem uma da
      // outra — antes rodavam em sequência.
      const channelsPart = (async () => {
        const { data: memberRows } = await supabase.from('server_members').select('server_id').eq('user_id', userId)
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
          supabase.from('channel_read_state').select('channel_id, last_read_at').eq('user_id', userId),
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
          const lastRead = latestRead(channel.id, readByChannel.get(channel.id))
          if (!lastRead || new Date(lastMessage) > new Date(lastRead)) {
            unreadChannels.add(channel.id)
            unreadServers.add(channel.server_id)
          }
        }
        return { unreadChannels, unreadServers }
      })()

      const dmsPart = (async () => {
        // só o id é usado (antes era select('*'))
        const { data: convoRows } = await supabase
          .from('dm_conversations')
          .select('id')
          .or(`user_a.eq.${userId},user_b.eq.${userId}`)
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
          supabase.from('dm_read_state').select('conversation_id, last_read_at').eq('user_id', userId),
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
          const lastRead = latestRead(id, readByConvo.get(id))
          if (!lastRead || new Date(lastMessage) > new Date(lastRead)) unreadConvos.add(id)
        }
        return unreadConvos
      })()

      const [{ unreadChannels, unreadServers }, unreadConvos] = await Promise.all([channelsPart, dmsPart])

      // Só troca o Set quando o conteúdo mudou — um Set novo a cada 20s
      // re-renderizava a barra de servidores, a de canais e a de DMs inteiras.
      setUnreadChannelIds((prev) => (sameSet(prev, unreadChannels) ? prev : unreadChannels))
      setUnreadServerIds((prev) => (sameSet(prev, unreadServers) ? prev : unreadServers))
      setUnreadConversationIds((prev) => (sameSet(prev, unreadConvos) ? prev : unreadConvos))
    } catch (err) {
      console.error('[useUnreadOverview] Falha ao atualizar não lidos:', err)
    } finally {
      inFlightRef.current = false
    }
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setUnreadChannelIds(EMPTY_SET)
      setUnreadServerIds(EMPTY_SET)
      setUnreadConversationIds(EMPTY_SET)
      localReadsRef.current.clear()
      return
    }
    void refresh()
    // Não consulta com a janela escondida/minimizada (economiza rede e
    // bateria); ao voltar, atualiza na hora.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId, refresh])

  const markChannelRead = useCallback(
    async (channelId: string) => {
      if (!userId) return
      const now = new Date().toISOString()
      localReadsRef.current.set(channelId, now)
      setUnreadChannelIds((prev) => {
        if (!prev.has(channelId)) return prev
        const next = new Set(prev)
        next.delete(channelId)
        return next
      })
      const { error } = await supabase.from('channel_read_state').upsert({ channel_id: channelId, user_id: userId, last_read_at: now })
      if (error) console.error('[useUnreadOverview] Falha ao marcar canal como lido:', error)
    },
    [userId]
  )

  const markConversationRead = useCallback(
    async (conversationId: string) => {
      if (!userId) return
      const now = new Date().toISOString()
      localReadsRef.current.set(conversationId, now)
      setUnreadConversationIds((prev) => {
        if (!prev.has(conversationId)) return prev
        const next = new Set(prev)
        next.delete(conversationId)
        return next
      })
      const { error } = await supabase
        .from('dm_read_state')
        .upsert({ conversation_id: conversationId, user_id: userId, last_read_at: now })
      if (error) console.error('[useUnreadOverview] Falha ao marcar conversa como lida:', error)
    },
    [userId]
  )

  return { unreadChannelIds, unreadServerIds, unreadConversationIds, markChannelRead, markConversationRead, refresh }
}

const EMPTY_SET: Set<string> = new Set()

function sameSet(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}
