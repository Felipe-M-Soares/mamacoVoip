import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { prepareIconImage } from '../lib/iconImage'
import { readStartupCache, writeStartupCache } from '../lib/startupCache'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errors'
import { channelNameFor, orderChannels } from '../lib/channelName'
import { useAuth } from '../hooks/useAuth'
import type { Category, Channel, ChannelType } from '../types/database'

interface ChannelsContextValue {
  categories: Category[]
  channels: Channel[]
  loading: boolean
  loadError: string | null
  refresh: () => Promise<void>
  createChannel: (
    name: string,
    type: ChannelType,
    categoryId: string | null,
    isStage?: boolean,
    userLimit?: number,
    isNsfw?: boolean
  ) => Promise<{ error: string | null }>
  updateChannel: (channelId: string, updates: { name?: string; topic?: string | null; is_stage?: boolean; slowmode_seconds?: number; is_spoiler?: boolean; user_limit?: number; is_restricted?: boolean; is_nsfw?: boolean }) => Promise<{ error: string | null }>
  deleteChannel: (channelId: string) => Promise<{ error: string | null }>
  createCategory: (name: string) => Promise<{ error: string | null }>
  updateCategory: (categoryId: string, name: string) => Promise<{ error: string | null }>
  setCategoryGame: (categoryId: string, game: string | null) => Promise<{ error: string | null }>
  setCategoryIcon: (categoryId: string, file: File | null) => Promise<{ error: string | null }>
  deleteCategory: (categoryId: string, alsoChannels?: boolean) => Promise<{ error: string | null }>
  moveChannel: (channelId: string, categoryId: string | null, direction: 'up' | 'down') => Promise<{ error: string | null }>
  moveChannelToCategory: (
    channelId: string,
    categoryId: string | null,
    beforeChannelId?: string | null
  ) => Promise<{ error: string | null }>
  moveCategory: (categoryId: string, direction: 'up' | 'down') => Promise<{ error: string | null }>
}

export const ChannelsContext = createContext<ChannelsContextValue | undefined>(undefined)

const channelsCache = new Map<string, { categories: Category[]; channels: Channel[] }>()

