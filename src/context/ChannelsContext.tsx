import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Category, Channel, ChannelType } from '../types/database'

interface ChannelsContextValue {
  categories: Category[]
  channels: Channel[]
  loading: boolean
  loadError: string | null
  refresh: () => Promise<void>
  createChannel: (name: string, type: ChannelType, categoryId: string | null, isStage?: boolean) => Promise<{ error: string | null }>
  updateChannel: (channelId: string, updates: { name?: string; topic?: string | null; is_stage?: boolean; slowmode_seconds?: number; is_spoiler?: boolean; user_limit?: number; is_restricted?: boolean }) => Promise<{ error: string | null }>
  deleteChannel: (channelId: string) => Promise<{ error: string | null }>
  createCategory: (name: string) => Promise<{ error: string | null }>
  updateCategory: (categoryId: string, name: string) => Promise<{ error: string | null }>
  deleteCategory: (categoryId: string) => Promise<{ error: string | null }>
  moveChannel: (channelId: string, categoryId: string | null, direction: 'up' | 'down') => Promise<{ error: string | null }>
  moveChannelToCategory: (
    channelId: string,
    categoryId: string | null,
    beforeChannelId?: string | null
  ) => Promise<{ error: string | null }>
  moveCategory: (categoryId: string, direction: 'up' | 'down') => Promise<{ error: string | null }>
}

export const ChannelsContext = createContext<ChannelsContextValue | undefined>(undefined)

// Erros do supabase-js (PostgrestError, AuthError, etc.) são objetos
// simples — NÃO são `instanceof Error` — então um catch que só checa
// `instanceof Error` cai sempre no texto genérico de fallback, mesmo
// quando o erro real tem uma `.message` útil (ex.: "new row violates
// row-level security policy", "permission denied", etc.). Isso escondia
// exatamente a informação que precisávamos pra descobrir a causa real.
// Também aproveita `.code`/`.hint` quando existem (comuns em erros de
// RLS/Postgres) pra dar um diagnóstico mais completo.
function describeError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; code?: unknown; hint?: unknown; details?: unknown }
    if (typeof e.message === 'string' && e.message) {
      const parts = [e.message]
      if (typeof e.code === 'string' && e.code) parts.push(`código: ${e.code}`)
      if (typeof e.hint === 'string' && e.hint) parts.push(`dica: ${e.hint}`)
      if (typeof e.details === 'string' && e.details) parts.push(e.details)
      return parts.join(' — ')
    }
  }
  if (err instanceof Error && err.message) return err.message
  return fallback
}

