import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { changesChannel } from '../lib/realtimeChannel'
import { invalidateSignedUrl } from '../lib/storageUrls'
import type { GroupConversation, Profile } from '../types/database'

const GROUP_BUCKET = 'group-attachments'
// A API do Storage aceita vários caminhos por chamada; lotes pequenos
// evitam requisição gigante em grupo com muito anexo.
const STORAGE_REMOVE_BATCH = 100

export interface GroupConversationWithMembers extends GroupConversation {
  members: Profile[]
}

interface GroupConversationsContextValue {
  groups: GroupConversationWithMembers[]
  loading: boolean
  createGroup: (name: string, memberIds: string[]) => Promise<{ error: string | null; groupId?: string }>
  leaveGroup: (groupId: string) => Promise<{ error: string | null }>
  /** Só quem criou o grupo: apaga o grupo inteiro (mensagens, anexos, membros). */
  deleteGroup: (groupId: string) => Promise<{ error: string | null }>
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
    // Nome único por montagem (ver lib/realtimeChannel.ts)
    const channel = changesChannel(`group_conversation_membership:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_conversation_members', filter: `user_id=eq.${userId}` },
        (payload) => {
          // O Realtime não filtra DELETE (manda o de todo mundo, só com a
          // chave primária) — sem esta checagem, cada pessoa que saísse de
          // QUALQUER grupo faria todos os clientes online recarregarem.
          if (payload.eventType === 'DELETE') {
            // (a chave primária é group_id + user_id, então as duas vêm)
            const old = payload.old as { user_id?: string; group_id?: string }
            if (old.user_id !== userId) return
            if (old.group_id) setGroups((prev) => prev.filter((g) => g.id !== old.group_id))
          }
          void refresh()
        }
      )
      // Grupo apagado por quem criou: some da lista de todo mundo na hora.
      // DELETE também chega sem filtro/RLS (só o id) — ignora id que não
      // está na lista. UPDATE (nome/ícone) passa pela RLS: só membros.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'group_conversations' }, (payload) => {
        const id = (payload.old as { id?: string }).id
        if (id) setGroups((prev) => (prev.some((g) => g.id === id) ? prev.filter((g) => g.id !== id) : prev))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_conversations' }, (payload) => {
        const row = payload.new as GroupConversation
        setGroups((prev) => (prev.some((g) => g.id === row.id) ? prev.map((g) => (g.id === row.id ? { ...g, ...row } : g)) : prev))
      })
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
      // O id vem do cliente e o grupo é criado SEM ler de volta: desde a
      // migration 007 (parte 19) só MEMBRO enxerga o grupo, e o banco
      // põe quem criou como membro por gatilho logo depois do insert —
      // um `.select()` aqui seria checado antes disso e falharia.
      const group = { id: crypto.randomUUID() }
      const { error } = await supabase
        .from('group_conversations')
        .insert({ id: group.id, name: name.trim() || null, created_by: userId })
      if (error) return { error: error.message ?? 'Erro ao criar grupo' }

      // Quem criou já entrou pelo gatilho; `ignoreDuplicates` mantém isto
      // funcionando também num banco que ainda não rodou a parte 19.
      const allMembers = [...new Set([userId, ...memberIds])]
      const { error: memberError } = await supabase
        .from('group_conversation_members')
        .upsert(
          allMembers.map((uid) => ({ group_id: group.id, user_id: uid })),
          { onConflict: 'group_id,user_id', ignoreDuplicates: true }
        )
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

  // Apagar o grupo (só quem criou — a RLS confere de novo no banco).
  // 1) lista e apaga os arquivos do grupo pela API do Storage (depois de
  //    apagar o grupo ninguém mais passa na política de leitura); falha
  //    aqui não impede apagar o grupo — o que sobrar vira órfão e sai na
  //    limpeza periódica (orphan_attachment_objects);
  // 2) apaga a linha do grupo: membros, mensagens e anexos vão junto em
  //    cascata no banco, e o Realtime tira o grupo da lista dos outros.
  const deleteGroup = useCallback(
    async (groupId: string): Promise<{ error: string | null }> => {
      if (!userId) return { error: 'Não autenticado' }
      const group = groups.find((g) => g.id === groupId)
      if (group && group.created_by !== userId) return { error: 'Só quem criou o grupo pode apagá-lo.' }

      try {
        for (let round = 0; round < 20; round++) {
          const { data: paths, error: listError } = await supabase.rpc('group_attachment_objects', {
            p_group_id: groupId,
            p_limit: 1000,
          })
          if (listError || !paths || paths.length === 0) break
          let removedAny = false
          for (let i = 0; i < paths.length; i += STORAGE_REMOVE_BATCH) {
            const batch = paths.slice(i, i + STORAGE_REMOVE_BATCH)
            batch.forEach((p) => invalidateSignedUrl(GROUP_BUCKET, p))
            const { data: removed, error: removeError } = await supabase.storage.from(GROUP_BUCKET).remove(batch)
            if (!removeError && removed && removed.length > 0) removedAny = true
          }
          if (!removedAny || paths.length < 1000) break
        }
      } catch (err) {
        console.warn('[GroupConversationsContext] Falha ao apagar arquivos do grupo (seguindo):', err)
      }

      const { data, error } = await supabase.from('group_conversations').delete().eq('id', groupId).select('id')
      if (error) return { error: error.message }
      if (!data || data.length === 0) return { error: 'Não foi possível apagar o grupo (só quem criou pode apagar).' }

      setGroups((prev) => prev.filter((g) => g.id !== groupId))
      return { error: null }
    },
    [userId, groups]
  )

  const value = useMemo(
    () => ({ groups, loading, createGroup, leaveGroup, deleteGroup, refresh }),
    [groups, loading, createGroup, leaveGroup, deleteGroup, refresh]
  )

  return <GroupConversationsContext.Provider value={value}>{children}</GroupConversationsContext.Provider>
}

export function useGroupConversations() {
  const ctx = useContext(GroupConversationsContext)
  if (!ctx) throw new Error('useGroupConversations precisa estar dentro de um GroupConversationsProvider')
  return ctx
}
