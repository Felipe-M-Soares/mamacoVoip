import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { notify } from '../lib/notifications'
import type { GroupMessage, GroupMessageAttachment } from '../types/database'

export function useGroupMessages(groupId: string | null) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<GroupMessage[]>([])
  const [attachments, setAttachments] = useState<Record<string, GroupMessageAttachment[]>>({})
  const [loading, setLoading] = useState(true)
  const messagesRef = useRef<GroupMessage[]>([])
  messagesRef.current = messages

  const refreshAttachments = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) {
      setAttachments({})
      return
    }
    const { data } = await supabase.from('group_message_attachments').select('*').in('message_id', messageIds)
    const map: Record<string, GroupMessageAttachment[]> = {}
    for (const att of data ?? []) {
      map[att.message_id] = [...(map[att.message_id] ?? []), att]
    }
    setAttachments(map)
  }, [])

  const refresh = useCallback(async () => {
    if (!groupId) {
      setMessages([])
      setAttachments({})
      setLoading(false)
      return
    }
    setLoading(true)
    const { data } = await supabase
      .from('group_messages')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: true })
      .limit(100)
    const list = data ?? []
    setMessages(list)
    await refreshAttachments(list.map((m) => m.id))
    setLoading(false)
  }, [groupId, refreshAttachments])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!groupId) return

    const channel = supabase
      .channel(`group_messages:${groupId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` },
        (payload) => {
          const newMessage = payload.new as GroupMessage
          setMessages((prev) => (prev.some((m) => m.id === newMessage.id) ? prev : [...prev, newMessage]))
          if (newMessage.author_id !== user?.id) {
            notify('Nova mensagem no grupo', newMessage.content.slice(0, 120))
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` },
        (payload) => {
          const updated = payload.new as GroupMessage
          setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` },
        (payload) => {
          const deletedId = (payload.old as { id: string }).id
          setMessages((prev) => prev.filter((m) => m.id !== deletedId))
        }
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_message_attachments' }, (payload) => {
        const att = payload.new as GroupMessageAttachment
        if (messagesRef.current.some((m) => m.id === att.message_id)) {
          refreshAttachments(messagesRef.current.map((m) => m.id))
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [groupId, user, refreshAttachments])

  async function sendMessage(content: string, replyToId: string | null = null, files: File[] = []) {
    if (!groupId || !user) return { error: 'Não foi possível enviar' }
    const { data: message, error } = await supabase
      .from('group_messages')
      .insert({ group_id: groupId, author_id: user.id, content, reply_to_id: replyToId ?? undefined })
      .select()
      .single()

    if (error || !message) return { error: error?.message ?? 'Erro ao enviar mensagem' }

    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]))

    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_')
      const path = `${groupId}/${message.id}-${safeName}`
      const { error: uploadError } = await supabase.storage.from('group-attachments').upload(path, file)
      if (uploadError) continue

      const { data: urlData } = supabase.storage.from('group-attachments').getPublicUrl(path)
      await supabase.from('group_message_attachments').insert({
        message_id: message.id,
        file_url: urlData.publicUrl,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || 'application/octet-stream',
      })
    }

    if (files.length > 0) await refreshAttachments([...messagesRef.current.map((m) => m.id), message.id])
    return { error: null }
  }

  async function editMessage(messageId: string, content: string) {
    const { data, error } = await supabase.from('group_messages').update({ content }).eq('id', messageId).select().single()
    if (!error && data) setMessages((prev) => prev.map((m) => (m.id === messageId ? data : m)))
    return { error: error?.message ?? null }
  }

  async function deleteMessage(messageId: string) {
    const { error } = await supabase.from('group_messages').delete().eq('id', messageId)
    if (!error) setMessages((prev) => prev.filter((m) => m.id !== messageId))
    return { error: error?.message ?? null }
  }

  return { messages, attachments, loading, sendMessage, editMessage, deleteMessage }
}
