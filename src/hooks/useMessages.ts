import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { uniqueTopic } from '../lib/realtimeChannel'
import { useAuth } from './useAuth'
import { useChannelMutes } from './useChannelMutes'
import { notify } from '../lib/notifications'
import { describeError } from '../lib/errors'
import { rateLimitError } from '../lib/rateLimit'
import type { Message, MessageAttachment, MessageReaction } from '../types/database'

// Quantas mensagens buscar por "página" (carga inicial e cada "carregar
// mais antigas" ao rolar pro topo).
export const MESSAGE_PAGE_SIZE = 50

const EMPTY_MESSAGES: Message[] = []
const EMPTY_MAP: Record<string, never[]> = {}

type AttachmentMap = Record<string, MessageAttachment[]>
type ReactionMap = Record<string, MessageReaction[]>

function groupByMessage<T extends { message_id: string }>(rows: T[] | null | undefined): Record<string, T[]> {
  const map: Record<string, T[]> = {}
  for (const row of rows ?? []) (map[row.message_id] ??= []).push(row)
  return map
}

function sameReaction(a: MessageReaction, b: Pick<MessageReaction, 'message_id' | 'user_id' | 'emoji'>) {
  return a.message_id === b.message_id && a.user_id === b.user_id && a.emoji === b.emoji
}

// Cache em memória da última página vista de cada canal/thread. Voltar
// pra um canal que já foi aberto mostra as mensagens NA HORA (em vez do
// skeleton + 2 idas ao servidor: mensagens e depois anexos/reações) e
// revalida em silêncio por trás — o que mudou enquanto a pessoa estava
// em outro canal entra sem piscar a tela.
type CacheEntry = { messages: Message[]; attachments: AttachmentMap; reactions: ReactionMap; hasMore: boolean }
const MESSAGE_CACHE_LIMIT = 30
const messageCache = new Map<string, CacheEntry>()
function writeCache(key: string, entry: CacheEntry) {
  messageCache.delete(key)
  messageCache.set(key, entry)
  while (messageCache.size > MESSAGE_CACHE_LIMIT) {
    const oldest = messageCache.keys().next().value
    if (oldest === undefined) break
    messageCache.delete(oldest)
  }
}

const EMBEDDED_SELECT = '*, message_attachments(*), message_reactions(*)'
type EmbeddedMessage = Message & { message_attachments?: MessageAttachment[] | null; message_reactions?: MessageReaction[] | null }

/**
 * Busca uma página de mensagens JÁ com anexos e reações numa única
 * requisição. Se o embed falhar por qualquer motivo (ex.: relação não
 * exposta no cache de schema do PostgREST), cai no caminho antigo de
 * duas etapas — nunca fica sem mensagens por causa disso.
 */
async function fetchPageWithExtras(
  run: (embed: boolean) => PromiseLike<{ data: unknown[] | null; error: unknown }>
): Promise<{ page: Message[]; attachments: AttachmentMap; reactions: ReactionMap }> {
  const embedded = await run(true)
  if (!embedded.error) {
    const rows = ((embedded.data ?? []) as EmbeddedMessage[]).reverse()
    const attachments: AttachmentMap = {}
    const reactions: ReactionMap = {}
    const page = rows.map(({ message_attachments, message_reactions, ...m }) => {
      if (message_attachments?.length) attachments[m.id] = message_attachments
      if (message_reactions?.length) reactions[m.id] = message_reactions
      return m as Message
    })
    // Resposta sem as chaves embutidas (servidor ignorou o embed): busca à parte.
    if (rows.length > 0 && !('message_attachments' in rows[0])) {
      const extras = await fetchExtras(page.map((m) => m.id))
      return { page, ...extras }
    }
    return { page, attachments, reactions }
  }
  const plain = await run(false)
  if (plain.error) throw plain.error
  const page = ((plain.data ?? []) as Message[]).reverse()
  const extras = await fetchExtras(page.map((m) => m.id))
  return { page, ...extras }
}

