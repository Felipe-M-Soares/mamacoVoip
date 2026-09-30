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
    const selfProfile = user ? profileById[user.id] : undefined
    const participants = [
      {
        name: 'Você',
        avatarUrl: selfProfile?.avatar_url ?? null,
        // Ensurdecido também silencia o microfone — o selo mostra o fone.
        speaking: voice.speaking && !voice.muted && !voice.deafened,
        muted: voice.muted,
        deafened: voice.deafened,
      },
      ...Object.entries(voice.participants).map(([userId, p]) => {
        const profile = profileById[userId]
        return {
          name: profile?.display_name || profile?.username || '...',
          avatarUrl: profile?.avatar_url ?? null,
          speaking: p.speaking,
          // O estado de mudo/ensurdecido dos OUTROS não é sincronizado
          // pela call hoje — só o "falando" (que já some quando a pessoa
          // está muda).
          muted: false,
          deafened: false,
        }
      }),
    ]

    window.electronAPI.sendVoiceStateToOverlay({
      connected: true,
      channelName,
      participants,
    })
  }, [voice.connectedChannelId, voice.participants, voice.speaking, voice.muted, voice.deafened, members, channelName, user])

  return null
}
