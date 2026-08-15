import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { BlockedUser, Friendship, Profile } from '../types/database'

export type FriendshipWithProfile = Friendship & { profile: Profile }
export type BlockedWithProfile = BlockedUser & { profile: Profile }

export function useFriends() {
  const { user } = useAuth()
  const [friends, setFriends] = useState<FriendshipWithProfile[]>([])
  const [incoming, setIncoming] = useState<FriendshipWithProfile[]>([])
  const [outgoing, setOutgoing] = useState<FriendshipWithProfile[]>([])
  const [blocked, setBlocked] = useState<BlockedWithProfile[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!user) {
      setFriends([])
      setIncoming([])
      setOutgoing([])
      setBlocked([])
      setLoading(false)
      return
    }
    setLoading(true)

    const [{ data: asUser }, { data: asFriend }, { data: blockedRows }] = await Promise.all([
      supabase.from('friendships').select('*').eq('user_id', user.id),
      supabase.from('friendships').select('*').eq('friend_id', user.id),
      supabase.from('blocked_users').select('*').eq('blocker_id', user.id),
    ])

    const allFriendships = [...(asUser ?? []), ...(asFriend ?? [])]
    const otherIds = new Set<string>()
    allFriendships.forEach((f) => otherIds.add(f.user_id === user.id ? f.friend_id : f.user_id))
    ;(blockedRows ?? []).forEach((b) => otherIds.add(b.blocked_id))

    const { data: profiles } =
      otherIds.size > 0
        ? await supabase.from('profiles').select('*').in('id', Array.from(otherIds))
        : { data: [] as Profile[] }

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))

    const withProfile = (f: Friendship): FriendshipWithProfile | null => {
      const otherId = f.user_id === user.id ? f.friend_id : f.user_id
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

    setLoading(false)
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Realtime: pedidos de amizade chegando/sendo aceitos
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`friendships:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => refresh())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, refresh])

  async function sendRequest(username: string) {
    const { error } = await supabase.rpc('send_friend_request', { p_username: username })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function acceptRequest(requestId: string) {
    const { error } = await supabase.rpc('respond_friend_request', { p_request_id: requestId, p_accept: true })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function declineRequest(requestId: string) {
    const { error } = await supabase.rpc('respond_friend_request', { p_request_id: requestId, p_accept: false })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function removeFriend(otherUserId: string) {
    const { error } = await supabase.rpc('remove_friend', { p_other_user_id: otherUserId })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function blockUser(otherUserId: string) {
    const { error } = await supabase.rpc('block_user', { p_user_id: otherUserId })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function unblockUser(otherUserId: string) {
    const { error } = await supabase.rpc('unblock_user', { p_user_id: otherUserId })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  return {
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
  }
}
