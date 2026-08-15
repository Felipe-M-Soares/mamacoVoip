import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Permission, Role, ServerMemberRole } from '../types/database'

export function useRoles(serverId: string | null) {
  const [roles, setRoles] = useState<Role[]>([])
  const [memberRoles, setMemberRoles] = useState<ServerMemberRole[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!serverId) {
      setRoles([])
      setMemberRoles([])
      setLoading(false)
      return
    }
    setLoading(true)
    const [{ data: roleRows }, { data: assignments }] = await Promise.all([
      supabase.from('roles').select('*').eq('server_id', serverId).order('position', { ascending: false }),
      supabase.from('server_member_roles').select('*').eq('server_id', serverId),
    ])
    setRoles(roleRows ?? [])
    setMemberRoles(assignments ?? [])
    setLoading(false)
  }, [serverId])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function createRole(name: string, color: string, permissions: Permission[]) {
    if (!serverId) return { error: 'Nenhum servidor selecionado' }
    const { error } = await supabase.rpc('create_role', {
      p_server_id: serverId,
      p_name: name,
      p_color: color,
      p_permissions: permissions,
    })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function updateRole(roleId: string, name: string, color: string, permissions: Permission[]) {
    const { error } = await supabase.rpc('update_role', {
      p_role_id: roleId,
      p_name: name,
      p_color: color,
      p_permissions: permissions,
    })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function deleteRole(roleId: string) {
    const { error } = await supabase.rpc('delete_role', { p_role_id: roleId })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function assignRole(userId: string, roleId: string) {
    if (!serverId) return { error: 'Nenhum servidor selecionado' }
    const { error } = await supabase.rpc('assign_role', { p_server_id: serverId, p_user_id: userId, p_role_id: roleId })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function removeRole(userId: string, roleId: string) {
    if (!serverId) return { error: 'Nenhum servidor selecionado' }
    const { error } = await supabase.rpc('remove_role', { p_server_id: serverId, p_user_id: userId, p_role_id: roleId })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  function rolesForUser(userId: string): Role[] {
    const roleIds = memberRoles.filter((mr) => mr.user_id === userId).map((mr) => mr.role_id)
    return roles.filter((r) => roleIds.includes(r.id)).sort((a, b) => b.position - a.position)
  }

  return { roles, memberRoles, loading, refresh, createRole, updateRole, deleteRole, assignRole, removeRole, rolesForUser }
}
