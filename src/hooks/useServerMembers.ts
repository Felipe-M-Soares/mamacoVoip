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

  return { members, loading, refresh }
}
