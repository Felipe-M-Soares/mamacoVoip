import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { Thread } from '../types/database'

// Mapa mensagem-pai -> thread, pra saber rapidamente se uma mensagem
// já tem uma thread e mostrar "N respostas" embaixo dela.
export function useChannelThreads(channelId: string | null) {
  const { user } = useAuth()
  const [threadsByMessageId, setThreadsByMessageId] = useState<Record<string, Thread>>({})
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({})

  const refresh = useCallback(async () => {
    if (!channelId) {
      setThreadsByMessageId({})
      setReplyCounts({})
      return
    }
    const { data: threads } = await supabase.from('threads').select('*').eq('channel_id', channelId)
    const byMessage: Record<string, Thread> = {}
    for (const t of threads ?? []) byMessage[t.parent_message_id] = t
    setThreadsByMessageId(byMessage)

    if ((threads ?? []).length > 0) {
      const { data: counts } = await supabase
        .from('messages')
        .select('thread_id')
        .in(
          'thread_id',
          (threads ?? []).map((t) => t.id)
        )
      const countMap: Record<string, number> = {}
      for (const row of counts ?? []) {
        if (row.thread_id) countMap[row.thread_id] = (countMap[row.thread_id] ?? 0) + 1
      }
      setReplyCounts(countMap)
    } else {
      setReplyCounts({})
    }
  }, [channelId])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function createThread(parentMessageId: string, serverId: string, name: string): Promise<{ error: string | null; thread?: Thread }> {
    if (!channelId || !user) return { error: 'Não foi possível criar a thread' }
    const cleanName = name.trim().slice(0, 80)
    if (cleanName.length < 1) return { error: 'Digite um nome pra thread.' }

    const { data, error } = await supabase
      .from('threads')
      .insert({ channel_id: channelId, server_id: serverId, parent_message_id: parentMessageId, name: cleanName, created_by: user.id })
      .select()
      .single()

    if (error || !data) return { error: error?.message ?? 'Erro ao criar a thread' }
    await refresh()
    return { error: null, thread: data }
  }

  return { threadsByMessageId, replyCounts, createThread, refreshThreads: refresh }
}