// Um Provider por servidor: o MainLayout monta este componente com
// key={server.id}, então trocar de servidor naturalmente reinicia o
// estado (sem vazar canais de um servidor pro outro) e, dentro do MESMO
// servidor, toda a árvore (sidebar, modais, área de chat) compartilha
// exatamente a mesma lista — igual ao ServersContext.
export function ChannelsProvider({ serverId, children }: { serverId: string; children: ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Antes, uma falha de rede/RLS aqui (uma exceção lançada pelo fetch,
  // por exemplo — diferente de um { error } retornado normalmente pelo
  // supabase-js) derrubava a promise sem passar pelo resto da função:
  // "loading" nunca voltava pra false e nada de erro era mostrado. Na
  // prática isso trava a sidebar no skeleton pra sempre — parece "não
  // aparece nenhum canal", sem nenhuma pista do motivo. Envolver em
  // try/catch garante que loading sempre termina e que, se algo falhar
  // de verdade, o motivo aparece pra quem está usando (e pra quem for
  // depurar depois) em vez de falhar em silêncio.
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [catsRes, chansRes] = await Promise.all([
        supabase.from('categories').select('*').eq('server_id', serverId).order('position'),
        supabase.from('channels').select('*').eq('server_id', serverId).order('position'),
      ])
      if (catsRes.error) throw catsRes.error
      if (chansRes.error) throw chansRes.error
      setCategories(catsRes.data ?? [])
      setChannels(chansRes.data ?? [])
      setLoadError(null)
    } catch (err) {
      setLoadError(describeError(err, 'Não foi possível carregar os canais.'))
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Ponto central: se o insert falhar de um jeito que o supabase-js não
  // resolve como { error } (rejeição de rede, por exemplo), esse
  // try/catch garante que quem chamou SEMPRE recebe uma mensagem de
  // erro de volta em vez de uma exceção não tratada — que no modal de
  // criar canal virava "sem erro, mas o canal nunca aparece".
  async function createChannel(name: string, type: ChannelType, categoryId: string | null, isStage = false) {
    try {
      const position = channels.filter((c) => c.category_id === categoryId).length
      const { error } = await supabase
        .from('channels')
        .insert({ server_id: serverId, name, type, category_id: categoryId, position, is_stage: isStage })
      if (error) return { error: describeError(error, 'Não foi possível criar o canal.') }
      await refresh()
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível criar o canal.') }
    }
  }

  async function updateChannel(channelId: string, updates: { name?: string; topic?: string | null; is_stage?: boolean; slowmode_seconds?: number; is_spoiler?: boolean; user_limit?: number; is_restricted?: boolean }) {
    try {
      const { error } = await supabase.from('channels').update(updates).eq('id', channelId)
      if (error) return { error: describeError(error, 'Não foi possível atualizar o canal.') }
      await refresh()
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível atualizar o canal.') }
    }
  }

  async function deleteChannel(channelId: string) {
    try {
      const { error } = await supabase.from('channels').delete().eq('id', channelId)
      if (error) return { error: describeError(error, 'Não foi possível excluir o canal.') }
      await refresh()
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível excluir o canal.') }
    }
  }

  async function createCategory(name: string) {
    try {
      const position = categories.length
      const { error } = await supabase.from('categories').insert({ server_id: serverId, name, position })
      if (error) return { error: describeError(error, 'Não foi possível criar a categoria.') }
      await refresh()
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível criar a categoria.') }
    }
  }

  async function updateCategory(categoryId: string, name: string) {
    try {
      const { error } = await supabase.from('categories').update({ name }).eq('id', categoryId)
      if (error) return { error: describeError(error, 'Não foi possível atualizar a categoria.') }
      await refresh()
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível atualizar a categoria.') }
    }
  }

  async function deleteCategory(categoryId: string) {
    try {
      const { error } = await supabase.from('categories').delete().eq('id', categoryId)
      if (error) return { error: describeError(error, 'Não foi possível excluir a categoria.') }
      await refresh()
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível excluir a categoria.') }
    }
  }

  async function moveChannel(channelId: string, categoryId: string | null, direction: 'up' | 'down') {
    try {
      const siblings = channels.filter((c) => c.category_id === categoryId).sort((a, b) => a.position - b.position)
      const index = siblings.findIndex((c) => c.id === channelId)
      if (index === -1) return { error: null }

      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= siblings.length) return { error: null }

      const reordered = [...siblings]
      ;[reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]]

      const { error } = await supabase.rpc('reorder_channels', {
        p_category_id: categoryId,
        p_channel_ids: reordered.map((c) => c.id),
      })
      if (error) return { error: describeError(error, 'Não foi possível mover o canal.') }
      await refresh()
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível mover o canal.') }
    }
  }

  // Usado pelo arrastar-e-soltar: move um canal pra qualquer categoria
  // (ou sem categoria) e, opcionalmente, insere antes de um canal
  // específico dentro dela. Se não passar beforeChannelId, vai pro fim.
  async function moveChannelToCategory(channelId: string, categoryId: string | null, beforeChannelId?: string | null) {
    try {
      const targetSiblings = channels
        .filter((c) => c.category_id === categoryId && c.id !== channelId)
        .sort((a, b) => a.position - b.position)

      let orderedIds: string[]
      const insertIndex = beforeChannelId ? targetSiblings.findIndex((c) => c.id === beforeChannelId) : -1

      if (insertIndex === -1) {
        orderedIds = [...targetSiblings.map((c) => c.id), channelId]
      } else {
        orderedIds = [
          ...targetSiblings.slice(0, insertIndex).map((c) => c.id),
          channelId,
          ...targetSiblings.slice(insertIndex).map((c) => c.id),
        ]
      }

      const { error } = await supabase.rpc('reorder_channels', {
        p_category_id: categoryId,
        p_channel_ids: orderedIds,
      })
      if (error) return { error: describeError(error, 'Não foi possível mover o canal.') }
      await refresh()
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível mover o canal.') }
    }
  }

  async function moveCategory(categoryId: string, direction: 'up' | 'down') {
    try {
      const sorted = [...categories].sort((a, b) => a.position - b.position)
      const index = sorted.findIndex((c) => c.id === categoryId)
      if (index === -1) return { error: null }

      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= sorted.length) return { error: null }

      const reordered = [...sorted]
      ;[reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]]

      const { error } = await supabase.rpc('reorder_categories', {
        p_server_id: serverId,
        p_category_ids: reordered.map((c) => c.id),
      })
      if (error) return { error: describeError(error, 'Não foi possível mover a categoria.') }
      await refresh()
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível mover a categoria.') }
    }
  }

  return (
    <ChannelsContext.Provider
      value={{
        categories,
        channels,
        loading,
        loadError,
        refresh,
        createChannel,
        updateChannel,
        deleteChannel,
        createCategory,
        updateCategory,
        deleteCategory,
        moveChannel,
        moveChannelToCategory,
        moveCategory,
      }}
    >
      {children}
    </ChannelsContext.Provider>
  )
}
