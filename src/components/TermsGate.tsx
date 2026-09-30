import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { AuthAlert, AuthHeader, AuthShell } from '../pages/AuthShell'
import { TERMS_VERSION } from '../lib/config'
import { acceptCurrentTerms, fetchTermsStatus, takePendingTerms } from '../lib/termsAcceptance'

// Tela bloqueante de aceite dos Termos/Privacidade + "Tenho 18 anos ou
// mais" (ECA Digital / LGPD — o serviço é só para maiores de 18).
// Aparece depois de qualquer login quando a conta ainda não aceitou a
// versão atual (TERMS_VERSION) — em especial contas criadas pelo Google,
// que não passam pelo formulário de cadastro.
//
// Tolerante: se o banco ainda não tem o recurso (coluna/RPC inexistente)
// ou a consulta falhar, NÃO mostra nada — nunca trava o app.

type Status = 'checking' | 'accepted' | 'needed' | 'underage'

const okKey = (userId: string) => `mamacos-terms-ok:${userId}`

function cachedOk(userId: string | undefined): boolean {
  if (!userId) return false
  try {
    return localStorage.getItem(okKey(userId)) === TERMS_VERSION
  } catch {
    return false
  }
}

function markOk(userId: string) {
  try {
    localStorage.setItem(okKey(userId), TERMS_VERSION)
  } catch {
    // ok — só evita uma consulta no próximo login
  }
}

export function TermsGate({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const userId = user?.id
  const email = user?.email ?? null
  const [status, setStatus] = useState<Status>(() => (cachedOk(userId) ? 'accepted' : 'checking'))
  const [checkedFor, setCheckedFor] = useState<string | undefined>(userId)

  // Troca de conta: recomeça a checagem (ajuste de estado durante o render).
  if (checkedFor !== userId) {
    setCheckedFor(userId)
    setStatus(cachedOk(userId) ? 'accepted' : 'checking')
  }

  useEffect(() => {
    if (!userId || status !== 'checking') return
    let cancelled = false
    ;(async () => {
      const current = await fetchTermsStatus(userId)
      if (cancelled) return
      if (current === 'accepted') {
        markOk(userId)
        setStatus('accepted')
        return
      }
      if (current === 'unsupported') {
        // Banco sem o recurso (ou falha de rede): segue sem a tela.
        setStatus('accepted')
        return
      }
      // Aceitou no formulário de cadastro deste aparelho → envia sozinho.
      if (takePendingTerms(email)) {
        const { error } = await acceptCurrentTerms()
        if (cancelled) return
        if (!error) {
          markOk(userId)
          setStatus('accepted')
          return
        }
      }
      setStatus('needed')
    })()
    return () => {
      cancelled = true
    }
  }, [userId, email, status])

  if (status === 'needed' && userId) {
    return (
      <TermsAcceptScreen
        onAccepted={() => {
          markOk(userId)
          setStatus('accepted')
        }}
        onUnderage={() => setStatus('underage')}
      />
    )
  }

  if (status === 'underage') {
    return (
      <AuthShell>
        <AuthHeader title="O Mamacos Voip é só para maiores de 18 anos" />
        <p className="mt-4 text-[14px] leading-relaxed text-mv-muted">
          Os nossos <Link to="/termos" target="_blank" className="font-medium text-mv-accent hover:underline">Termos de Uso</Link>{' '}
          não permitem contas de menores de 18 anos, então não é possível continuar com esta conta. Se ela foi
          criada por engano, você pode pedir a exclusão — veja{' '}
          <Link to="/excluir-conta" target="_blank" className="font-medium text-mv-accent hover:underline">como excluir sua conta</Link>.
        </p>
        <button onClick={() => signOut()} className="btn-primary mt-6 flex h-11 w-full items-center justify-center text-[15px]">
          Sair da conta
        </button>
      </AuthShell>
    )
  }

  return <>{children}</>
}

function TermsAcceptScreen({ onAccepted, onUnderage }: { onAccepted: () => void; onUnderage: () => void }) {
  const { signOut } = useAuth()
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [isAdult, setIsAdult] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAccept() {
    if (!acceptedTerms || !isAdult || loading) return
    setLoading(true)
    setError(null)
    const { error } = await acceptCurrentTerms()
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    onAccepted()
  }

  return (
    <AuthShell>
      <AuthHeader
        title="Antes de continuar"
        subtitle="Precisamos que você confirme sua idade e aceite os Termos de Uso e a Política de Privacidade."
      />
      <div className="mt-6 space-y-3">
        <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-[var(--color-line)] bg-white/[0.02] p-3">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-mv-accent"
          />
          <span className="text-[13px] leading-snug text-mv-muted">
            Eu li e concordo com os{' '}
            <Link to="/termos" target="_blank" className="font-medium text-mv-accent hover:underline">
              Termos de Uso
            </Link>{' '}
            e a{' '}
            <Link to="/privacidade" target="_blank" className="font-medium text-mv-accent hover:underline">
              Política de Privacidade
            </Link>
            .
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-[var(--color-line)] bg-white/[0.02] p-3">
          <input
            type="checkbox"
            checked={isAdult}
            onChange={(e) => setIsAdult(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-mv-accent"
          />
          <span className="text-[13px] leading-snug text-mv-muted">Tenho 18 anos ou mais.</span>
        </label>

        {error && <AuthAlert tone="error">{error}</AuthAlert>}

        <button
          onClick={handleAccept}
          disabled={!acceptedTerms || !isAdult || loading}
          aria-busy={loading}
          className="btn-primary flex h-11 w-full items-center justify-center gap-2 text-[15px] disabled:opacity-60"
        >
          {loading ? 'Salvando...' : 'Aceitar e continuar'}
        </button>
        <button onClick={onUnderage} className="btn-secondary flex h-10 w-full items-center justify-center text-[14px]">
          Não tenho 18 anos
        </button>
        <button onClick={() => signOut()} className="w-full text-center text-[13px] text-mv-muted hover:text-mv-text hover:underline">
          Sair da conta
        </button>
      </div>
    </AuthShell>
  )
}
