import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isValidInviteCode } from '../lib/authValidation'

// Mensagens que o próprio banco manda (join_server_via_invite) e que
// podem ir direto pra tela; qualquer outro erro vira um texto genérico
// (não mostra detalhe interno de SQL/RLS pra quem clicou no link).
function friendlyInviteError(message: string | undefined): string {
  if (!message) return 'Convite inválido ou expirado.'
  if (/banido/i.test(message)) return 'Você foi banido deste servidor.'
  if (/tentativas|aguarde/i.test(message)) return message
  if (/inválido|expirado/i.test(message)) return 'Convite inválido ou expirado.'
  if (/failed to fetch|network/i.test(message)) return 'Sem conexão com o servidor. Tente de novo.'
  return 'Não foi possível usar este convite.'
}

export function InviteRedirect() {
  const { code } = useParams<{ code: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  // Em modo estrito (dev) o efeito roda duas vezes — sem essa trava, o
  // convite era "gasto" em dobro (uses + 2), o que esgota convites de uso
  // único/limitado.
  const startedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!code) return
    if (startedRef.current === code) return
    startedRef.current = code

    if (!isValidInviteCode(code)) {
      setError('Convite inválido ou expirado.')
      return
    }

    supabase
      .rpc('join_server_via_invite', { p_code: code })
      .then(({ data: server, error }) => {
        if (error || !server) {
          setError(friendlyInviteError(error?.message))
          return
        }
        const rawChannelId = searchParams.get('canal')
        // Só aceita um UUID aqui — o valor vem da URL do link.
        const channelId =
          rawChannelId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawChannelId)
            ? rawChannelId
            : null
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
    <div className="auth-backdrop relative flex min-h-full items-center justify-center p-4">
      <div aria-hidden className="auth-grid pointer-events-none absolute inset-0" />
      <div className="surface-elevated animate-pop-in relative w-full max-w-sm rounded-2xl p-8 text-center">
        {error ? (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400 ring-1 ring-inset ring-rose-500/25">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4.5M12 16h.01" />
              </svg>
            </div>
            <h1 className="font-display text-xl font-semibold text-white">Não foi possível entrar</h1>
            <p className="mt-2 text-[14px] text-mv-muted" role="alert">{error}</p>
            <button onClick={() => navigate('/')} className="btn-primary mt-6 h-10 w-full px-5 text-[14px]">
              Voltar pro app
            </button>
          </>
        ) : (
          <div role="status" aria-live="polite">
            <div className="relative mx-auto mb-5 h-16 w-16">
              <img src="/logo.png" alt="" className="h-16 w-16 rounded-2xl object-cover ring-1 ring-[var(--color-line-strong)]" />
              <span className="absolute -inset-1.5 animate-spin rounded-[22px] border-2 border-mv-accent/70 border-t-transparent border-l-transparent" aria-hidden />
            </div>
            <h1 className="font-display text-lg font-semibold text-white">Entrando no servidor...</h1>
            <p className="mt-1 text-[13px] text-mv-muted">Só um instante, estamos validando o convite.</p>
          </div>
        )}
      </div>
    </div>
  )
}
