import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { uniqueTopic } from '../lib/realtimeChannel'
import type { GroupConversation, Profile } from '../types/database'

export interface GroupConversationWithMembers extends GroupConversation {
  members: Profile[]
}

interface GroupConversationsContextValue {
  groups: GroupConversationWithMembers[]
  loading: boolean
  createGroup: (name: string, memberIds: string[]) => Promise<{ error: string | null; groupId?: string }>
  leaveGroup: (groupId: string) => Promise<{ error: string | null }>
  refresh: () => Promise<void>
}

const GroupConversationsContext = createContext<GroupConversationsContextValue | undefined>(undefined)

// Igual ao FriendsContext — grupos de DM eram consultados em 4
// lugares diferentes ao mesmo tempo (barra lateral, layout principal,
// tela do grupo, modal de criar grupo), cada um com sua própria
// conexão de tempo real duplicada. Agora é um Provider só.
export function GroupConversationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  // Só o ID: o objeto `user` troca de identidade a cada renovação de token.
  const userId = user?.id ?? null
  const [groups, setGroups] = useState<GroupConversationWithMembers[]>([])
  const [loading, setLoading] = useState(true)
  const loadSeqRef = useRef(0)
  const hasLoadedRef = useRef(false)

  const refresh = useCallback(async () => {
    const seq = ++loadSeqRef.current
    if (!userId) {
      setGroups([])
      setLoading(false)
      hasLoadedRef.current = false
      return
    }
    // spinner só na primeira carga (evita a lista "piscar" a cada evento)
    if (!hasLoadedRef.current) setLoading(true)

    try {
      const { data: memberships } = await supabase
        .from('group_conversation_members')
        .select('group_id')
        .eq('user_id', userId)

      const groupIds = (memberships ?? []).map((m) => m.group_id)
      if (groupIds.length === 0) {
        if (seq === loadSeqRef.current) setGroups([])
        hasLoadedRef.current = true
        return
      }

      // As duas buscas não dependem uma da outra — antes eram em sequência.
      const [{ data: convos }, { data: allMembers }] = await Promise.all([
        supabase.from('group_conversations').select('*').in('id', groupIds).order('created_at', { ascending: false }),
        supabase.from('group_conversation_members').select('group_id, profile:profiles(*)').in('group_id', groupIds),
      ])
      if (seq !== loadSeqRef.current) return

      const membersByGroup: Record<string, Profile[]> = {}
      for (const row of (allMembers ?? []) as unknown as { group_id: string; profile: Profile | null }[]) {
        if (row.profile) (membersByGroup[row.group_id] ??= []).push(row.profile)
      }

      setGroups((convos ?? []).map((g) => ({ ...g, members: membersByGroup[g.id] ?? [] })))
      hasLoadedRef.current = true
    } catch (err) {
      console.error('[GroupConversationsContext] Falha ao carregar grupos:', err)
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!userId) return
    let active = true
    const channel = supabase
      // Nome único por montagem (ver lib/realtimeChannel.ts)
      .channel(uniqueTopic(`group_conversation_membership:${userId}`))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_conversation_members', filter: `user_id=eq.${userId}` },
        () => void refresh()
      )
      .subscribe((status) => {
        // `CLOSED` também vem da própria limpeza — não recarrega nesse caso
        if (!active) return
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') void refresh()
      })
    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [userId, refresh])

  const createGroup = useCallback(
    async (name: string, memberIds: string[]): Promise<{ error: string | null; groupId?: string }> => {
      if (!userId) return { error: 'Não autenticado' }
      const { data: group, error } = await supabase
        .from('group_conversations')
        .insert({ name: name.trim() || null, created_by: userId })
        .select()
        .single()
      if (error || !group) return { error: error?.message ?? 'Erro ao criar grupo' }

      const allMembers = [...new Set([userId, ...memberIds])]
      const { error: memberError } = await supabase
        .from('group_conversation_members')
        .insert(allMembers.map((uid) => ({ group_id: group.id, user_id: uid })))
      if (memberError) {
        // Desfaz o grupo "órfão" (criado sem membros) — best-effort.
        await supabase.from('group_conversations').delete().eq('id', group.id)
        return { error: memberError.message }
      }

      await refresh()
      return { error: null, groupId: group.id }
    },
    [userId, refresh]
  )

  // Antes o erro era ignorado: a tela saía do grupo como se tivesse dado
  // certo, e o grupo reaparecia na lista.
  const leaveGroup = useCallback(
    async (groupId: string): Promise<{ error: string | null }> => {
      if (!userId) return { error: 'Não autenticado' }
      const { error } = await supabase.from('group_conversation_members').delete().eq('group_id', groupId).eq('user_id', userId)
      if (error) return { error: error.message }
      await refresh()
      return { error: null }
    },
    [userId, refresh]
  )

  const value = useMemo(
    () => ({ groups, loading, createGroup, leaveGroup, refresh }),
    [groups, loading, createGroup, leaveGroup, refresh]
  )

  return <GroupConversationsContext.Provider value={value}>{children}</GroupConversationsContext.Provider>
}

export function useGroupConversations() {
  const ctx = useContext(GroupConversationsContext)
  if (!ctx) throw new Error('useGroupConversations precisa estar dentro de um GroupConversationsProvider')
  return ctx
}
