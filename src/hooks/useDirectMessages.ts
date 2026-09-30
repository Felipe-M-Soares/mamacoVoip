import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { applyDmMessageToConversations } from './useConversations'
import { removeAttachmentObjects } from '../lib/storageUrls'
import { changesChannel } from '../lib/realtimeChannel'
import { useAuth } from './useAuth'
import { notify } from '../lib/notifications'
import { describeMessageContent } from '../lib/stickers'
import { playMessageSound } from '../lib/sounds'
import { describeError } from '../lib/errors'
import { rateLimitError } from '../lib/rateLimit'
import { MESSAGE_PAGE_SIZE } from './useMessages'
import type { DMMessage, DMMessageAttachment } from '../types/database'

type AttachmentMap = Record<string, DMMessageAttachment[]>
const EMPTY_MESSAGES: DMMessage[] = []
const EMPTY_MAP: AttachmentMap = {}

function groupByMessage(rows: DMMessageAttachment[] | null | undefined): AttachmentMap {
  const map: AttachmentMap = {}
  for (const row of rows ?? []) (map[row.message_id] ??= []).push(row)
  return map
}

async function fetchAttachments(messageIds: string[]): Promise<AttachmentMap> {
  if (messageIds.length === 0) return {}
  const { data } = await supabase.from('dm_message_attachments').select('*').in('message_id', messageIds)
  return groupByMessage(data)
}

