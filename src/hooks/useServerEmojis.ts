import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ServerEmoji } from '../types/database'

export function useServerEmojis(serverId: string | null) {
  const [emojis, setEmojis] = useState<ServerEmoji[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!serverId) {
      setEmojis([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data } = await supabase
      .from('server_emojis')
      .select('*')
      .eq('server_id', serverId)
      .order('created_at', { ascending: true })
    setEmojis(data ?? [])
    setLoading(false)
  }, [serverId])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function uploadEmoji(name: string, file: File): Promise<{ error: string | null }> {
    if (!serverId) return { error: 'Nenhum servidor selecionado' }
    const cleanName = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
    if (cleanName.length < 2) return { error: 'O nome precisa ter pelo menos 2 letras/números.' }
    if (file.size > 256 * 1024) return { error: 'A imagem precisa ter no máximo 256KB.' }

    const ext = file.name.split('.').pop()
    const path = `${serverId}/emoji-${cleanName}-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage.from('server-icons').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })
    if (uploadError) return { error: uploadError.message }

    const { data: urlData } = supabase.storage.from('server-icons').getPublicUrl(path)
    const { error } = await supabase
      .from('server_emojis')
      .insert({ server_id: serverId, name: cleanName, image_url: urlData.publicUrl })
    if (error) return { error: error.message.includes('duplicate') ? 'Já existe um emoji com esse nome.' : error.message }
    await refresh()
    return { error: null }
  }

  async function deleteEmoji(emojiId: string) {
    const { error } = await supabase.from('server_emojis').delete().eq('id', emojiId)
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  return { emojis, loading, uploadEmoji, deleteEmoji }
}
