import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useChannelMutes() {
  const { user } = useAuth()
  const [mutedChannelIds, setMutedChannelIds] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    if (!user) {
      setMutedChannelIds(new Set())
      return
    }
    const { data } = await supabase.from('channel_mutes').select('channel_id').eq('user_id', user.id)
    setMutedChannelIds(new Set((data ?? []).map((r) => r.channel_id)))
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function toggleChannelMute(channelId: string) {
    if (!user) return
    const isMuted = mutedChannelIds.has(channelId)
    if (isMuted) {
      await supabase.from('channel_mutes').delete().eq('user_id', user.id).eq('channel_id', channelId)
    } else {
      await supabase.from('channel_mutes').insert({ user_id: user.id, channel_id: channelId })
    }
    await refresh()
  }

  return { mutedChannelIds, toggleChannelMute }
}