// Mesma estrutura do useMessages.ts (ver os comentários de lá): página
// mais RECENTE primeiro, "carregar mais antigas" sob demanda, proteção
// contra resposta atrasada de outra conversa e contra o `CLOSED` da
// própria limpeza disparar um refresh da conversa antiga.
export function useDirectMessages(conversationId: string | null) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<DMMessage[]>([])
  const [attachments, setAttachments] = useState<AttachmentMap>({})
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const messagesRef = useRef<DMMessage[]>([])
  messagesRef.current = messages
  const userIdRef = useRef(user?.id)
  userIdRef.current = user?.id
  const keyRef = useRef(conversationId)
  keyRef.current = conversationId
  const loadSeqRef = useRef(0)

  const load = useCallback(
    async (silent: boolean) => {
      const key = conversationId
      const seq = ++loadSeqRef.current
      if (!conversationId) {
        setMessages([])
        setAttachments({})
        setHasMore(false)
        setLoading(false)
        setLoadedKey(key)
        return
      }
      if (!silent) setLoading(true)
      try {
        const { data, error } = await supabase
          .from('dm_messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(MESSAGE_PAGE_SIZE)
        if (error) throw error
        const page = (data ?? []).reverse()
        const atts = await fetchAttachments(page.map((m) => m.id))
        if (key !== keyRef.current || seq !== loadSeqRef.current) return
        if (silent && page.length > 0) {
          const oldestNew = page[0].created_at
          setMessages((prev) => [...prev.filter((m) => m.created_at < oldestNew), ...page])
          setAttachments((prev) => ({ ...prev, ...atts }))
        } else {
          setMessages(page)
          setAttachments(atts)
          setHasMore(page.length === MESSAGE_PAGE_SIZE)
          setLoadedKey(key)
        }
        setLoadError(null)
      } catch (err) {
        if (key !== keyRef.current || seq !== loadSeqRef.current) return
        setLoadError(describeError(err, 'Não foi possível carregar as mensagens.'))
        if (!silent) setLoadedKey(key)
      } finally {
        if (key === keyRef.current && seq === loadSeqRef.current) setLoading(false)
      }
    },
    [conversationId]
  )

  useEffect(() => {
    setMessages([])
    setAttachments({})
    setHasMore(false)
    setLoadError(null)
    void load(false)
  }, [load])

  const loadingOlderRef = useRef(false)
  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current[0]
    if (!conversationId || !oldest || loadingOlderRef.current) return
    const key = conversationId
    loadingOlderRef.current = true
    setLoadingOlder(true)
    try {
      const { data, error } = await supabase
        .from('dm_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE)
      if (error) throw error
      const page = (data ?? []).reverse()
      const atts = await fetchAttachments(page.map((m) => m.id))
      if (key !== keyRef.current) return
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id))
        return [...page.filter((m) => !known.has(m.id)), ...prev]
      })
      setAttachments((prev) => ({ ...atts, ...prev }))
      setHasMore(page.length === MESSAGE_PAGE_SIZE)
    } catch (err) {
      if (key === keyRef.current) setLoadError(describeError(err, 'Não foi possível carregar mensagens antigas.'))
    } finally {
      loadingOlderRef.current = false
      if (key === keyRef.current) setLoadingOlder(false)
    }
  }, [conversationId])

  useEffect(() => {
    if (!conversationId) return
    let active = true
    let hadProblem = false

    const channel = changesChannel(`dm_messages:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const newMessage = payload.new as DMMessage
          setMessages((prev) => (prev.some((m) => m.id === newMessage.id) ? prev : [...prev, newMessage]))
          if (newMessage.author_id !== userIdRef.current) {
            notify('Nova mensagem direta', describeMessageContent(newMessage.content).slice(0, 120))
            if (document.hidden || !document.hasFocus()) playMessageSound()
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const updated = payload.new as DMMessage
          setMessages((prev) => (prev.some((m) => m.id === updated.id) ? prev.map((m) => (m.id === updated.id ? updated : m)) : prev))
        }
      )
      // Sem filtro de propósito — exclusões não podem ser filtradas por
      // coluna no Realtime (ver useMessages.ts).
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'dm_messages' }, (payload) => {
        const deletedId = (payload.old as { id?: string }).id
        if (!deletedId) return
        setMessages((prev) => (prev.some((m) => m.id === deletedId) ? prev.filter((m) => m.id !== deletedId) : prev))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_message_attachments' }, (payload) => {
        const att = payload.new as DMMessageAttachment
        if (!messagesRef.current.some((m) => m.id === att.message_id)) return
        setAttachments((prev) => {
          const list = prev[att.message_id] ?? []
          if (list.some((a) => a.id === att.id)) return prev
          return { ...prev, [att.message_id]: [...list, att] }
        })
      })
      .subscribe((status, err) => {
        if (!active) return
        if (status === 'SUBSCRIBED') {
          if (hadProblem) void load(true)
          hadProblem = false
          return
        }
        // Loga qualquer status que não seja "inscrito com sucesso" — sem
        // isso, uma falha de inscrição (tabela fora da publicação
        // supabase_realtime, erro de RLS) passava em silêncio.
        console.error('[useDirectMessages] Status da inscrição em tempo real:', status, err ?? '')
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          hadProblem = true
          void load(true)
        }
      })

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [conversationId, load])

  const sendMessage = useCallback(
    async (content: string, replyToId: string | null = null, files: File[] = []): Promise<{ error: string | null }> => {
      const userId = userIdRef.current
      if (!conversationId || !userId) return { error: 'Não foi possível enviar' }
      // DÉCIMA SÉTIMA RODADA: cooldown de UX (ver lib/rateLimit.ts) contra
      // flood acidental — por conversa, não global.
      const limited = rateLimitError(`message:dm:${conversationId}`, 8, 10_000, 'você está mandando mensagem')
      if (limited) return { error: limited }
      const key = conversationId
      try {
        const { data: message, error } = await supabase
          .from('dm_messages')
          .insert({
            conversation_id: conversationId,
            author_id: userId,
            content,
            reply_to_id: replyToId ?? undefined,
          })
          .select()
          .single()

        if (error || !message) return { error: describeError(error, 'Erro ao enviar mensagem') }

        if (key === keyRef.current) {
          setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]))
        }
        // Prévia da conversa na lista (HomeSidebar) na hora, sem esperar o Realtime.
        applyDmMessageToConversations(userId, message)

        const attachmentErrors: string[] = []
        const inserted: DMMessageAttachment[] = []
        for (const file of files) {
          const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_')
          const path = `${conversationId}/${message.id}-${safeName}`
          const { error: uploadError } = await supabase.storage
            .from('dm-attachments')
            .upload(path, file, { contentType: file.type || 'application/octet-stream' })
          if (uploadError) {
            attachmentErrors.push(describeError(uploadError, 'Falha ao subir o anexo'))
            continue
          }

          // Bucket privado (migration 017): grava só o CAMINHO dentro do
          // bucket; quem exibe gera uma URL assinada (useAttachmentUrl).
          const { data: att, error: attError } = await supabase
            .from('dm_message_attachments')
            .insert({
              message_id: message.id,
              file_url: path,
              file_name: file.name,
              file_size: file.size,
              mime_type: file.type || 'application/octet-stream',
            })
            .select()
            .single()
          if (attError) attachmentErrors.push(describeError(attError, 'Falha ao registrar o anexo'))
          else if (att) inserted.push(att)
        }

        if (inserted.length > 0 && key === keyRef.current) {
          setAttachments((prev) => {
            const list = prev[message.id] ?? []
            const known = new Set(list.map((a) => a.id))
            return { ...prev, [message.id]: [...list, ...inserted.filter((a) => !known.has(a.id))] }
          })
        }
        if (attachmentErrors.length > 0) {
          return { error: `Mensagem enviada, mas o anexo falhou: ${attachmentErrors[0]}` }
        }
        return { error: null }
      } catch (err) {
        return { error: describeError(err, 'Erro ao enviar mensagem') }
      }
    },
    [conversationId]
  )

  const editMessage = useCallback(async (messageId: string, content: string) => {
    try {
      const { data, error } = await supabase.from('dm_messages').update({ content }).eq('id', messageId).select().single()
      if (error) return { error: describeError(error, 'Não foi possível editar a mensagem') }
      if (data) setMessages((prev) => prev.map((m) => (m.id === messageId ? data : m)))
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível editar a mensagem') }
    }
  }, [])

  const deleteMessage = useCallback(async (messageId: string) => {
    try {
      // Anexos lidos ANTES de apagar (o delete da mensagem leva as
      // linhas de anexo junto, em cascata) — pra remover os arquivos do
      // Storage depois.
      const { data: attRows } = await supabase.from('dm_message_attachments').select('file_url').eq('message_id', messageId)
      const { error } = await supabase.from('dm_messages').delete().eq('id', messageId)
      if (error) return { error: describeError(error, 'Não foi possível excluir a mensagem') }
      setMessages((prev) => prev.filter((m) => m.id !== messageId))
      // Best-effort: não segura a UI nem transforma a exclusão em erro.
      if (attRows && attRows.length > 0) {
        void removeAttachmentObjects('dm-attachments', attRows.map((r) => r.file_url))
      }
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível excluir a mensagem') }
    }
  }, [])

  const isCurrent = loadedKey === conversationId
  return {
    messages: isCurrent ? messages : EMPTY_MESSAGES,
    attachments: isCurrent ? attachments : EMPTY_MAP,
    loading: loading || !isCurrent,
    loadingOlder,
    hasMore,
    loadError,
    loadOlder,
    sendMessage,
    editMessage,
    deleteMessage,
  }
}
