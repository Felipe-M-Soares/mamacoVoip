import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { notify } from '../lib/notifications'
import type { DMMessage, DMMessageAttachment } from '../types/database'

export function useDirectMessages(conversationId: string | null) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<DMMessage[]>([])
  const [attachments, setAttachments] = useState<Record<string, DMMessageAttachment[]>>({})
  const [loading, setLoading] = useState(true)
  const messagesRef = useRef<DMMessage[]>([])
  messagesRef.current = messages

  const refreshAttachments = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) {
      setAttachments({})
      return
    }
    const { data } = await supabase.from('dm_message_attachments').select('*').in('message_id', messageIds)
    const map: Record<string, DMMessageAttachment[]> = {}
    for (const att of data ?? []) {
      map[att.message_id] = [...(map[att.message_id] ?? []), att]
    }
    setAttachments(map)
  }, [])

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setMessages([])
      setAttachments({})
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
    const list = data ?? []
    setMessages(list)
    await refreshAttachments(list.map((m) => m.id))
    setLoading(false)
  }, [conversationId, refreshAttachments])

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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_message_attachments' }, (payload) => {
        const att = payload.new as DMMessageAttachment
        if (messagesRef.current.some((m) => m.id === att.message_id)) {
          refreshAttachments(messagesRef.current.map((m) => m.id))
        }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          refresh()
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId, refreshAttachments, refresh])

  async function sendMessage(content: string, replyToId: string | null = null, files: File[] = []) {
    if (!conversationId || !user) return { error: 'Não foi possível enviar' }
    const { data: message, error } = await supabase
      .from('dm_messages')
      .insert({
        conversation_id: conversationId,
        author_id: user.id,
        content,
        reply_to_id: replyToId ?? undefined,
      })
      .select()
      .single()

    if (error || !message) return { error: error?.message ?? 'Erro ao enviar mensagem' }

    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]))

    const attachmentErrors: string[] = []
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_')
      const path = `${conversationId}/${message.id}-${safeName}`
      const { error: uploadError } = await supabase.storage
        .from('dm-attachments')
        .upload(path, file, { contentType: file.type || 'application/octet-stream' })
      if (uploadError) {
        attachmentErrors.push(uploadError.message)
        continue
      }

      const { data: urlData } = supabase.storage.from('dm-attachments').getPublicUrl(path)
      await supabase.from('dm_message_attachments').insert({
        message_id: message.id,
        file_url: urlData.publicUrl,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || 'application/octet-stream',
      })
    }

    if (files.length > 0) await refreshAttachments([...messagesRef.current.map((m) => m.id), message.id])
    if (attachmentErrors.length > 0) {
      return { error: `Mensagem enviada, mas o anexo falhou: ${attachmentErrors[0]}` }
    }
    return { error: null }
  }

  async function editMessage(messageId: string, content: string) {
    const { data, error } = await supabase.from('dm_messages').update({ content }).eq('id', messageId).select().single()
    if (!error && data) setMessages((prev) => prev.map((m) => (m.id === messageId ? data : m)))
    return { error: error?.message ?? null }
  }

  async function deleteMessage(messageId: string) {
    const { error } = await supabase.from('dm_messages').delete().eq('id', messageId)
    if (!error) setMessages((prev) => prev.filter((m) => m.id !== messageId))
    return { error: error?.message ?? null }
  }

  return { messages, attachments, loading, sendMessage, editMessage, deleteMessage }
}
