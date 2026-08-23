import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function InviteRedirect() {
  const { code } = useParams<{ code: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return

    supabase
      .rpc('join_server_via_invite', { p_code: code })
      .then(({ data: server, error }) => {
        if (error || !server) {
          setError(error?.message ?? 'Convite inválido ou expirado.')
          return
        }
        const channelId = searchParams.get('canal')
        // Mesma lógica do InviteMessageCard.tsx — o MainLayout confere se
        // o canal é de voz antes de entrar de verdade.
        navigate('/', {
          replace: true,
          state: { joinedServerId: server.id, joinedChannelId: channelId, autoJoinVoice: Boolean(channelId) },
        })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  return (
    <div className="min-h-screen bg-discord-darker flex items-center justify-center p-4">
      <div className="bg-discord-dark rounded-xl shadow-2xl w-full max-w-md p-8 text-center border border-white/5">
        {error ? (
          <>
            <h1 className="font-display text-2xl font-bold text-white tracking-wide">Não foi possível entrar</h1>
            <p className="text-discord-text-muted mt-3">{error}</p>
            <button
              onClick={() => navigate('/')}
              className="mt-5 px-5 py-2.5 rounded btn-primary"
            >
              Voltar pro app
            </button>
          </>
        ) : (
          <>
            <div className="w-8 h-8 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-discord-text-muted">Entrando no servidor...</p>
          </>
        )}
      </div>
    </div>
  )
}
