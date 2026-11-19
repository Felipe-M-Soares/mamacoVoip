import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { readStartupCache, writeStartupCache } from '../lib/startupCache'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { rateLimitError } from '../lib/rateLimit'
import { changesChannel } from '../lib/realtimeChannel'
import type { Server } from '../types/database'

interface ServersContextValue {
  servers: Server[]
  loading: boolean
  refresh: () => Promise<void>
  createServer: (
    name: string,
    iconFile?: File | null,
    description?: string | null
  ) => Promise<{ error: string | null; warning?: string | null; server?: Server }>
  updateServer: (
    serverId: string,
    updates: {
      name?: string
      description?: string | null
      iconFile?: File | null
      bannerFile?: File | null
      afkChannelId?: string | null
      afkTimeoutMinutes?: number
    }
  ) => Promise<{ error: string | null }>
  deleteServer: (serverId: string) => Promise<{ error: string | null }>
  leaveServer: (serverId: string) => Promise<{ error: string | null }>
  joinServerByInvite: (code: string) => Promise<{ error: string | null; server?: Server }>
  createInvite: (
    serverId: string,
    maxUses?: number,
    expiresHours?: number
  ) => Promise<{ error: string | null; invite?: { code: string } }>
}

export const ServersContext = createContext<ServersContextValue | undefined>(undefined)

async function uploadServerImage(
  serverId: string,
  file: File,
  prefix: 'icon' | 'banner'
): Promise<{ error: string | null; url?: string }> {
  const ext = file.name.split('.').pop()
  const path = `${serverId}/${prefix}-${Date.now()}.${ext}`

  const { error } = await supabase.storage.from('server-icons').upload(path, file, {
    cacheControl: '3600',
    upsert: true,
  })
  if (error) return { error: error.message }

  const { data } = supabase.storage.from('server-icons').getPublicUrl(path)
  return { error: null, url: data.publicUrl }
}

export function ServersProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [cached] = useState(() => (userId ? readStartupCache<Server[]>(`servers:${userId}`) : null))
  const [servers, setServers] = useState<Server[]>(() => cached ?? [])
  const [loading, setLoading] = useState(!cached)
  const loadSeqRef = useRef(0)
  const hasLoadedRef = useRef(Boolean(cached))

  const refresh = useCallback(async () => {
    const seq = ++loadSeqRef.current
    if (!userId) {
      setServers([])
      setLoading(false)
      hasLoadedRef.current = false
      return
    }
    if (!hasLoadedRef.current) setLoading(true)
    try {
      const { data, error } = await supabase.from('servers').select('*').order('created_at', { ascending: true })
      if (seq !== loadSeqRef.current) return
      if (!error) {
        setServers(data ?? [])
        writeStartupCache(`servers:${userId}`, data ?? [])
        hasLoadedRef.current = true
      } else {
        console.error('[ServersContext] Falha ao carregar servidores:', error)
      }
    } catch (err) {
      console.error('[ServersContext] Falha ao carregar servidores:', err)
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!userId) return
    let active = true
    const channel = changesChannel(`server_membership:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'server_members', filter: `user_id=eq.${userId}` },
        () => void refresh()
      )
      .subscribe((status) => {
        if (!active) return
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') void refresh()
      })
    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [userId, refresh])

  async function createServer(
    name: string,
    iconFile?: File | null,
    description?: string | null
  ): Promise<{ error: string | null; warning?: string | null; server?: Server }> {
    if (!user) return { error: 'Não autenticado' }

    const { data: server, error } = await supabase
      .from('servers')
      .insert({ name, owner_id: user.id, ...(description ? { description } : {}) })
      .select()
      .single()

    if (error || !server) {
      if (error?.code === '42501') {
        return { error: 'Sem permissão para criar o servidor. Saia e entre de novo na conta e tente outra vez.' }
      }
      return { error: error?.message ?? 'Erro ao criar servidor' }
    }

    let iconWarning: string | null = null
    if (iconFile) {
      const { error: uploadError, url: iconUrl } = await uploadServerImage(server.id, iconFile, 'icon')
      if (!uploadError && iconUrl) {
        const { error: updateError } = await supabase.from('servers').update({ icon_url: iconUrl }).eq('id', server.id)
        if (updateError) {
          iconWarning = 'Servidor criado, mas não foi possível salvar o ícone. Tente trocá-lo de novo nas configurações.'
        } else {
          server.icon_url = iconUrl
        }
      } else if (uploadError) {
        iconWarning = 'Servidor criado, mas não foi possível enviar o ícone. Tente trocá-lo de novo nas configurações.'
      }
    }

    await refresh()
    return { error: null, warning: iconWarning, server }
  }

  async function updateServer(
    serverId: string,
    updates: {
      name?: string
      description?: string | null
      iconFile?: File | null
      bannerFile?: File | null
      afkChannelId?: string | null
      afkTimeoutMinutes?: number
    }
  ) {
    const patch: {
      name?: string
      description?: string | null
      icon_url?: string
      banner_url?: string
      afk_channel_id?: string | null
      afk_timeout_minutes?: number
    } = {}
    if (updates.name) patch.name = updates.name
    if (updates.description !== undefined) patch.description = updates.description
    if (updates.afkChannelId !== undefined) patch.afk_channel_id = updates.afkChannelId
    if (updates.afkTimeoutMinutes !== undefined) patch.afk_timeout_minutes = updates.afkTimeoutMinutes

    if (updates.iconFile) {
      const { error: uploadError, url: iconUrl } = await uploadServerImage(serverId, updates.iconFile, 'icon')
      if (uploadError) return { error: uploadError }
      if (iconUrl) patch.icon_url = iconUrl
    }

    if (updates.bannerFile) {
      const { error: uploadError, url: bannerUrl } = await uploadServerImage(serverId, updates.bannerFile, 'banner')
      if (uploadError) return { error: uploadError }
      if (bannerUrl) patch.banner_url = bannerUrl
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
    const limited = rateLimitError(`invite:${serverId}`, 5, 60_000, 'você está criando convite')
    if (limited) return { error: limited, invite: undefined }
    const { data, error } = await supabase.rpc('create_server_invite', {
      p_server_id: serverId,
      p_max_uses: maxUses ?? null,
      p_expires_hours: expiresHours ?? null,
    })
    return { error: error?.message ?? null, invite: data ?? undefined }
  }

  const value = useMemo(
    () => ({
      servers,
      loading,
      refresh,
      createServer,
      updateServer,
      deleteServer,
      leaveServer,
      joinServerByInvite,
      createInvite,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [servers, loading, refresh]
  )

  return <ServersContext.Provider value={value}>{children}</ServersContext.Provider>
}
