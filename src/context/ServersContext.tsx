import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import type { Server } from '../types/database'

interface ServersContextValue {
  servers: Server[]
  loading: boolean
  refresh: () => Promise<void>
  createServer: (
    name: string,
    iconFile?: File | null,
    description?: string | null
  ) => Promise<{ error: string | null; server?: Server }>
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

// Estado de servidores compartilhado entre TODA a árvore de componentes.
// Antes disso, useServers() era um hook "solto" — cada componente que o
// chamava (ServerBar, os modais, o MainLayout) tinha sua PRÓPRIA cópia
// da lista, sem se avisarem quando algo mudava. Resultado: criar um
// servidor atualizava só o estado interno do modal, e a barra lateral
// nunca ficava sabendo. Centralizando aqui num Context, um único
// refresh() propaga pra tudo que usa useServers() ao mesmo tempo.
export function ServersProvider({ children }: { children: ReactNode }) {
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
    const { data, error } = await supabase.from('servers').select('*').order('created_at', { ascending: true })
    if (!error) setServers(data ?? [])
    setLoading(false)
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Sem isso, a lista de servidores só era carregada UMA VEZ (no
  // primeiro carregamento do app) e nunca mais — então entrar num
  // servidor novo (aceitar convite por link, aceitar convite mandado no
  // chat, ou até ser adicionado por outra pessoa) não aparecia em lugar
  // nenhum até fechar e abrir o app de novo (o que forçava esse
  // primeiro carregamento a rodar de novo). Mesmo padrão já usado em
  // GroupConversationsContext.tsx: escuta mudanças na MINHA linha de
  // `server_members` e recarrega a lista assim que algo mudar.
  useEffect(() => {
    if (!user) return
    // Sufixo aleatório no nome do canal — mesma proteção usada em
    // useConversations.ts/useServerMembers.ts: se por qualquer motivo esse
    // efeito rodar mais de uma vez ao mesmo tempo (StrictMode do React em
    // dev, Fast Refresh, etc.) com o MESMO nome de canal, o Supabase
    // devolveria o canal já inscrito e o segundo `.on()` derrubaria o app
    // com "cannot add postgres_changes callbacks ... after subscribe()".
    const uniqueSuffix = Math.random().toString(36).slice(2)
    const channel = supabase
      .channel(`server_membership:${user.id}:${uniqueSuffix}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'server_members', filter: `user_id=eq.${user.id}` },
        () => refresh()
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') refresh()
      })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, refresh])

  async function createServer(
    name: string,
    iconFile?: File | null,
    description?: string | null
  ): Promise<{ error: string | null; server?: Server }> {
    if (!user) return { error: 'Não autenticado' }

    const { data: server, error } = await supabase
      .from('servers')
      .insert({ name, owner_id: user.id, ...(description ? { description } : {}) })
      .select()
      .single()

    if (error || !server) {
      let debugInfo = ''
      if (error?.code === '42501') {
        const { data: whoami } = await supabase.rpc('debug_whoami')
        const row = whoami?.[0]
        debugInfo = ` [DEBUG — seu app: ${user.id} | banco enxerga: ${row?.jwt_uid ?? 'null'} (role: ${row?.jwt_role ?? 'null'})]`
      }
      return { error: (error?.message ?? 'Erro ao criar servidor') + debugInfo }
    }

    if (iconFile) {
      const { error: uploadError, url: iconUrl } = await uploadServerImage(server.id, iconFile, 'icon')
      if (!uploadError && iconUrl) {
        await supabase.from('servers').update({ icon_url: iconUrl }).eq('id', server.id)
        server.icon_url = iconUrl
      }
    }

    await refresh()
    return { error: null, server }
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
    const { data, error } = await supabase.rpc('create_server_invite', {
      p_server_id: serverId,
      p_max_uses: maxUses ?? null,
      p_expires_hours: expiresHours ?? null,
    })
    return { error: error?.message ?? null, invite: data ?? undefined }
  }

  return (
    <ServersContext.Provider
      value={{
        servers,
        loading,
        refresh,
        createServer,
        updateServer,
        deleteServer,
        leaveServer,
        joinServerByInvite,
        createInvite,
      }}
    >
      {children}
    </ServersContext.Provider>
  )
}
