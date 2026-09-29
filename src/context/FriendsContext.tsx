import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { notify } from '../lib/notifications'
import { rateLimitError } from '../lib/rateLimit'
import { uniqueTopic } from '../lib/realtimeChannel'
import type { BlockedUser, Friendship, Profile } from '../types/database'

export type FriendshipWithProfile = Friendship & { profile: Profile }
export type BlockedWithProfile = BlockedUser & { profile: Profile }

interface FriendsContextValue {
  friends: FriendshipWithProfile[]
  incoming: FriendshipWithProfile[]
  outgoing: FriendshipWithProfile[]
  blocked: BlockedWithProfile[]
  loading: boolean
  sendRequest: (username: string, note?: string) => Promise<{ error: string | null }>
  acceptRequest: (requestId: string) => Promise<{ error: string | null }>
  declineRequest: (requestId: string) => Promise<{ error: string | null }>
  removeFriend: (otherUserId: string) => Promise<{ error: string | null }>
  blockUser: (otherUserId: string) => Promise<{ error: string | null }>
  unblockUser: (otherUserId: string) => Promise<{ error: string | null }>
}

const FriendsContext = createContext<FriendsContextValue | undefined>(undefined)

// Amigos/bloqueios são usados em vários lugares do app ao mesmo tempo
// (barra de amigos, perfil de usuário, menu da call, etc.) — antes,
// cada lugar chamava seu próprio hook, criando uma conexão de tempo
// real DUPLICADA pra cada um (6 lugares = 6 conexões fazendo a mesma
// coisa). Agora é um Provider só, no topo do app, e todo mundo
// compartilha o mesmo dado — uma conexão só.
export function FriendsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  // Depende só do ID (string estável): o objeto `user` muda de identidade
  // a cada renovação do token (~1h), o que antes recriava a assinatura do
  // tempo real e refazia todas as buscas sem necessidade.
  const userId = user?.id ?? null
  const loadSeqRef = useRef(0)
  const hasLoadedRef = useRef(false)
  const [friends, setFriends] = useState<FriendshipWithProfile[]>([])
  const [incoming, setIncoming] = useState<FriendshipWithProfile[]>([])
  const [outgoing, setOutgoing] = useState<FriendshipWithProfile[]>([])
  const [blocked, setBlocked] = useState<BlockedWithProfile[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const seq = ++loadSeqRef.current
    if (!userId) {
      setFriends([])
      setIncoming([])
      setOutgoing([])
      setBlocked([])
      setLoading(false)
      hasLoadedRef.current = false
      return
    }
    // Spinner só na PRIMEIRA carga — antes todo evento do tempo real
    // (qualquer pedido de amizade) fazia a lista de amigos piscar.
    if (!hasLoadedRef.current) setLoading(true)

    try {
      const [{ data: asUser }, { data: asFriend }, { data: blockedRows }] = await Promise.all([
        supabase.from('friendships').select('*').eq('user_id', userId),
        supabase.from('friendships').select('*').eq('friend_id', userId),
        supabase.from('blocked_users').select('*').eq('blocker_id', userId),
      ])

      const allFriendships = [...(asUser ?? []), ...(asFriend ?? [])]
      const otherIds = new Set<string>()
      allFriendships.forEach((f) => otherIds.add(f.user_id === userId ? f.friend_id : f.user_id))
      ;(blockedRows ?? []).forEach((b) => otherIds.add(b.blocked_id))

      const { data: profiles } =
        otherIds.size > 0
          ? await supabase.from('profiles').select('*').in('id', Array.from(otherIds))
          : { data: [] as Profile[] }

      // Uma resposta mais nova já chegou (ou trocou de conta) — descarta.
      if (seq !== loadSeqRef.current) return

      const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))

      const withProfile = (f: Friendship): FriendshipWithProfile | null => {
      const otherId = f.user_id === userId ? f.friend_id : f.user_id
      const profile = profileById.get(otherId)
      return profile ? { ...f, profile } : null
    }

    setFriends(
      allFriendships.filter((f) => f.status === 'accepted').map(withProfile).filter((f): f is FriendshipWithProfile => f !== null)
    )
    setIncoming(
      (asFriend ?? [])
        .filter((f) => f.status === 'pending')
        .map(withProfile)
        .filter((f): f is FriendshipWithProfile => f !== null)
    )
    setOutgoing(
      (asUser ?? [])
        .filter((f) => f.status === 'pending')
        .map(withProfile)
        .filter((f): f is FriendshipWithProfile => f !== null)
    )
    setBlocked(
      (blockedRows ?? [])
        .map((b) => {
          const profile = profileById.get(b.blocked_id)
          return profile ? { ...b, profile } : null
        })
        .filter((b): b is BlockedWithProfile => b !== null)
    )
      hasLoadedRef.current = true
    } catch (err) {
      console.error('[FriendsContext] Falha ao carregar amigos:', err)
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [userId])

  // Ids das amizades conhecidas — pra decidir se um DELETE (que não pode
  // ser filtrado no Realtime) é nosso.
  const knownFriendshipIdsRef = useRef<Set<string>>(new Set())
  knownFriendshipIdsRef.current = new Set([...friends, ...incoming, ...outgoing].map((f) => f.id))

  useEffect(() => {
    refresh()
  }, [refresh])

  // Realtime: pedidos de amizade chegando/sendo aceitos
  // Antes assinava a tabela `friendships` INTEIRA, sem filtro: toda
  // amizade desfeita por QUALQUER pessoa do app (DELETE não passa por RLS
  // no Realtime) fazia todo cliente online refazer 4 consultas. Agora:
  // INSERT/UPDATE filtrados pelas duas colunas que me envolvem, e DELETE
  // (que não aceita filtro) só recarrega se for uma amizade que eu conheço.
  useEffect(() => {
    if (!userId) return
    let active = true
    const onChange = (payload: { eventType: string; new: unknown }) => {
      const row = payload.new as { friend_id?: string; status?: string } | null
      if (payload.eventType === 'INSERT' && row?.friend_id === userId && row?.status === 'pending') {
        notify('Pedido de amizade', 'Alguém quer ser seu amigo no Mamacos Voip')
      }
      void refresh()
    }
    const channel = supabase
      .channel(uniqueTopic(`friendships:${userId}`))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friendships', filter: `friend_id=eq.${userId}` }, onChange)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friendships', filter: `user_id=eq.${userId}` }, onChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'friendships', filter: `friend_id=eq.${userId}` }, onChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'friendships', filter: `user_id=eq.${userId}` }, onChange)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'friendships' }, (payload) => {
        const id = (payload.old as { id?: string }).id
        if (id && knownFriendshipIdsRef.current.has(id)) void refresh()
      })
      .subscribe((status) => {
        if (!active) return
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') void refresh()
      })
    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [userId, refresh])

  // Ações estáveis (useCallback) + valor do contexto memoizado: antes o
  // objeto `value` era recriado a cada render do provider, re-renderizando
  // TODO consumidor de useFriends() no app inteiro sem necessidade.
  const sendRequest = useCallback(async (username: string, note?: string) => {
    // DÉCIMA SÉTIMA RODADA: cooldown de UX (ver lib/rateLimit.ts) contra
    // flood acidental — bem mais apertado que o de mensagem, já que
    // mandar pedido de amizade é algo raro de fazer repetidamente rápido.
    const limited = rateLimitError(`friend-request:${userId ?? 'anon'}`, 5, 60_000, 'você está mandando pedido de amizade')
    if (limited) return { error: limited }
    const { error } = await supabase.rpc('send_friend_request', { p_username: username, p_note: note ?? null })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }, [userId, refresh])

  const acceptRequest = useCallback(async (requestId: string) => {
    const { error } = await supabase.rpc('respond_friend_request', { p_request_id: requestId, p_accept: true })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }, [refresh])

  const declineRequest = useCallback(async (requestId: string) => {
    const { error } = await supabase.rpc('respond_friend_request', { p_request_id: requestId, p_accept: false })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }, [refresh])

  const removeFriend = useCallback(async (otherUserId: string) => {
    const { error } = await supabase.rpc('remove_friend', { p_other_user_id: otherUserId })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }, [refresh])

  const blockUser = useCallback(async (otherUserId: string) => {
    const { error } = await supabase.rpc('block_user', { p_user_id: otherUserId })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }, [refresh])

  const unblockUser = useCallback(async (otherUserId: string) => {
    const { error } = await supabase.rpc('unblock_user', { p_user_id: otherUserId })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }, [refresh])

  const value = useMemo(
    () => ({
      friends,
      incoming,
      outgoing,
      blocked,
      loading,
      sendRequest,
      acceptRequest,
      declineRequest,
      removeFriend,
      blockUser,
      unblockUser,
    }),
    [friends, incoming, outgoing, blocked, loading, sendRequest, acceptRequest, declineRequest, removeFriend, blockUser, unblockUser]
  )

  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>
}

export function useFriends() {
  const ctx = useContext(FriendsContext)
  if (!ctx) throw new Error('useFriends precisa estar dentro de um FriendsProvider')
  return ctx
}
