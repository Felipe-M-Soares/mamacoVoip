import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
// Última lista de canais/categorias vista de cada servidor (só em
// memória). O provider é recriado a cada troca de servidor
// (key={server.id}); sem isso, voltar pra um servidor já aberto mostrava
// o skeleton e esperava a ida ao servidor de novo antes de qualquer canal
// aparecer. Agora mostra na hora e revalida em segundo plano.
const channelsCache = new Map<string, { categories: Category[]; channels: Channel[] }>()

export function ChannelsProvider({ serverId, children }: { serverId: string; children: ReactNode }) {
  // Chave inclui o usuário: outra conta no mesmo computador nunca vê a
  // lista (com canais restritos) que a anterior tinha em cache.
  const cacheKey = `${useAuth().user?.id ?? ''}|${serverId}`
  const [initialCache] = useState(() => channelsCache.get(cacheKey))
  const [categories, setCategories] = useState<Category[]>(() => initialCache?.categories ?? [])
  const [channels, setChannels] = useState<Channel[]>(() => initialCache?.channels ?? [])
  const [loading, setLoading] = useState(!initialCache)
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
  const loadSeqRef = useRef(0)
  const hasLoadedRef = useRef(Boolean(initialCache))
  const refresh = useCallback(async () => {
    const seq = ++loadSeqRef.current
    // Skeleton só na PRIMEIRA carga (ou depois de um erro). Antes toda
    // ação (criar/renomear/mover canal) trocava a barra lateral inteira
    // pelo skeleton por um instante.
    if (!hasLoadedRef.current) setLoading(true)
    try {
      const [catsRes, chansRes] = await Promise.all([
        supabase.from('categories').select('*').eq('server_id', serverId).order('position'),
        supabase.from('channels').select('*').eq('server_id', serverId).order('position'),
      ])
      if (catsRes.error) throw catsRes.error
      if (chansRes.error) throw chansRes.error
      // Duas ações seguidas (ex.: mover canal duas vezes rápido) disparam
      // dois refresh — só a resposta mais nova vale.
      if (seq !== loadSeqRef.current) return
      setCategories(catsRes.data ?? [])
      setChannels(chansRes.data ?? [])
      channelsCache.set(cacheKey, { categories: catsRes.data ?? [], channels: chansRes.data ?? [] })
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

  // Ponto central: se o insert falhar de um jeito que o supabase-js não
  // resolve como { error } (rejeição de rede, por exemplo), esse
  // try/catch garante que quem chamou SEMPRE recebe uma mensagem de
  // erro de volta em vez de uma exceção não tratada — que no modal de
  // criar canal virava "sem erro, mas o canal nunca aparece".
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
      // Sala de voz (que não é palco) nasce junto com um chat de texto de
      // mesmo nome na mesma categoria — se ainda não existir um.
      if (type === 'voice' && !isStage) {
        const textName = channelNameFor('text', name)
        if (!siblings.some((c) => c.type === 'text' && c.name === textName)) {
          rows.push({ server_id: serverId, name: textName, type: 'text', category_id: categoryId, position, is_stage: false, user_limit: 0 })
        }
      }
      // is_nsfw só vai no insert quando ligado: assim criar canal comum
      // continua funcionando mesmo num banco que ainda não rodou a 015.
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
      // Na lista os canais de texto vêm antes das salas de voz: só troca de
      // lugar com um vizinho do MESMO tipo.
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

  // Usado pelo arrastar-e-soltar: move um canal pra qualquer categoria
  // (ou sem categoria) e, opcionalmente, insere antes de um canal
  // específico dentro dela. Se não passar beforeChannelId, vai pro fim.
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

  // Valor memoizado: antes era um objeto novo a cada render do provider,
  // re-renderizando todo consumidor de useChannels() (sidebar, chat, modais)
  // sem necessidade. As ações dependem só de channels/categories/serverId/
  // refresh, que estão nas dependências.
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