export function ChannelsProvider({ serverId, children }: { serverId: string; children: ReactNode }) {
  const cacheKey = `${useAuth().user?.id ?? ''}|${serverId}`
  const [initialCache] = useState(
    () =>
      channelsCache.get(cacheKey) ??
      readStartupCache<{ categories: Category[]; channels: Channel[] }>(`channels:${cacheKey}`) ??
      undefined
  )
  const [categories, setCategories] = useState<Category[]>(() => initialCache?.categories ?? [])
  const [channels, setChannels] = useState<Channel[]>(() => initialCache?.channels ?? [])
  const [loading, setLoading] = useState(!initialCache)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadSeqRef = useRef(0)
  const hasLoadedRef = useRef(Boolean(initialCache))
  const refresh = useCallback(async () => {
    const seq = ++loadSeqRef.current
    if (!hasLoadedRef.current) setLoading(true)
    try {
      const [catsRes, chansRes] = await Promise.all([
        supabase.from('categories').select('*').eq('server_id', serverId).order('position'),
        supabase.from('channels').select('*').eq('server_id', serverId).order('position'),
      ])
      if (catsRes.error) throw catsRes.error
      if (chansRes.error) throw chansRes.error
      if (seq !== loadSeqRef.current) return
      setCategories(catsRes.data ?? [])
      setChannels(chansRes.data ?? [])
      channelsCache.set(cacheKey, { categories: catsRes.data ?? [], channels: chansRes.data ?? [] })
      writeStartupCache(`channels:${cacheKey}`, { categories: catsRes.data ?? [], channels: chansRes.data ?? [] })
      setLoadError(null)
      hasLoadedRef.current = true
    } catch (err) {
      if (seq !== loadSeqRef.current) return
      setLoadError(describeError(err, 'Não foi possível carregar os canais.'))
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [serverId, cacheKey])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function createChannel(name: string, type: ChannelType, categoryId: string | null, isStage = false, userLimit = 0, isNsfw = false) {
    try {
      const siblings = channels.filter((c) => c.category_id === categoryId)
      const position = siblings.reduce((m, c) => Math.max(m, c.position + 1), 0)
      const rows: Array<{
        server_id: string
        name: string
        type: ChannelType
        category_id: string | null
        position: number
        is_stage: boolean
        user_limit: number
        is_nsfw?: boolean
      }> = []
      if (type === 'voice' && !isStage) {
        const textName = channelNameFor('text', name)
        if (!siblings.some((c) => c.type === 'text' && c.name === textName)) {
          rows.push({ server_id: serverId, name: textName, type: 'text', category_id: categoryId, position, is_stage: false, user_limit: 0 })
        }
      }
      rows.push({ server_id: serverId, name, type, category_id: categoryId, position: position + rows.length, is_stage: isStage, user_limit: userLimit, ...(isNsfw ? { is_nsfw: true } : {}) })
      const { error } = await supabase.from('channels').insert(rows)
      if (error) return { error: describeError(error, 'Não foi possível criar o canal.') }
      await refresh()
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível criar o canal.') }
    }
  }

  async function updateChannel(channelId: string, updates: { name?: string; topic?: string | null; is_stage?: boolean; slowmode_seconds?: number; is_spoiler?: boolean; user_limit?: number; is_restricted?: boolean; is_nsfw?: boolean }) {
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

  async function setCategoryGame(categoryId: string, game: string | null) {
    try {
      const { error } = await supabase.from('categories').update({ game }).eq('id', categoryId)
      if (error) {
        if (/game/i.test(error.message) && /column|schema/i.test(error.message)) {
          return { error: 'Não foi possível salvar o jogo da categoria agora. Tente de novo mais tarde.' }
        }
        return { error: describeError(error, 'Não foi possível salvar o jogo da categoria.') }
      }
      await refresh()
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível salvar o jogo da categoria.') }
    }
  }

  async function setCategoryIcon(categoryId: string, file: File | null) {
    try {
      let url: string | null = null
      if (file) {
        const prepared = await prepareIconImage(file)
        if (!prepared.file) return { error: prepared.error }
        const path = `${serverId}/categorias/${categoryId}-${Date.now()}.png`
        const { error: upErr } = await supabase.storage
          .from('server-icons')
          .upload(path, prepared.file, { cacheControl: '31536000', upsert: false, contentType: 'image/png' })
        if (upErr) {
          return {
            error: /row-level|policy|unauthorized|403/i.test(upErr.message)
              ? 'Você não tem permissão pra enviar a imagem.'
              : describeError(upErr, 'Não foi possível enviar a imagem.'),
          }
        }
        url = supabase.storage.from('server-icons').getPublicUrl(path).data.publicUrl
      }
      const { error } = await supabase.from('categories').update({ icon_url: url }).eq('id', categoryId)
      if (error) {
        if (/icon_url/i.test(error.message) && /column|schema/i.test(error.message)) {
          return { error: 'Não foi possível salvar a imagem agora. Tente de novo mais tarde.' }
        }
        return { error: describeError(error, 'Não foi possível salvar a imagem da categoria.') }
      }
      await refresh()
      return { error: null }
    } catch (err) {
      return { error: describeError(err, 'Não foi possível salvar a imagem da categoria.') }
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

  async function deleteCategory(categoryId: string, alsoChannels = false) {
    try {
      if (alsoChannels) {
        const ids = channels.filter((c) => c.category_id === categoryId).map((c) => c.id)
        if (ids.length) {
          const { error: chErr } = await supabase.from('channels').delete().in('id', ids)
          if (chErr) return { error: describeError(chErr, 'Não foi possível excluir os canais da categoria.') }
        }
      }
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
      const groups = orderChannels(channels.filter((c) => c.category_id === categoryId))
      const siblings = [...groups.text, ...groups.voice]
      const index = siblings.findIndex((c) => c.id === channelId)
      if (index === -1) return { error: null }

      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= siblings.length) return { error: null }
      if (siblings[targetIndex].type !== siblings[index].type) return { error: null }

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

  async function moveChannelToCategory(channelId: string, categoryId: string | null, beforeChannelId?: string | null) {
    try {
      const targetGroups = orderChannels(channels.filter((c) => c.category_id === categoryId && c.id !== channelId))
      const targetSiblings = [...targetGroups.text, ...targetGroups.voice]

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

  const value = useMemo(
    () => ({
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
      setCategoryGame,
      setCategoryIcon,
      deleteCategory,
      moveChannel,
      moveChannelToCategory,
      moveCategory,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categories, channels, loading, loadError, refresh]
  )

  return <ChannelsContext.Provider value={value}>{children}</ChannelsContext.Provider>
}
