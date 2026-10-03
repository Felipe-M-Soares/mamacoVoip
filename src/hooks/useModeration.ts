import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { moderateVoiceParticipant } from '../lib/livekit'
import { useAuth } from './useAuth'
import { PERMISSIONS, type Ban, type ModerationLog, type Permission, type Profile } from '../types/database'

export type BanWithProfile = Ban & { profile: Profile }
export type LogWithProfiles = ModerationLog & { actor: Profile | undefined; target: Profile | undefined }

// Mesmo teto do banco (migration 013) e de apps de chat populares: 28 dias.
const MAX_TIMEOUT_MINUTES = 28 * 24 * 60
const MAX_REASON_LENGTH = 500

function cleanReason(reason: string | undefined): string | undefined {
  const trimmed = reason?.trim()
  return trimmed ? trimmed.slice(0, MAX_REASON_LENGTH) : undefined
}

export function useModeration(serverId: string | null) {
  const { user } = useAuth()
  const [bans, setBans] = useState<BanWithProfile[]>([])
  const [logs, setLogs] = useState<LogWithProfiles[]>([])
  const [permissions, setPermissions] = useState<Record<Permission, boolean>>({} as Record<Permission, boolean>)
  const [loading, setLoading] = useState(true)

  const checkPermissions = useCallback(async () => {
    if (!serverId || !user) return {} as Record<Permission, boolean>
    const perms: Permission[] = [...PERMISSIONS]
    const map = {} as Record<Permission, boolean>

    // Uma chamada só (my_permissions, migration 013) em vez de 9
    // chamadas de has_permission a cada abertura/atualização. Se a
    // função ainda não existir no banco, cai pro jeito antigo.
    const rpcAny = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>
    const { data: granted, error: grantedError } = await rpcAny('my_permissions', { p_server_id: serverId })
    if (!grantedError && Array.isArray(granted)) {
      const set = new Set(granted as string[])
      const isAdmin = set.has('administrator')
      // Cargos (criar, editar e dar/tirar cargo de alguém) são só do dono
      // e de quem é Administrador — o banco garante o mesmo.
      perms.forEach((p) => {
        map[p] = isAdmin || (p !== 'manage_roles' && set.has(p))
      })
      return map
    }

    const results = await Promise.all(
      perms.map((p) => supabase.rpc('has_permission', { p_server_id: serverId, p_user_id: user.id, p_permission: p }))
    )
    perms.forEach((p, i) => {
      map[p] = Boolean(results[i].data)
    })
    return map
  }, [serverId, user])

  // Evita que a resposta atrasada de um servidor anterior sobrescreva a
  // do servidor atual (trocar de servidor rápido mostrava banidos/log do
  // servidor errado por um instante).
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!serverId) {
      setBans([])
      setLogs([])
      setPermissions({} as Record<Permission, boolean>)
      setLoading(false)
      return
    }
    setLoading(true)
    const requestId = ++requestIdRef.current

    const perms = await checkPermissions()
    if (requestId !== requestIdRef.current) return
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
    if (requestId !== requestIdRef.current) return
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
    reason = cleanReason(reason)
    const { error } = await supabase.rpc('kick_member', { p_server_id: serverId, p_user_id: userId, p_reason: reason ?? null })
    // Tira da voz também (best-effort, não segura a UI).
    if (!error) void moderateVoiceParticipant({ serverId, userId, action: 'kick' })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function banMember(userId: string, reason?: string) {
    if (!serverId) return { error: 'Nenhum servidor selecionado' }
    reason = cleanReason(reason)
    const { error } = await supabase.rpc('ban_member', { p_server_id: serverId, p_user_id: userId, p_reason: reason ?? null })
    // Tira da voz também (best-effort, não segura a UI).
    if (!error) void moderateVoiceParticipant({ serverId, userId, action: 'ban' })
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
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_TIMEOUT_MINUTES) {
      return { error: 'Duração de silenciamento inválida (máximo 28 dias).' }
    }
    reason = cleanReason(reason)
    const { error } = await supabase.rpc('timeout_member', {
      p_server_id: serverId,
      p_user_id: userId,
      p_minutes: minutes,
      p_reason: reason ?? null,
    })
    // Tira da voz também (best-effort, não segura a UI).
    if (!error) void moderateVoiceParticipant({ serverId, userId, action: 'timeout' })
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
