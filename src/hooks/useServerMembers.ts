import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile, ServerMember } from '../types/database'

export type ServerMemberWithProfile = ServerMember & { profile: Profile }

export function useServerMembers(serverId: string | null) {
  const [members, setMembers] = useState<ServerMemberWithProfile[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!serverId) {
      setMembers([])
      setLoading(false)
      return
    }
    setLoading(true)

    const { data: memberRows } = await supabase.from('server_members').select('*').eq('server_id', serverId)

    if (!memberRows || memberRows.length === 0) {
      setMembers([])
      setLoading(false)
      return
    }

    const userIds = memberRows.map((m) => m.user_id)
    const { data: profiles } = await supabase.from('profiles').select('*').in('id', userIds)

    const merged = memberRows
      .map((m) => {
        const profile = profiles?.find((p) => p.id === m.user_id)
        return profile ? { ...m, profile } : null
      })
      .filter((m): m is ServerMemberWithProfile => m !== null)

    setMembers(merged)
    setLoading(false)
  }, [serverId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Sem isso, a lista de membros só era buscada UMA VEZ (quando você
  // entra no servidor/abre o chat) e nunca mais — então quando alguém
  // NOVO entrava enquanto você já estava com o servidor aberto, o app
  // não tinha o perfil dessa pessoa em mãos pra mostrar o nome dela. O
  // aviso de "entrou no servidor" (MessageItem.tsx) cai no nome genérico
  // "Alguém" exatamente por isso: o author_id da mensagem de sistema não
  // batia com ninguém na lista de membros carregada. Escutando mudanças
  // em `server_members` deste servidor, a lista se atualiza sozinha.
  useEffect(() => {
    if (!serverId) return
    const channel = supabase
      .channel(`server_members:${serverId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'server_members', filter: `server_id=eq.${serverId}` },
        () => refresh()
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') refresh()
      })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [serverId, refresh])

  return { members, loading, refresh }
}
