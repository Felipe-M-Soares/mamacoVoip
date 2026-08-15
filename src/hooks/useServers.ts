import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { Server } from '../types/database'

export function useServers() {
  const { user } = useAuth()
  const [servers, setServers] = useState<Server[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!user) {
      setServers([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('servers')
      .select('*')
      .order('created_at', { ascending: true })

    if (!error) setServers(data ?? [])
    setLoading(false)
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function createServer(name: string, iconFile?: File | null): Promise<{ error: string | null; server?: Server }> {
    if (!user) return { error: 'Não autenticado' }

    const { data: server, error } = await supabase
      .from('servers')
      .insert({ name, owner_id: user.id })
      .select()
      .single()

    if (error || !server) return { error: error?.message ?? 'Erro ao criar servidor' }

    if (iconFile) {
      const { error: uploadError, iconUrl } = await uploadServerIcon(server.id, iconFile)
      if (!uploadError && iconUrl) {
        await supabase.from('servers').update({ icon_url: iconUrl }).eq('id', server.id)
        server.icon_url = iconUrl
      }
    }

    await refresh()
    return { error: null, server }
  }

  async function updateServer(serverId: string, updates: { name?: string; iconFile?: File | null }) {
    const patch: { name?: string; icon_url?: string } = {}
    if (updates.name) patch.name = updates.name

    if (updates.iconFile) {
      const { error: uploadError, iconUrl } = await uploadServerIcon(serverId, updates.iconFile)
      if (uploadError) return { error: uploadError }
      if (iconUrl) patch.icon_url = iconUrl
    }

    const { error } = await supabase.from('servers').update(patch).eq('id', serverId)
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function deleteServer(serverId: string) {
    const { error } = await supabase.from('servers').delete().eq('id', serverId)
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function leaveServer(serverId: string) {
    if (!user) return { error: 'Não autenticado' }
    const { error } = await supabase
      .from('server_members')
      .delete()
      .eq('server_id', serverId)
      .eq('user_id', user.id)
    if (!error) await refresh()
    return {
      error: error?.message.includes('permission')
        ? 'O dono não pode sair do servidor. Exclua o servidor ou transfira a propriedade.'
        : error?.message ?? null,
    }
  }

  async function joinServerByInvite(code: string) {
    const { data, error } = await supabase.rpc('join_server_via_invite', { p_code: code })
    if (!error) await refresh()
    return { error: error?.message ?? null, server: data ?? undefined }
  }

  async function createInvite(serverId: string, maxUses?: number, expiresHours?: number) {
    const { data, error } = await supabase.rpc('create_server_invite', {
      p_server_id: serverId,
      p_max_uses: maxUses ?? null,
      p_expires_hours: expiresHours ?? null,
    })
    return { error: error?.message ?? null, invite: data ?? undefined }
  }

  return {
    servers,
    loading,
    refresh,
    createServer,
    updateServer,
    deleteServer,
    leaveServer,
    joinServerByInvite,
    createInvite,
  }
}

async function uploadServerIcon(
  serverId: string,
  file: File
): Promise<{ error: string | null; iconUrl?: string }> {
  const ext = file.name.split('.').pop()
  const path = `${serverId}/icon-${Date.now()}.${ext}`

  const { error } = await supabase.storage.from('server-icons').upload(path, file, {
    cacheControl: '3600',
    upsert: true,
  })
  if (error) return { error: error.message }

  const { data } = supabase.storage.from('server-icons').getPublicUrl(path)
  return { error: null, iconUrl: data.publicUrl }
}
