import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { notify } from '../lib/notifications'
import type { DMMessage } from '../types/database'

export function useDirectMessages(conversationId: string | null) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<DMMessage[]>([])
  const [loading, setLoading] = useState(true)
  const messagesRef = useRef<DMMessage[]>([])
  messagesRef.current = messages

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setMessages([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data } = await supabase
      .from('dm_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(100)
    setMessages(data ?? [])
    setLoading(false)
  }, [conversationId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!conversationId) return

    const channel = supabase
      .channel(`dm_messages:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const newMessage = payload.new as DMMessage
          setMessages((prev) => (prev.some((m) => m.id === newMessage.id) ? prev : [...prev, newMessage]))
          if (newMessage.author_id !== user?.id) {
            notify('Nova mensagem direta', newMessage.content.slice(0, 120))
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const updated = payload.new as DMMessage
          setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const deletedId = (payload.old as { id: string }).id
          setMessages((prev) => prev.filter((m) => m.id !== deletedId))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId])

  async function sendMessage(content: string, replyToId: string | null = null) {
    if (!conversationId || !user) return { error: 'Não foi possível enviar' }
    const { error } = await supabase.from('dm_messages').insert({
      conversation_id: conversationId,
      author_id: user.id,
      content,
      reply_to_id: replyToId ?? undefined,
    })
    return { error: error?.message ?? null }
  }

  async function editMessage(messageId: string, content: string) {
    const { error } = await supabase.from('dm_messages').update({ content }).eq('id', messageId)
    return { error: error?.message ?? null }
  }

  async function deleteMessage(messageId: string) {
    const { error } = await supabase.from('dm_messages').delete().eq('id', messageId)
    return { error: error?.message ?? null }
  }

  return { messages, loading, sendMessage, editMessage, deleteMessage }
}
