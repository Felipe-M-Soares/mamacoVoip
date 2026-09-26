import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'

export function MfaChallengeScreen() {
  const { verifyMfaChallenge, signOut } = useAuth()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleVerify() {
    if (code.trim().length < 6) return
    setLoading(true)
    setError(null)
    const { error } = await verifyMfaChallenge(code)
    setLoading(false)
    if (error) setError(error)
  }

  return (
    <div className="min-h-full bg-discord-darker flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-discord-dark rounded-2xl shadow-2xl border border-discord-blurple/10 p-6 text-center">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 text-discord-blurple mx-auto mb-3">
          <path d="M12 2a5 5 0 0 0-5 5v3H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-1V7a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3z" />
        </svg>
        <h1 className="text-lg font-bold text-white mb-1">Verificação em duas etapas</h1>
        <p className="text-sm text-discord-text-muted mb-4">
          Digite o código de 6 dígitos do seu app autenticador.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
          placeholder="000000"
          autoFocus
          className="w-full px-3 py-3 text-center text-2xl tracking-[0.4em] rounded bg-discord-darker text-white border-none outline-none focus:ring-2 focus:ring-discord-blurple mb-3 font-mono"
        />
        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        <button
          onClick={handleVerify}
          disabled={code.length < 6 || loading}
          className="w-full py-2.5 rounded btn-primary disabled:opacity-60 mb-2"
        >
          {loading ? 'Verificando...' : 'Verificar'}
        </button>
        <button onClick={() => signOut()} className="text-xs text-discord-text-muted hover:underline">
          Usar outra conta
        </button>
      </div>
    </div>
  )
}
