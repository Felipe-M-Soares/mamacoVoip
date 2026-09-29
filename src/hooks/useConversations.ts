import { useCallback, useSyncExternalStore } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { uniqueTopic } from '../lib/realtimeChannel'
import { useAuth } from './useAuth'
import type { DMConversation, DMMessage, Profile } from '../types/database'

export type ConversationWithDetails = DMConversation & {
  otherProfile: Profile
  lastMessage: DMMessage | null
}

// Estado COMPARTILHADO por usuário. Esse hook é chamado ao mesmo tempo
// por vários componentes (MainLayout, HomeSidebar, FriendsPanel — duas
// vezes —, UserProfileModal, InviteFriendsModal…) e antes cada chamada
// fazia a busca inteira E abria a sua própria assinatura de tempo real.
// Pior: a busca era N+1 — uma consulta de "última mensagem" POR conversa.
// Com 30 conversas e 4 componentes montados, abrir a tela inicial
// disparava ~130 requisições. Agora: uma entrada por usuário, uma
// assinatura, e a última mensagem de todas as conversas vem numa consulta
// só (com fallback individual só pras poucas que não couberem nela).

interface Snapshot {
  conversations: ConversationWithDetails[]
  loading: boolean
}

interface Entry {
  snapshot: Snapshot
  listeners: Set<() => void>
  channel: RealtimeChannel | null
  loadSeq: number
  releaseTimer: ReturnType<typeof setTimeout> | null
  reloadTimer: ReturnType<typeof setTimeout> | null
}

const RELEASE_DELAY_MS = 30_000
const BULK_LAST_MESSAGES_LIMIT = 500
const EMPTY_SNAPSHOT: Snapshot = { conversations: [], loading: false }
const store = new Map<string, Entry>()

function emit(entry: Entry, next: Snapshot) {
  entry.snapshot = next
  entry.listeners.forEach((l) => l())
}

function scheduleRelease(userId: string, entry: Entry) {
  if (entry.releaseTimer) clearTimeout(entry.releaseTimer)
  entry.releaseTimer = setTimeout(() => {
    if (entry.listeners.size > 0) return
    if (entry.channel) void supabase.removeChannel(entry.channel)
    if (entry.reloadTimer) clearTimeout(entry.reloadTimer)
    entry.channel = null
    store.delete(userId)
  }, RELEASE_DELAY_MS)
}

function getEntry(userId: string): Entry {
  let entry = store.get(userId)
  if (!entry) {
    entry = {
      snapshot: { conversations: [], loading: true },
      listeners: new Set(),
      channel: null,
      loadSeq: 0,
      releaseTimer: null,
      reloadTimer: null,
    }
    store.set(userId, entry)
    scheduleRelease(userId, entry)
  }
  return entry
}

async function load(userId: string) {
  const entry = store.get(userId)
  if (!entry) return
  const seq = ++entry.loadSeq
  try {
    // Só traz conversas que a pessoa NÃO apagou do próprio lado (ver
    // hideConversation abaixo e 003_social_FIX_dm_delete.sql) — apagar
    // uma conversa só esconde ela pra quem apagou, então o filtro
    // precisa considerar de que lado (user_a ou user_b) essa pessoa está.
    const { data: convos, error } = await supabase
      .from('dm_conversations')
      .select('*')
      .or(`and(user_a.eq.${userId},hidden_for_a.eq.false),and(user_b.eq.${userId},hidden_for_b.eq.false)`)
    if (error) throw error

    let result: ConversationWithDetails[] = []
    if (convos && convos.length > 0) {
      const otherIds = convos.map((c) => (c.user_a === userId ? c.user_b : c.user_a))
      const convoIds = convos.map((c) => c.id)
      const [{ data: profiles }, { data: recent }] = await Promise.all([
        supabase.from('profiles').select('*').in('id', otherIds),
        supabase
          .from('dm_messages')
          .select('*')
          .in('conversation_id', convoIds)
          .order('created_at', { ascending: false })
          .limit(BULK_LAST_MESSAGES_LIMIT),
      ])
      const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))
      const lastByConvo = new Map<string, DMMessage>()
      for (const m of recent ?? []) if (!lastByConvo.has(m.conversation_id)) lastByConvo.set(m.conversation_id, m)

      // Conversas antigas que não couberam na consulta em lote (só quando
      // o lote veio cheio — senão a ausência significa "sem mensagens").
      if ((recent?.length ?? 0) >= BULK_LAST_MESSAGES_LIMIT) {
        const missing = convoIds.filter((id) => !lastByConvo.has(id))
        await Promise.all(
          missing.map(async (id) => {
            const { data } = await supabase
              .from('dm_messages')
              .select('*')
              .eq('conversation_id', id)
              .order('created_at', { ascending: false })
              .limit(1)
            if (data?.[0]) lastByConvo.set(id, data[0])
          })
        )
      }

      result = convos.flatMap((c) => {
        const otherProfile = profileById.get(c.user_a === userId ? c.user_b : c.user_a)
        return otherProfile ? [{ ...c, otherProfile, lastMessage: lastByConvo.get(c.id) ?? null }] : []
      })
      // created_at é ISO — comparação de string já ordena certo, sem
      // criar dois Date por comparação.
      result.sort((a, b) => {
        const aTime = a.lastMessage?.created_at ?? a.created_at
        const bTime = b.lastMessage?.created_at ?? b.created_at
        return aTime < bTime ? 1 : aTime > bTime ? -1 : 0
      })
    }
    if (store.get(userId) !== entry || seq !== entry.loadSeq) return
    emit(entry, { conversations: result, loading: false })
  } catch (err) {
    console.error('[useConversations] Falha ao carregar conversas:', err)
    if (store.get(userId) === entry && seq === entry.loadSeq) emit(entry, { ...entry.snapshot, loading: false })
  }
}

