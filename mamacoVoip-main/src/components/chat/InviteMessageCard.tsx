import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { InvitePayload } from '../../lib/inviteMessage'

export function InviteMessageCard({ invite }: { invite: InvitePayload }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'pending' | 'loading' | 'accepted' | 'declined' | 'error'>('pending')
  const [error, setError] = useState<string | null>(null)

  async function handleAccept() {
    setStatus('loading')
    setError(null)
    const { data: server, error } = await supabase.rpc('join_server_via_invite', { p_code: invite.code })
    if (error || !server) {
      setError(error?.message ?? 'Convite inválido ou expirado.')
      setStatus('error')
      return
    }
    setStatus('accepted')
    // autoJoinVoice: true sempre que o convite trouxer um canal — o
    // MainLayout do outro lado confere se esse canal é mesmo de VOZ
    // antes de entrar de verdade (convite de canal de texto só navega
    // até lá, sem tentar conectar em nada). Isso que faz "chamar pra
    // sala" (VoiceChannelView/FriendsPanel) já cair direto na call ao
    // aceitar, em vez de precisar clicar em "Entrar no canal de voz"
    // depois.
    navigate('/', {
      state: { joinedServerId: server.id, joinedChannelId: invite.channelId ?? null, autoJoinVoice: Boolean(invite.channelId) },
    })
  }

  if (status === 'declined') {
    return <p className="text-xs text-discord-text-muted italic">Convite recusado.</p>
  }

  return (
    <div className="bg-discord-darker rounded-lg p-3 max-w-xs border border-white/5">
      <div className="flex items-center gap-2 mb-1">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-discord-blurple shrink-0">
          <path d="M15 12a5 5 0 1 0-4.9-6H9a1 1 0 1 0 0 2h1.1c.1.4.2.7.4 1H9a1 1 0 1 0 0 2h2.5c.9.6 2 1 3.2 1zM3 20a6 6 0 0 1 6-6h1a6 6 0 0 1 6 6 1 1 0 1 1-2 0 4 4 0 0 0-4-4H9a4 4 0 0 0-4 4 1 1 0 1 1-2 0z" />
        </svg>
        <p className="text-sm font-medium text-white">Convite pra {invite.serverName}</p>
      </div>
      {invite.channelName && (
        <p className="text-xs text-discord-text-muted mb-2">Sala de voz: {invite.channelName}</p>
      )}
      {status === 'error' && <p className="text-xs text-red-400 mb-2">{error}</p>}
      {status !== 'accepted' && (
        <div className="flex gap-2">
          <button
            onClick={handleAccept}
            disabled={status === 'loading'}
            className="flex-1 py-1.5 rounded bg-discord-green text-white text-xs font-medium hover:brightness-110 transition-colors disabled:opacity-60"
          >
            {status === 'loading' ? 'Entrando...' : 'Aceitar'}
          </button>
          <button
            onClick={() => setStatus('declined')}
            disabled={status === 'loading'}
            className="flex-1 py-1.5 rounded bg-discord-lighter text-discord-text text-xs font-medium hover:bg-discord-channels transition-colors disabled:opacity-60"
          >
            Recusar
          </button>
        </div>
      )}
    </div>
  )
}
