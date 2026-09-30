import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { normalizeTotpCode } from '../lib/authValidation'
import { AuthAlert, AuthHeader, AuthIcons, AuthShell } from './AuthShell'

export function MfaChallengeScreen() {
  const { verifyMfaChallenge, signOut } = useAuth()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleVerify() {
    if (loading || code.length !== 6) return // evita duplo envio (Enter + clique)
    setLoading(true)
    setError(null)
    const { error } = await verifyMfaChallenge(code)
    setLoading(false)
    if (error) {
      setError(error)
      setCode('')
    }
  }

  return (
    <AuthShell>
      <AuthHeader
        icon={AuthIcons.shield}
        title="Verificação em duas etapas"
        subtitle="Digite o código de 6 dígitos do seu app autenticador."
      />
      <div className="mt-6">
        <label htmlFor="mfa-code" className="field-label">
          Código de verificação
        </label>
        <input
          id="mfa-code"
          value={code}
          onChange={(e) => setCode(normalizeTotpCode(e.target.value))}
          inputMode="numeric"
          autoComplete="one-time-code"
          onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
          placeholder="000000"
          autoFocus
          aria-invalid={!!error}
          className="h-14 w-full bg-mv-canvas px-3 text-center font-mono text-2xl tracking-[0.5em] text-white outline-none"
        />
        <div className="mt-2 flex justify-center gap-1.5" aria-hidden>
          {Array.from({ length: 6 }, (_, n) => (
            <span key={n} className={`h-1 w-6 rounded-full transition-colors ${n < code.length ? 'bg-mv-accent' : 'bg-white/[0.08]'}`} />
          ))}
        </div>
      </div>
      {error && (
        <div className="mt-4">
          <AuthAlert tone="error">{error}</AuthAlert>
        </div>
      )}
      <button
        onClick={handleVerify}
        disabled={code.length < 6 || loading}
        aria-busy={loading}
        className="btn-primary mt-5 flex h-11 w-full items-center justify-center gap-2 text-[15px]"
      >
        {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
        {loading ? 'Verificando...' : 'Verificar'}
      </button>
      <button onClick={() => signOut()} className="btn-ghost mt-2 h-10 w-full text-[13px] font-medium">
        Usar outra conta
      </button>
    </AuthShell>
  )
}
