import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import type { GroupConversation, Profile } from '../types/database'

export interface GroupConversationWithMembers extends GroupConversation {
  members: Profile[]
}

interface GroupConversationsContextValue {
  groups: GroupConversationWithMembers[]
  loading: boolean
  createGroup: (name: string, memberIds: string[]) => Promise<{ error: string | null; groupId?: string }>
  leaveGroup: (groupId: string) => Promise<void>
  refresh: () => Promise<void>
}

const GroupConversationsContext = createContext<GroupConversationsContextValue | undefined>(undefined)

// Igual ao FriendsContext — grupos de DM eram consultados em 4
// lugares diferentes ao mesmo tempo (barra lateral, layout principal,
// tela do grupo, modal de criar grupo), cada um com sua própria
// conexão de tempo real duplicada. Agora é um Provider só.
export function GroupConversationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [groups, setGroups] = useState<GroupConversationWithMembers[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!user) {
      setGroups([])
      setLoading(false)
      return
    }
    setLoading(true)

    const { data: memberships } = await supabase
      .from('group_conversation_members')
      .select('group_id')
      .eq('user_id', user.id)

    const groupIds = (memberships ?? []).map((m) => m.group_id)
    if (groupIds.length === 0) {
      setGroups([])
      setLoading(false)
      return
    }

    const { data: convos } = await supabase
      .from('group_conversations')
      .select('*')
      .in('id', groupIds)
      .order('created_at', { ascending: false })

    const { data: allMembers } = await supabase
      .from('group_conversation_members')
      .select('group_id, profile:profiles(*)')
      .in('group_id', groupIds)

    const membersByGroup: Record<string, Profile[]> = {}
    for (const row of (allMembers ?? []) as unknown as { group_id: string; profile: Profile }[]) {
      membersByGroup[row.group_id] = [...(membersByGroup[row.group_id] ?? []), row.profile]
    }

    setGroups((convos ?? []).map((g) => ({ ...g, members: membersByGroup[g.id] ?? [] })))
    setLoading(false)
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`group_conversation_membership:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_conversation_members', filter: `user_id=eq.${user.id}` },
        () => refresh()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, refresh])

  async function createGroup(name: string, memberIds: string[]): Promise<{ error: string | null; groupId?: string }> {
    if (!user) return { error: 'Não autenticado' }
    const { data: group, error } = await supabase
      .from('group_conversations')
      .insert({ name: name.trim() || null, created_by: user.id })
      .select()
      .single()
    if (error || !group) return { error: error?.message ?? 'Erro ao criar grupo' }

    const allMembers = [...new Set([user.id, ...memberIds])]
    const { error: memberError } = await supabase
      .from('group_conversation_members')
      .insert(allMembers.map((uid) => ({ group_id: group.id, user_id: uid })))
    if (memberError) return { error: memberError.message }

    await refresh()
    return { error: null, groupId: group.id }
  }

  async function leaveGroup(groupId: string) {
    if (!user) return
    await supabase.from('group_conversation_members').delete().eq('group_id', groupId).eq('user_id', user.id)
    await refresh()
  }

  return (
    <GroupConversationsContext.Provider value={{ groups, loading, createGroup, leaveGroup, refresh }}>
      {children}
    </GroupConversationsContext.Provider>
  )
}

export function useGroupConversations() {
  const ctx = useContext(GroupConversationsContext)
  if (!ctx) throw new Error('useGroupConversations precisa estar dentro de um GroupConversationsProvider')
  return ctx
}
