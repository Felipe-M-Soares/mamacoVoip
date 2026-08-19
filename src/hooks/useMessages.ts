import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useChannelMutes } from './useChannelMutes'
import { notify } from '../lib/notifications'
import type { Message, MessageAttachment, MessageReaction } from '../types/database'

export function useMessages(channelId: string | null, serverId: string | null, threadId: string | null = null) {
  const { user, profile } = useAuth()
  const { getLevel } = useChannelMutes()
  const [messages, setMessages] = useState<Message[]>([])
  const [attachments, setAttachments] = useState<Record<string, MessageAttachment[]>>({})
  const [reactions, setReactions] = useState<Record<string, MessageReaction[]>>({})
  const [loading, setLoading] = useState(true)
  const messagesRef = useRef<Message[]>([])
  messagesRef.current = messages

  const refreshExtras = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) {
      setAttachments({})
      setReactions({})
      return
    }
    const [{ data: atts }, { data: reacts }] = await Promise.all([
      supabase.from('message_attachments').select('*').in('message_id', messageIds),
      supabase.from('message_reactions').select('*').in('message_id', messageIds),
    ])

    const attMap: Record<string, MessageAttachment[]> = {}
    for (const a of atts ?? []) {
      attMap[a.message_id] = [...(attMap[a.message_id] ?? []), a]
    }
    setAttachments(attMap)

    const reactMap: Record<string, MessageReaction[]> = {}
    for (const r of reacts ?? []) {
      reactMap[r.message_id] = [...(reactMap[r.message_id] ?? []), r]
    }
    setReactions(reactMap)
  }, [])

  const refresh = useCallback(async () => {
    if (!channelId) {
      setMessages([])
      setAttachments({})
      setReactions({})
      setLoading(false)
      return
    }
    setLoading(true)
    let query = supabase.from('messages').select('*').order('created_at', { ascending: true }).limit(100)
    // Mensagens de dentro de uma thread ficam separadas das mensagens
    // "normais" do canal — sem esse filtro, elas apareceriam
    // duplicadas na visão principal do canal.
    query = threadId ? query.eq('thread_id', threadId) : query.eq('channel_id', channelId).is('thread_id', null)
    const { data } = await query

    const list = data ?? []
    setMessages(list)
    await refreshExtras(list.map((m) => m.id))
    setLoading(false)
  }, [channelId, threadId, refreshExtras])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Realtime: novas mensagens, edições e exclusões neste canal (ou
  // nesta thread específica, se threadId estiver definido)
  useEffect(() => {
    if (!channelId) return

    const channel = supabase
      .channel(`messages:${channelId}${threadId ? `:${threadId}` : ''}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const newMessage = payload.new as Message
          // Só aceita a mensagem se ela pertence à mesma "visão" que
          // esse hook está mostrando — canal principal (sem thread) ou
          // a thread específica que foi pedida.
          const belongsHere = threadId ? newMessage.thread_id === threadId : newMessage.thread_id === null
          if (!belongsHere) return
          setMessages((prev) => (prev.some((m) => m.id === newMessage.id) ? prev : [...prev, newMessage]))
          if (newMessage.author_id !== user?.id) {
            const level = getLevel(newMessage.channel_id)
            const mentionsMe =
              level === 'mentions' && profile?.username
                ? new RegExp(`@(everyone|here|${profile.username})\\b`, 'i').test(newMessage.content)
                : false
            if (level === 'all' || mentionsMe) {
              notify('Nova mensagem', newMessage.content.slice(0, 120))
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const updated = payload.new as Message
          setMessages((prev) => (prev.some((m) => m.id === updated.id) ? prev.map((m) => (m.id === updated.id ? updated : m)) : prev))
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const deletedId = (payload.old as { id: string }).id
          setMessages((prev) => prev.filter((m) => m.id !== deletedId))
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const row = (payload.new ?? payload.old) as MessageReaction | undefined
          if (!row) return
          // só nos importa se a mensagem afetada estiver carregada neste canal
          if (messagesRef.current.some((m) => m.id === row.message_id)) {
            refreshExtras(messagesRef.current.map((m) => m.id))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [channelId, threadId, refreshExtras])

  async function sendMessage(content: string, replyToId: string | null, files: File[] = []) {
    if (!channelId || !serverId || !user) return { error: 'Não foi possível enviar a mensagem' }

    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        channel_id: channelId,
        server_id: serverId,
        author_id: user.id,
        content,
        reply_to_id: replyToId ?? undefined,
        thread_id: threadId ?? undefined,
      })
      .select()
      .single()

    if (error || !message) return { error: error?.message ?? 'Erro ao enviar mensagem' }

    // Mostra a mensagem na hora, sem esperar ela "voltar" pelo canal de
    // tempo real — antes, o app dependia inteiramente do evento de
    // tempo real chegar de volta pra mostrar a PRÓPRIA mensagem que
    // você acabou de mandar. Se esse evento atrasasse ou falhasse, a
    // mensagem ficava salva no banco mas nunca aparecia sozinha (só
    // depois de atualizar a página, que busca tudo de novo do zero).
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]))

    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_')
      const path = `${serverId}/${channelId}/${message.id}-${safeName}`
      const { error: uploadError } = await supabase.storage.from('attachments').upload(path, file)
      if (uploadError) continue

      const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(path)
      await supabase.from('message_attachments').insert({
        message_id: message.id,
        file_url: urlData.publicUrl,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || 'application/octet-stream',
      })
    }

    if (files.length > 0) await refreshExtras([...messagesRef.current.map((m) => m.id), message.id])
    return { error: null }
  }

  async function editMessage(messageId: string, content: string) {
    const { data, error } = await supabase.from('messages').update({ content }).eq('id', messageId).select().single()
    if (!error && data) setMessages((prev) => prev.map((m) => (m.id === messageId ? data : m)))
    return { error: error?.message ?? null }
  }

  async function deleteMessage(messageId: string) {
    const { error } = await supabase.from('messages').delete().eq('id', messageId)
    if (!error) setMessages((prev) => prev.filter((m) => m.id !== messageId))
    return { error: error?.message ?? null }
  }

  async function pinMessage(messageId: string) {
    if (!user) return { error: 'Não autenticado' }
    const { error } = await supabase
      .from('messages')
      .update({ pinned_at: new Date().toISOString(), pinned_by: user.id })
      .eq('id', messageId)
    return { error: error?.message ?? null }
  }

  async function unpinMessage(messageId: string) {
    const { error } = await supabase.from('messages').update({ pinned_at: null, pinned_by: null }).eq('id', messageId)
    return { error: error?.message ?? null }
  }

  // Busca as fixadas de verdade em vez de depender das mensagens já
  // carregadas na tela — uma mensagem fixada pode ter sido enviada há
  // muito tempo, fora da janela recente que normalmente é exibida.
  async function fetchPinnedMessages(): Promise<Message[]> {
    if (!channelId) return []
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('channel_id', channelId)
      .not('pinned_at', 'is', null)
      .order('pinned_at', { ascending: false })
    return (data as Message[] | null) ?? []
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!user) return
    const existing = reactions[messageId]?.find((r) => r.user_id === user.id && r.emoji === emoji)

    if (existing) {
      await supabase
        .from('message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', user.id)
        .eq('emoji', emoji)
    } else {
      await supabase.from('message_reactions').insert({ message_id: messageId, user_id: user.id, emoji })
    }
    await refreshExtras(messagesRef.current.map((m) => m.id))
  }

  return {
    messages,
    attachments,
    reactions,
    loading,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    pinMessage,
    unpinMessage,
    fetchPinnedMessages,
  }
}