async function fetchExtras(messageIds: string[]): Promise<{ attachments: AttachmentMap; reactions: ReactionMap }> {
  if (messageIds.length === 0) return { attachments: {}, reactions: {} }
  const [{ data: atts }, { data: reacts }] = await Promise.all([
    supabase.from('message_attachments').select('*').in('message_id', messageIds),
    supabase.from('message_reactions').select('*').in('message_id', messageIds),
  ])
  return { attachments: groupByMessage(atts), reactions: groupByMessage(reacts) }
}

export function useMessages(channelId: string | null, serverId: string | null, threadId: string | null = null) {
  const { user, profile } = useAuth()
  const { getLevel } = useChannelMutes()
  const [messages, setMessages] = useState<Message[]>([])
  const [attachments, setAttachments] = useState<AttachmentMap>({})
  const [reactions, setReactions] = useState<ReactionMap>({})
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Qual visão (canal/thread) o estado atual realmente representa — usado
  // pra nunca devolver, nem por um render, mensagens do canal ANTERIOR
  // logo depois de trocar de canal.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)

  const messagesRef = useRef<Message[]>([])
  messagesRef.current = messages
  const reactionsRef = useRef<ReactionMap>({})
  reactionsRef.current = reactions
  // Valores usados DENTRO dos callbacks do tempo real ficam em refs — antes
  // o efeito de assinatura capturava o `profile`/`getLevel` do momento em
  // que assinou e nunca mais via atualização (ex.: silenciar o canal não
  // parava as notificações até trocar de canal).
  const userIdRef = useRef(user?.id)
  userIdRef.current = user?.id
  const usernameRef = useRef(profile?.username)
  usernameRef.current = profile?.username
  const getLevelRef = useRef(getLevel)
  getLevelRef.current = getLevel

  // "Qual visão está ativa agora" — toda resposta de rede confere isso
  // antes de mexer no estado. Antes, trocar de canal rápido deixava a
  // resposta ATRASADA do canal anterior sobrescrever as mensagens do canal
  // novo (e o `CLOSED` disparado pela limpeza da assinatura antiga ainda
  // chamava um refresh do canal antigo).
  const viewKey = `${channelId ?? ''}|${threadId ?? ''}`
  const viewKeyRef = useRef(viewKey)
  viewKeyRef.current = viewKey
  const loadSeqRef = useRef(0)

  const buildQuery = useCallback((embedExtras = false) => {
    // Com embedExtras, anexos e reações vêm JUNTO na mesma resposta
    // (relação por chave estrangeira no PostgREST) — uma ida ao servidor
    // a menos ao abrir um canal.
    const base = supabase.from('messages').select(embedExtras ? EMBEDDED_SELECT : '*')
    // Mensagens de dentro de uma thread ficam separadas das mensagens
    // "normais" do canal — sem esse filtro, elas apareceriam
    // duplicadas na visão principal do canal.
    return threadId ? base.eq('thread_id', threadId) : base.eq('channel_id', channelId ?? '').is('thread_id', null)
  }, [channelId, threadId])

  // Busca a página MAIS RECENTE. Antes a busca era `ascending: true` +
  // `limit(100)`, o que trazia as 100 mensagens MAIS ANTIGAS do canal — em
  // qualquer canal com mais de 100 mensagens, as recentes simplesmente não
  // apareciam ao abrir.
  // `silent` = ressincronização (reconexão do tempo real): não mostra
  // skeleton e preserva as páginas antigas já carregadas.
  const load = useCallback(
    async (silent: boolean) => {
      const key = viewKey
      const seq = ++loadSeqRef.current
      if (!channelId) {
        setMessages([])
        setAttachments({})
        setReactions({})
        setHasMore(false)
        setLoading(false)
        setLoadedKey(key)
        return
      }
      if (!silent) setLoading(true)
      try {
        const { page, ...extras } = await fetchPageWithExtras((embed) =>
          buildQuery(embed).order('created_at', { ascending: false }).limit(MESSAGE_PAGE_SIZE)
        )
        if (key !== viewKeyRef.current || seq !== loadSeqRef.current) return

        if (silent && page.length > 0) {
          const oldestNew = page[0].created_at
          setMessages((prev) => [...prev.filter((m) => m.created_at < oldestNew), ...page])
          setAttachments((prev) => ({ ...prev, ...extras.attachments }))
          setReactions((prev) => {
            const next = { ...prev, ...extras.reactions }
            // mensagens da página que ficaram SEM reação precisam ser limpas
            for (const m of page) if (!extras.reactions[m.id]) delete next[m.id]
            return next
          })
        } else {
          setMessages(page)
          setAttachments(extras.attachments)
          setReactions(extras.reactions)
          setHasMore(page.length === MESSAGE_PAGE_SIZE)
          setLoadedKey(key)
        }
        setLoadError(null)
      } catch (err) {
        if (key !== viewKeyRef.current || seq !== loadSeqRef.current) return
        setLoadError(describeError(err, 'Não foi possível carregar as mensagens.'))
        if (!silent) setLoadedKey(key)
      } finally {
        if (key === viewKeyRef.current && seq === loadSeqRef.current) setLoading(false)
      }
    },
    [viewKey, channelId, buildQuery]
  )

  const cacheKey = channelId ? `${user?.id ?? ''}|${viewKey}` : null
  const cacheKeyRef = useRef(cacheKey)
  cacheKeyRef.current = cacheKey

  // Troca de canal/thread: limpa na hora (sem mostrar as mensagens do canal
  // anterior enquanto o novo carrega) e busca a página mais recente — ou,
  // se esse canal já foi aberto antes, mostra o que estava em cache e só
  // revalida em segundo plano.
  useEffect(() => {
    const cached = cacheKeyRef.current ? messageCache.get(cacheKeyRef.current) : undefined
    setLoadError(null)
    if (cached) {
      setMessages(cached.messages)
      setAttachments(cached.attachments)
      setReactions(cached.reactions)
      setHasMore(cached.hasMore)
      setLoading(false)
      setLoadedKey(viewKeyRef.current)
      void load(true)
      return
    }
    setMessages([])
    setAttachments({})
    setReactions({})
    setHasMore(false)
    void load(false)
  }, [load])

  // Mantém o cache em dia com o que está na tela (inclui o que chegou em
  // tempo real, reações, páginas antigas carregadas etc.).
  useEffect(() => {
    if (!cacheKey || loadedKey !== viewKey || loading) return
    writeCache(cacheKey, { messages, attachments, reactions, hasMore })
  }, [cacheKey, loadedKey, viewKey, loading, messages, attachments, reactions, hasMore])

  const refresh = useCallback(() => load(false), [load])

  // Rolagem infinita pra cima: busca a página anterior à mensagem mais
  // antiga já carregada.
  const loadingOlderRef = useRef(false)
  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current[0]
    if (!channelId || !oldest || loadingOlderRef.current) return
    const key = viewKey
    loadingOlderRef.current = true
    setLoadingOlder(true)
    try {
      const { page, ...extras } = await fetchPageWithExtras((embed) =>
        buildQuery(embed).lt('created_at', oldest.created_at).order('created_at', { ascending: false }).limit(MESSAGE_PAGE_SIZE)
      )
      if (key !== viewKeyRef.current) return
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id))
        return [...page.filter((m) => !known.has(m.id)), ...prev]
      })
      setAttachments((prev) => ({ ...extras.attachments, ...prev }))
      setReactions((prev) => ({ ...extras.reactions, ...prev }))
      setHasMore(page.length === MESSAGE_PAGE_SIZE)
    } catch (err) {
      if (key === viewKeyRef.current) setLoadError(describeError(err, 'Não foi possível carregar mensagens antigas.'))
    } finally {
      loadingOlderRef.current = false
      if (key === viewKeyRef.current) setLoadingOlder(false)
    }
  }, [channelId, viewKey, buildQuery])

  // Realtime: novas mensagens, edições e exclusões neste canal (ou
  // nesta thread específica, se threadId estiver definido)
  useEffect(() => {
    if (!channelId) return
    let active = true
    let hadProblem = false
    const belongsHere = (m: Message) => m.channel_id === channelId && (threadId ? m.thread_id === threadId : m.thread_id === null)
    const isLoaded = (messageId: string) => messagesRef.current.some((m) => m.id === messageId)

    const channel = supabase
      // Nome único por montagem: `supabase.channel(nome)` devolve um canal
      // já existente com o mesmo nome (ver lib/realtimeChannel.ts).
      .channel(uniqueTopic(`messages:${channelId}${threadId ? `:${threadId}` : ''}`))
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const newMessage = payload.new as Message
          // Só aceita a mensagem se ela pertence à mesma "visão" que
          // esse hook está mostrando — canal principal (sem thread) ou
          // a thread específica que foi pedida.
          if (!belongsHere(newMessage)) return
          setMessages((prev) => (prev.some((m) => m.id === newMessage.id) ? prev : [...prev, newMessage]))
          if (newMessage.author_id !== userIdRef.current) {
            const level = getLevelRef.current(newMessage.channel_id)
            const username = usernameRef.current
            const mentionsMe =
              level === 'mentions' && username
                ? new RegExp(`@(everyone|here|${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i').test(newMessage.content)
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
      // DELETE sem filtro de propósito: o Supabase Realtime NÃO consegue
      // filtrar eventos de exclusão por coluna (a linha antiga só traz a
      // chave primária, a tabela não usa REPLICA IDENTITY FULL). Com o
      // filtro `channel_id=eq.X`, exclusões feitas por OUTRA pessoa nunca
      // chegavam — a mensagem só sumia depois de recarregar.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
        const deletedId = (payload.old as { id?: string }).id
        if (!deletedId) return
        setMessages((prev) => (prev.some((m) => m.id === deletedId) ? prev.filter((m) => m.id !== deletedId) : prev))
      })
      // Reações: antes QUALQUER reação em QUALQUER canal disparava uma nova
      // busca de todos os anexos + reações de todas as mensagens carregadas.
      // Agora aplica só a mudança recebida, direto no estado local.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, (payload) => {
        const row = payload.new as MessageReaction
        if (!isLoaded(row.message_id)) return
        setReactions((prev) => {
          const list = prev[row.message_id] ?? []
          if (list.some((r) => sameReaction(r, row))) return prev
          return { ...prev, [row.message_id]: [...list, row] }
        })
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, (payload) => {
        const row = payload.old as Partial<MessageReaction>
        if (!row.message_id || !row.user_id || !row.emoji) return
        const target = row as MessageReaction
        setReactions((prev) => {
          const list = prev[target.message_id]
          if (!list || !list.some((r) => sameReaction(r, target))) return prev
          return { ...prev, [target.message_id]: list.filter((r) => !sameReaction(r, target)) }
        })
      })
      // Sem isso, um anexo (imagem, áudio, arquivo) só aparecia pra
      // quem enviou — quem já estava com o canal aberto só via o anexo
      // depois de trocar de canal ou recarregar a página.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_attachments' }, (payload) => {
        const att = payload.new as MessageAttachment
        if (!isLoaded(att.message_id)) return
        setAttachments((prev) => {
          const list = prev[att.message_id] ?? []
          if (list.some((a) => a.id === att.id)) return prev
          return { ...prev, [att.message_id]: [...list, att] }
        })
      })
      .subscribe((status, err) => {
        // `CLOSED` também é disparado pela PRÓPRIA limpeza do efeito
        // (removeChannel ao trocar de canal) — sem esse `active`, isso
        // chamava um refresh do canal ANTIGO por cima do canal novo.
        if (!active) return
        if (status === 'SUBSCRIBED') {
          // Voltou depois de uma queda: busca o que chegou enquanto a
          // conexão estava fora, sem piscar a tela.
          if (hadProblem) void load(true)
          hadProblem = false
          return
        }
        console.error('[useMessages] Status da inscrição em tempo real:', status, err ?? '')
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          hadProblem = true
          void load(true)
        }
      })

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [channelId, threadId, load])

  // Antes, se qualquer chamada aqui dentro lançasse uma exceção (em vez
  // de resolver normalmente com { error }), a promise de sendMessage()
  // quebrava sem passar pelo `return { error ... }` e o composer ficava
  // esperando pra sempre. O try/catch garante que sempre volta uma
  // resposta, com o motivo real do problema.
  const sendMessage = useCallback(
    async (content: string, replyToId: string | null, files: File[] = []): Promise<{ error: string | null }> => {
      const userId = userIdRef.current
      if (!channelId || !serverId || !userId) return { error: 'Não foi possível enviar a mensagem' }
      // DÉCIMA SÉTIMA RODADA: cooldown de UX (ver lib/rateLimit.ts) contra
      // flood acidental — por CANAL, não global.
      const limited = rateLimitError(`message:channel:${channelId}`, 8, 10_000, 'você está mandando mensagem')
      if (limited) return { error: limited }
      const key = viewKey

      try {
        const { data: message, error } = await supabase
          .from('messages')
          .insert({
            channel_id: channelId,
            server_id: serverId,
            author_id: userId,
            content,
            reply_to_id: replyToId ?? undefined,
            thread_id: threadId ?? undefined,
          })
          .select()
          .single()

        if (error || !message) return { error: describeError(error, 'Erro ao enviar mensagem') }

        // Mostra a mensagem na hora, sem esperar ela "voltar" pelo canal de
        // tempo real.
        if (key === viewKeyRef.current) {
          setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]))
        }

        const attachmentErrors: string[] = []
        const inserted: MessageAttachment[] = []
        for (const file of files) {
          const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_')
          const path = `${serverId}/${channelId}/${message.id}-${safeName}`
          const { error: uploadError } = await supabase.storage
            .from('attachments')
            .upload(path, file, { contentType: file.type || 'application/octet-stream' })
          if (uploadError) {
            attachmentErrors.push(describeError(uploadError, 'Falha ao subir o anexo'))
            continue
          }

          const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(path)
          const { data: att, error: attError } = await supabase
            .from('message_attachments')
            .insert({
              message_id: message.id,
              file_url: urlData.publicUrl,
              file_name: file.name,
              file_size: file.size,
              mime_type: file.type || 'application/octet-stream',
            })
            .select()
            .single()
          if (attError) attachmentErrors.push(describeError(attError, 'Falha ao registrar o anexo'))
          else if (att) inserted.push(att)
        }

        // Só os anexos DESTA mensagem entram no estado — antes isso buscava
        // de novo os anexos + reações de todas as mensagens carregadas.
        if (inserted.length > 0 && key === viewKeyRef.current) {
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
    [channelId, serverId, threadId, viewKey]
  )

  const editMessage = useCallback(async (messageId: string, content: string) => {
    try {
      const { data, error } = await supabase.from('messages').update({ content }).eq('id', messageId).select().single()
      if (error) return { error: describeError(error, 'Não foi possível editar a mensagem') }
      if (data) setMessages((prev) => prev.map((m) => (m.id === messageId ? data : m)))
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível editar a mensagem') }
    }
  }, [])

  const deleteMessage = useCallback(async (messageId: string) => {
    try {
      const { error } = await supabase.from('messages').delete().eq('id', messageId)
      if (error) return { error: describeError(error, 'Não foi possível excluir a mensagem') }
      setMessages((prev) => prev.filter((m) => m.id !== messageId))
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível excluir a mensagem') }
    }
  }, [])

  const pinMessage = useCallback(async (messageId: string) => {
    const userId = userIdRef.current
    if (!userId) return { error: 'Não autenticado' }
    try {
      const { data, error } = await supabase
        .from('messages')
        .update({ pinned_at: new Date().toISOString(), pinned_by: userId })
        .eq('id', messageId)
        .select()
        .single()
      if (error) return { error: describeError(error, 'Não foi possível fixar a mensagem') }
      if (data) setMessages((prev) => prev.map((m) => (m.id === messageId ? data : m)))
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível fixar a mensagem') }
    }
  }, [])

  const unpinMessage = useCallback(async (messageId: string) => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .update({ pinned_at: null, pinned_by: null })
        .eq('id', messageId)
        .select()
        .single()
      if (error) return { error: describeError(error, 'Não foi possível desafixar a mensagem') }
      if (data) setMessages((prev) => prev.map((m) => (m.id === messageId ? data : m)))
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível desafixar a mensagem') }
    }
  }, [])

  // Busca as fixadas de verdade em vez de depender das mensagens já
  // carregadas na tela — uma mensagem fixada pode ter sido enviada há
  // muito tempo, fora da janela recente que normalmente é exibida.
  const fetchPinnedMessages = useCallback(async (): Promise<Message[]> => {
    if (!channelId) return []
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('channel_id', channelId)
      .not('pinned_at', 'is', null)
      .order('pinned_at', { ascending: false })
      .limit(100)
    if (error) throw error
    return (data as Message[] | null) ?? []
  }, [channelId])

  // Otimista com rollback: a reação aparece/some na hora e, se o banco
  // recusar, volta ao estado anterior. Antes cada clique esperava o banco
  // E depois buscava de novo anexos + reações de TODAS as mensagens.
  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    const userId = userIdRef.current
    if (!userId) return
    const target = { message_id: messageId, user_id: userId, emoji }
    const existing = reactionsRef.current[messageId]?.find((r) => sameReaction(r, target))

    const removeLocal = () =>
      setReactions((prev) => ({ ...prev, [messageId]: (prev[messageId] ?? []).filter((r) => !sameReaction(r, target)) }))
    const addLocal = (row: MessageReaction) =>
      setReactions((prev) => {
        const list = prev[messageId] ?? []
        return list.some((r) => sameReaction(r, row)) ? prev : { ...prev, [messageId]: [...list, row] }
      })

    try {
      if (existing) {
        removeLocal()
        const { error } = await supabase
          .from('message_reactions')
          .delete()
          .eq('message_id', messageId)
          .eq('user_id', userId)
          .eq('emoji', emoji)
        if (error) addLocal(existing)
      } else {
        const optimistic: MessageReaction = { ...target, created_at: new Date().toISOString() }
        addLocal(optimistic)
        const { error } = await supabase.from('message_reactions').insert(target)
        if (error) removeLocal()
      }
    } catch {
      if (existing) addLocal(existing)
      else removeLocal()
    }
  }, [])

  const isCurrent = loadedKey === viewKey
  // No PRIMEIRO render depois de trocar de canal (antes do efeito acima
  // rodar), já devolve o cache — sem um frame de skeleton no meio.
  const cachedView = !isCurrent && cacheKey ? messageCache.get(cacheKey) : undefined
  return {
    messages: isCurrent ? messages : cachedView?.messages ?? EMPTY_MESSAGES,
    attachments: isCurrent ? attachments : cachedView?.attachments ?? EMPTY_MAP,
    reactions: isCurrent ? reactions : cachedView?.reactions ?? EMPTY_MAP,
    loading: isCurrent ? loading : !cachedView,
    loadingOlder,
    hasMore: isCurrent ? hasMore : cachedView?.hasMore ?? false,
    loadError,
    refresh,
    loadOlder,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    pinMessage,
    unpinMessage,
    fetchPinnedMessages,
  }
}
