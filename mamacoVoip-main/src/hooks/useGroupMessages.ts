import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { notify } from '../lib/notifications'
import { describeError } from '../lib/errors'
import { rateLimitError } from '../lib/rateLimit'
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
      .subscribe((status, err) => {
        if (status !== 'SUBSCRIBED') {
          console.error('[useGroupMessages] Status da inscrição em tempo real:', status, err ?? '')
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          refresh()
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [groupId, user, refreshAttachments, refresh])

  // Mesmo motivo do useMessages.ts (chat de canal) e useDirectMessages.ts:
  // sem o try/catch, uma exceção lançada aqui (em vez de resolvida como
  // { error }) quebrava a promise antes de qualquer erro voltar pra
  // composer — parecia "escrever e mandar não faz nada" em grupo também.
  async function sendMessage(content: string, replyToId: string | null = null, files: File[] = []) {
    if (!groupId || !user) return { error: 'Não foi possível enviar' }
    // DÉCIMA SÉTIMA RODADA: cooldown de UX (ver lib/rateLimit.ts) contra
    // flood acidental — por grupo, não global.
    const limited = rateLimitError(`message:group:${groupId}`, 8, 10_000, 'você está mandando mensagem')
    if (limited) return { error: limited }
    try {
      const { data: message, error } = await supabase
        .from('group_messages')
        .insert({ group_id: groupId, author_id: user.id, content, reply_to_id: replyToId ?? undefined })
        .select()
        .single()

      if (error || !message) return { error: describeError(error, 'Erro ao enviar mensagem') }

      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]))

      const attachmentErrors: string[] = []
      for (const file of files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_')
        const path = `${groupId}/${message.id}-${safeName}`
        const { error: uploadError } = await supabase.storage
          .from('group-attachments')
          .upload(path, file, { contentType: file.type || 'application/octet-stream' })
        if (uploadError) {
          attachmentErrors.push(describeError(uploadError, 'Falha ao subir o anexo'))
          continue
        }

        const { data: urlData } = supabase.storage.from('group-attachments').getPublicUrl(path)
        const { error: attError } = await supabase.from('group_message_attachments').insert({
          message_id: message.id,
          file_url: urlData.publicUrl,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || 'application/octet-stream',
        })
        if (attError) attachmentErrors.push(describeError(attError, 'Falha ao registrar o anexo'))
      }

      if (files.length > 0) await refreshAttachments([...messagesRef.current.map((m) => m.id), message.id])
      if (attachmentErrors.length > 0) {
        return { error: `Mensagem enviada, mas o anexo falhou: ${attachmentErrors[0]}` }
      }
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Erro ao enviar mensagem') }
    }
  }

  async function editMessage(messageId: string, content: string) {
    try {
      const { data, error } = await supabase.from('group_messages').update({ content }).eq('id', messageId).select().single()
      if (error) return { error: describeError(error, 'Não foi possível editar a mensagem') }
      if (data) setMessages((prev) => prev.map((m) => (m.id === messageId ? data : m)))
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível editar a mensagem') }
    }
  }

  async function deleteMessage(messageId: string) {
    try {
      const { error } = await supabase.from('group_messages').delete().eq('id', messageId)
      if (error) return { error: describeError(error, 'Não foi possível excluir a mensagem') }
      setMessages((prev) => prev.filter((m) => m.id !== messageId))
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível excluir a mensagem') }
    }
  }

  return { messages, attachments, loading, sendMessage, editMessage, deleteMessage }
}
