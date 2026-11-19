import { useCallback, useSyncExternalStore } from 'react'
import { emitIncomingMessage } from '../lib/messageAlerts'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { changesChannel } from '../lib/realtimeChannel'
import { useAuth } from './useAuth'
import type { DMConversation, DMMessage, Profile } from '../types/database'

export type ConversationWithDetails = DMConversation & {
  otherProfile: Profile
  lastMessage: DMMessage | null
}

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

function applyMessage(userId: string, entry: Entry, message: DMMessage) {
  const list = entry.snapshot.conversations
  const idx = list.findIndex((c) => c.id === message.conversation_id)
  if (idx === -1) {
    scheduleReload(userId, entry)
    return
  }
  const current = list[idx]
  if (current.lastMessage && current.lastMessage.created_at > message.created_at) return
  const updated = { ...current, lastMessage: message }
  const rest = list.filter((_, i) => i !== idx)
  emit(entry, { ...entry.snapshot, conversations: [updated, ...rest] })
}

export function applyDmMessageToConversations(userId: string, message: DMMessage) {
  const entry = store.get(userId)
  if (entry) applyMessage(userId, entry, message)
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
    const reload = () => scheduleReload(userId, entry)
    let hadProblem = false
    const channel = changesChannel(`dm_conversations:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_conversations', filter: `user_a=eq.${userId}` }, reload)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_conversations', filter: `user_b=eq.${userId}` }, reload)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dm_conversations', filter: `user_a=eq.${userId}` }, reload)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dm_conversations', filter: `user_b=eq.${userId}` }, reload)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, (payload) => {
        const message = payload.new as DMMessage | undefined
        if (!message?.conversation_id) return
        applyMessage(userId, entry, message)
        emitIncomingMessage({
          kind: 'dm',
          targetId: message.conversation_id,
          messageId: message.id,
          authorId: message.author_id,
          content: message.content,
        })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dm_messages' }, (payload) => {
        const message = payload.new as DMMessage | undefined
        if (message && entry.snapshot.conversations.some((c) => c.lastMessage?.id === message.id)) reload()
      })
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
