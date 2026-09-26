import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export type NotificationLevel = 'all' | 'mentions' | 'muted'

export function useChannelMutes() {
  const { user } = useAuth()
  const [levels, setLevels] = useState<Record<string, NotificationLevel>>({})

  const refresh = useCallback(async () => {
    if (!user) {
      setLevels({})
      return
    }
    const { data } = await supabase.from('channel_mutes').select('channel_id, mentions_only').eq('user_id', user.id)
    const map: Record<string, NotificationLevel> = {}
    for (const row of data ?? []) {
      map[row.channel_id] = row.mentions_only ? 'mentions' : 'muted'
    }
    setLevels(map)
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function setNotificationLevel(channelId: string, level: NotificationLevel) {
    if (!user) return
    if (level === 'all') {
      await supabase.from('channel_mutes').delete().eq('user_id', user.id).eq('channel_id', channelId)
    } else {
      await supabase
        .from('channel_mutes')
        .upsert({ user_id: user.id, channel_id: channelId, mentions_only: level === 'mentions' })
    }
    await refresh()
  }

  // Mantido pra compatibilidade com o que já usava isso — considera
  // "silenciado" tanto o modo totalmente mudo quanto o só-menções,
  // já que os dois pulam a notificação de mensagem comum.
  const mutedChannelIds = new Set(Object.keys(levels))

  async function toggleChannelMute(channelId: string) {
    const current = levels[channelId] ?? 'all'
    await setNotificationLevel(channelId, current === 'all' ? 'muted' : 'all')
  }

  function getLevel(channelId: string): NotificationLevel {
    return levels[channelId] ?? 'all'
  }

  return { mutedChannelIds, levels, getLevel, toggleChannelMute, setNotificationLevel }
}