function scheduleReload(userId: string, entry: Entry) {
  if (entry.reloadTimer) clearTimeout(entry.reloadTimer)
  entry.reloadTimer = setTimeout(() => {
    entry.reloadTimer = null
    void load(userId)
  }, 250)
}

function subscribe(userId: string, listener: () => void): () => void {
  const entry = getEntry(userId)
  entry.listeners.add(listener)
  if (entry.releaseTimer) {
    clearTimeout(entry.releaseTimer)
    entry.releaseTimer = null
  }

  if (!entry.channel) {
    void load(userId)
    // Sem isso, uma conversa nova (a PRIMEIRA mensagem que alguém te manda)
    // só aparecia pra quem recebeu depois de recarregar o app. O filtro do
    // Realtime só aceita uma comparação por vez, e a pessoa pode estar em
    // "user_a" ou "user_b" — por isso duas inscrições. UPDATE também
    // importa: é assim que uma conversa apagada "reaparece" quando a outra
    // pessoa manda mensagem de novo (gatilho on_dm_message_unhide_conversation).
    const reload = () => scheduleReload(userId, entry)
    let hadProblem = false
    const channel = supabase
      .channel(uniqueTopic(`dm_conversations:${userId}`))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_conversations', filter: `user_a=eq.${userId}` }, reload)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_conversations', filter: `user_b=eq.${userId}` }, reload)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dm_conversations', filter: `user_a=eq.${userId}` }, reload)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dm_conversations', filter: `user_b=eq.${userId}` }, reload)
      .subscribe((status, err) => {
        if (entry.channel !== channel) return
        if (status === 'SUBSCRIBED') {
          if (hadProblem) reload()
          hadProblem = false
          return
        }
        console.error('[useConversations] Status da inscrição em tempo real:', status, err ?? '')
        hadProblem = true
      })
    entry.channel = channel
  }

  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0) scheduleRelease(userId, entry)
  }
}

export function useConversations() {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const subscribeFn = useCallback((listener: () => void) => (userId ? subscribe(userId, listener) : () => {}), [userId])
  const getSnapshot = useCallback(() => (userId ? getEntry(userId).snapshot : EMPTY_SNAPSHOT), [userId])
  const snapshot = useSyncExternalStore(subscribeFn, getSnapshot, getSnapshot)

  const refresh = useCallback(async () => {
    if (!userId) return
    getEntry(userId)
    await load(userId)
  }, [userId])

  const openConversationWith = useCallback(
    async (otherUserId: string) => {
      const { data, error } = await supabase.rpc('get_or_create_dm', { p_other_user_id: otherUserId })
      if (!error) await refresh()
      return { error: error?.message ?? null, conversation: data ?? undefined }
    },
    [refresh]
  )

  // "Apaga" a conversa só da SUA lista (a outra pessoa continua vendo
  // normalmente) — ver o comentário grande em
  // 003_social_FIX_dm_delete.sql pro porquê de não ser um delete de
  // verdade. Se a outra pessoa mandar mensagem de novo depois, a
  // conversa reaparece sozinha.
  const hideConversation = useCallback(
    async (conversationId: string) => {
      const { error } = await supabase.rpc('hide_dm_conversation', { p_conversation_id: conversationId })
      if (!error) await refresh()
      return { error: error?.message ?? null }
    },
    [refresh]
  )

  return { conversations: snapshot.conversations, loading: snapshot.loading, refresh, openConversationWith, hideConversation }
}
