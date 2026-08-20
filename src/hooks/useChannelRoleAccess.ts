import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useChannelRoleAccess(channelId: string | null) {
  const [roleIds, setRoleIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!channelId) {
      setRoleIds([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data } = await supabase.from('channel_role_access').select('role_id').eq('channel_id', channelId)
    setRoleIds((data ?? []).map((r) => r.role_id))
    setLoading(false)
  }, [channelId])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function setAllowedRoles(newRoleIds: string[]) {
    if (!channelId) return { error: 'Canal inválido' }
    // Substitui a lista inteira — mais simples e seguro que calcular
    // diffs, e o volume de dados aqui é sempre pequeno (poucos cargos
    // por servidor).
    const { error: deleteError } = await supabase.from('channel_role_access').delete().eq('channel_id', channelId)
    if (deleteError) return { error: deleteError.message }

    if (newRoleIds.length > 0) {
      const { error: insertError } = await supabase
        .from('channel_role_access')
        .insert(newRoleIds.map((roleId) => ({ channel_id: channelId, role_id: roleId })))
      if (insertError) return { error: insertError.message }
    }

    await refresh()
    return { error: null }
  }

  return { roleIds, loading, setAllowedRoles, refresh }
}
