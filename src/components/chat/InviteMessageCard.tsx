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
    return <p className="chip">Convite recusado</p>
  }

  return (
    <div className="bg-discord-darker rounded-xl p-3.5 max-w-xs border border-[var(--color-line)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-discord-text-muted mb-2">Convite</p>
      <div className="flex items-center gap-3 mb-3">
        <span className="w-10 h-10 rounded-xl bg-brand-gradient flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white">
          <path d="M15 12a5 5 0 1 0-4.9-6H9a1 1 0 1 0 0 2h1.1c.1.4.2.7.4 1H9a1 1 0 1 0 0 2h2.5c.9.6 2 1 3.2 1zM3 20a6 6 0 0 1 6-6h1a6 6 0 0 1 6 6 1 1 0 1 1-2 0 4 4 0 0 0-4-4H9a4 4 0 0 0-4 4 1 1 0 1 1-2 0z" />
        </svg>
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{invite.serverName}</p>
          {invite.channelName && (
            <p className="text-xs text-discord-text-muted truncate">Sala de voz: {invite.channelName}</p>
          )}
        </div>
      </div>
      {status === 'error' && <p className="text-xs text-rose-400 mb-2">{error}</p>}
      {status !== 'accepted' && (
        <div className="flex gap-2">
          <button
            onClick={handleAccept}
            disabled={status === 'loading'}
            className="flex-1 h-9 rounded-[10px] bg-discord-green text-white text-sm font-semibold hover:brightness-110 transition disabled:opacity-60"
          >
            {status === 'loading' ? 'Entrando...' : 'Aceitar'}
          </button>
          <button
            onClick={() => setStatus('declined')}
            disabled={status === 'loading'}
            className="flex-1 h-9 btn-secondary text-sm"
          >
            Recusar
          </button>
        </div>
      )}
    </div>
  )
}
