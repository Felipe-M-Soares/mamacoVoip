import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Category, Channel, ChannelType } from '../types/database'

interface ChannelsContextValue {
  categories: Category[]
  channels: Channel[]
  loading: boolean
  refresh: () => Promise<void>
  createChannel: (name: string, type: ChannelType, categoryId: string | null) => Promise<{ error: string | null }>
  updateChannel: (channelId: string, updates: { name?: string }) => Promise<{ error: string | null }>
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

// Um Provider por servidor: o MainLayout monta este componente com
// key={server.id}, então trocar de servidor naturalmente reinicia o
// estado (sem vazar canais de um servidor pro outro) e, dentro do MESMO
// servidor, toda a árvore (sidebar, modais, área de chat) compartilha
// exatamente a mesma lista — igual ao ServersContext.
export function ChannelsProvider({ serverId, children }: { serverId: string; children: ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [{ data: cats }, { data: chans }] = await Promise.all([
      supabase.from('categories').select('*').eq('server_id', serverId).order('position'),
      supabase.from('channels').select('*').eq('server_id', serverId).order('position'),
    ])
    setCategories(cats ?? [])
    setChannels(chans ?? [])
    setLoading(false)
  }, [serverId])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function createChannel(name: string, type: ChannelType, categoryId: string | null) {
    const position = channels.filter((c) => c.category_id === categoryId).length
    const { error } = await supabase
      .from('channels')
      .insert({ server_id: serverId, name, type, category_id: categoryId, position })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function updateChannel(channelId: string, updates: { name?: string }) {
    const { error } = await supabase.from('channels').update(updates).eq('id', channelId)
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function deleteChannel(channelId: string) {
    const { error } = await supabase.from('channels').delete().eq('id', channelId)
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function createCategory(name: string) {
    const position = categories.length
    const { error } = await supabase.from('categories').insert({ server_id: serverId, name, position })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function updateCategory(categoryId: string, name: string) {
    const { error } = await supabase.from('categories').update({ name }).eq('id', categoryId)
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function deleteCategory(categoryId: string) {
    const { error } = await supabase.from('categories').delete().eq('id', categoryId)
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function moveChannel(channelId: string, categoryId: string | null, direction: 'up' | 'down') {
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
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  // Usado pelo arrastar-e-soltar: move um canal pra qualquer categoria
  // (ou sem categoria) e, opcionalmente, insere antes de um canal
  // específico dentro dela. Se não passar beforeChannelId, vai pro fim.
  async function moveChannelToCategory(channelId: string, categoryId: string | null, beforeChannelId?: string | null) {
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
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function moveCategory(categoryId: string, direction: 'up' | 'down') {
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
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  return (
    <ChannelsContext.Provider
      value={{
        categories,
        channels,
        loading,
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
