import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { Ban, ModerationLog, Permission, Profile } from '../types/database'

export type BanWithProfile = Ban & { profile: Profile }
export type LogWithProfiles = ModerationLog & { actor: Profile | undefined; target: Profile | undefined }

export function useModeration(serverId: string | null) {
  const { user } = useAuth()
  const [bans, setBans] = useState<BanWithProfile[]>([])
  const [logs, setLogs] = useState<LogWithProfiles[]>([])
  const [permissions, setPermissions] = useState<Record<Permission, boolean>>({} as Record<Permission, boolean>)
  const [loading, setLoading] = useState(true)

  const checkPermissions = useCallback(async () => {
    if (!serverId || !user) return {} as Record<Permission, boolean>
    const perms: Permission[] = [
      'administrator',
      'manage_server',
      'manage_roles',
      'manage_channels',
      'manage_messages',
      'kick_members',
      'ban_members',
      'timeout_members',
      'view_audit_log',
    ]
    const results = await Promise.all(
      perms.map((p) => supabase.rpc('has_permission', { p_server_id: serverId, p_user_id: user.id, p_permission: p }))
    )
    const map = {} as Record<Permission, boolean>
    perms.forEach((p, i) => {
      map[p] = Boolean(results[i].data)
    })
    return map
  }, [serverId, user])

  const refresh = useCallback(async () => {
    if (!serverId) {
      setBans([])
      setLogs([])
      setPermissions({} as Record<Permission, boolean>)
      setLoading(false)
      return
    }
    setLoading(true)

    const perms = await checkPermissions()
    setPermissions(perms)

    const [{ data: banRows }, { data: logRows }] = await Promise.all([
      perms.ban_members ? supabase.from('bans').select('*').eq('server_id', serverId) : Promise.resolve({ data: [] }),
      perms.view_audit_log
        ? supabase.from('moderation_logs').select('*').eq('server_id', serverId).order('created_at', { ascending: false }).limit(100)
        : Promise.resolve({ data: [] }),
    ])

    const userIds = new Set<string>()
    ;(banRows ?? []).forEach((b) => userIds.add(b.user_id))
    ;(logRows ?? []).forEach((l) => {
      userIds.add(l.actor_id)
      if (l.target_user_id) userIds.add(l.target_user_id)
    })

    const { data: profiles } =
      userIds.size > 0 ? await supabase.from('profiles').select('*').in('id', Array.from(userIds)) : { data: [] as Profile[] }
    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))

    setBans(
      (banRows ?? [])
        .map((b) => {
          const profile = profileById.get(b.user_id)
          return profile ? { ...b, profile } : null
        })
        .filter((b): b is BanWithProfile => b !== null)
    )

    setLogs(
      (logRows ?? []).map((l) => ({
        ...l,
        actor: profileById.get(l.actor_id),
        target: l.target_user_id ? profileById.get(l.target_user_id) : undefined,
      }))
    )

    setLoading(false)
  }, [serverId, checkPermissions])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function kickMember(userId: string, reason?: string) {
    if (!serverId) return { error: 'Nenhum servidor selecionado' }
    const { error } = await supabase.rpc('kick_member', { p_server_id: serverId, p_user_id: userId, p_reason: reason ?? null })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function banMember(userId: string, reason?: string) {
    if (!serverId) return { error: 'Nenhum servidor selecionado' }
    const { error } = await supabase.rpc('ban_member', { p_server_id: serverId, p_user_id: userId, p_reason: reason ?? null })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function unbanMember(userId: string) {
    if (!serverId) return { error: 'Nenhum servidor selecionado' }
    const { error } = await supabase.rpc('unban_member', { p_server_id: serverId, p_user_id: userId })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function timeoutMember(userId: string, minutes: number, reason?: string) {
    if (!serverId) return { error: 'Nenhum servidor selecionado' }
    const { error } = await supabase.rpc('timeout_member', {
      p_server_id: serverId,
      p_user_id: userId,
      p_minutes: minutes,
      p_reason: reason ?? null,
    })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function removeTimeout(userId: string) {
    if (!serverId) return { error: 'Nenhum servidor selecionado' }
    const { error } = await supabase.rpc('remove_timeout', { p_server_id: serverId, p_user_id: userId })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  return { bans, logs, permissions, loading, refresh, kickMember, banMember, unbanMember, timeoutMember, removeTimeout }
}
