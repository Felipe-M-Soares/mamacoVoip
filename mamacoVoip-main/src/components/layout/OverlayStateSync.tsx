import { useEffect, useState } from 'react'
import { useVoice } from '../../hooks/useVoice'
import { useServerMembers } from '../../hooks/useServerMembers'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export function OverlayStateSync() {
  const { user } = useAuth()
  const voice = useVoice()
  const { members } = useServerMembers(voice.connectedServerId)
  const [channelName, setChannelName] = useState<string | null>(null)

  useEffect(() => {
    if (!voice.connectedChannelId) {
      setChannelName(null)
      return
    }
    supabase
      .from('channels')
      .select('name')
      .eq('id', voice.connectedChannelId)
      .single()
      .then(({ data }) => setChannelName(data?.name ?? null))
  }, [voice.connectedChannelId])

  useEffect(() => {
    if (!window.electronAPI?.sendVoiceStateToOverlay) return

    if (!voice.connectedChannelId) {
      window.electronAPI.sendVoiceStateToOverlay({ connected: false })
      return
    }

    const profileById = Object.fromEntries(members.map((m) => [m.user_id, m.profile]))
    const participants = [
      {
        name: 'Você',
        avatarUrl: null,
        speaking: voice.speaking,
        muted: voice.muted,
      },
      ...Object.entries(voice.participants).map(([userId, p]) => {
        const profile = profileById[userId]
        return {
          name: profile?.display_name || profile?.username || '...',
          avatarUrl: profile?.avatar_url ?? null,
          speaking: p.speaking,
          muted: false,
        }
      }),
    ]

    window.electronAPI.sendVoiceStateToOverlay({
      connected: true,
      channelName,
      participants,
    })
  }, [voice.connectedChannelId, voice.participants, voice.speaking, voice.muted, members, channelName, user])

  return null
}
