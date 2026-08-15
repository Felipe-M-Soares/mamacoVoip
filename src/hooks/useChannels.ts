import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Category, Channel, ChannelType } from '../types/database'

export function useChannels(serverId: string | null) {
  const [categories, setCategories] = useState<Category[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!serverId) {
      setCategories([])
      setChannels([])
      setLoading(false)
      return
    }
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
    if (!serverId) return { error: 'Nenhum servidor selecionado' }
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
    if (!serverId) return { error: 'Nenhum servidor selecionado' }
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
    // canais dentro da categoria ficam "sem categoria" (ON DELETE SET NULL)
    const { error } = await supabase.from('categories').delete().eq('id', categoryId)
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function moveChannel(channelId: string, categoryId: string | null, direction: 'up' | 'down') {
    const siblings = channels
      .filter((c) => c.category_id === categoryId)
      .sort((a, b) => a.position - b.position)
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

  async function moveCategory(categoryId: string, direction: 'up' | 'down') {
    if (!serverId) return { error: 'Nenhum servidor selecionado' }
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

  return {
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
    moveCategory,
  }
}
