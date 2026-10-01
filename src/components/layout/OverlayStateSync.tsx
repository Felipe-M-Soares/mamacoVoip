import { useEffect, useState } from 'react'
import { useVoice } from '../../hooks/useVoice'
import { useServerMembers } from '../../hooks/useServerMembers'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'

/** Cor de "falando" do tema atual, já resolvida (rgb), pra janela da sobreposição. */
function speakingColor(): string {
  try {
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-mv-speaking)'
    probe.style.display = 'none'
    document.body.appendChild(probe)
    const css = getComputedStyle(probe).color // pode vir como oklab(...)
    probe.remove()
    // Pinta 1 pixel num canvas e lê de volta: sempre vira rgb simples.
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')
    if (!ctx || !css) return '#22c55e'
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `rgb(${r}, ${g}, ${b})`
  } catch {
    return '#22c55e'
  }
}

export function OverlayStateSync() {
  const { user } = useAuth()
  const voice = useVoice()
  const { theme } = useTheme()
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
      speakingColor: speakingColor(),
      participants,
    })
  }, [voice.connectedChannelId, voice.participants, voice.speaking, voice.muted, voice.deafened, members, channelName, user, theme])

  return null
}
