import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface EnrolledFactor {
  id: string
  friendly_name?: string | null
  factor_type: string
}

export function SecurityTab() {
  const [factors, setFactors] = useState<EnrolledFactor[]>([])
  const [loading, setLoading] = useState(true)
  const [enrolling, setEnrolling] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [pendingFactorId, setPendingFactorId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refreshFactors() {
    setLoading(true)
    const { data } = await supabase.auth.mfa.listFactors()
    setFactors(data?.totp ?? [])
    setLoading(false)
  }

  useEffect(() => {
    refreshFactors()
  }, [])

  async function startEnroll() {
    setError(null)
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Autenticador' })
    if (error) {
      setError(error.message)
      return
    }
    setQrCode(data.totp.qr_code)
    setSecret(data.totp.secret)
    setPendingFactorId(data.id)
    setEnrolling(true)
  }

  async function confirmEnroll() {
    if (!pendingFactorId || code.trim().length < 6) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: pendingFactorId, code: code.trim() })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setEnrolling(false)
    setQrCode(null)
    setSecret(null)
    setPendingFactorId(null)
    setCode('')
    await refreshFactors()
  }

  function cancelEnroll() {
    setEnrolling(false)
    setQrCode(null)
    setSecret(null)
    setPendingFactorId(null)
    setCode('')
    setError(null)
  }

  async function removeFactor(factorId: string) {
    if (!confirm('Remover a verificação em duas etapas dessa conta?')) return
    setBusy(true)
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    await refreshFactors()
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
          Verificação em duas etapas
        </label>
        <p className="text-xs text-discord-text-muted mb-3">
          Adiciona uma camada extra de segurança — além da senha, você precisa de um código gerado por um app
          autenticador (Google Authenticator, Authy, etc.) pra entrar na conta.
        </p>

        {loading ? (
          <div className="w-5 h-5 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
        ) : factors.length > 0 ? (
          <div className="space-y-2">
            {factors.map((f) => (
              <div key={f.id} className="flex items-center justify-between bg-discord-darker rounded-lg px-3 py-2.5">
                <span className="text-sm text-discord-text flex items-center gap-2">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-discord-green">
                    <path d="M9 16.2l-3.5-3.5-1.4 1.4L9 19 20 8l-1.4-1.4z" />
                  </svg>
                  {f.friendly_name || 'Autenticador'} — ativado
                </span>
                <button
                  onClick={() => removeFactor(f.id)}
                  disabled={busy}
                  className="text-xs text-red-400 hover:underline disabled:opacity-60"
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        ) : enrolling ? (
          <div className="bg-discord-darker rounded-lg p-4 space-y-3">
            {qrCode && (
              <div className="flex justify-center bg-white rounded-lg p-3">
                <img src={qrCode} alt="QR code de configuração" className="w-40 h-40" />
              </div>
            )}
            {secret && (
              <p className="text-xs text-discord-text-muted text-center">
                Não consegue escanear? Digite o código manualmente:{' '}
                <span className="font-mono text-discord-text break-all">{secret}</span>
              </p>
            )}
            <p className="text-xs text-discord-text-muted">
              Escaneie com seu app autenticador e digite o código de 6 dígitos gerado:
            </p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && confirmEnroll()}
              placeholder="000000"
              autoFocus
              className="w-full px-3 py-2.5 text-center text-xl tracking-[0.3em] rounded bg-discord-lighter text-white border-none outline-none focus:ring-2 focus:ring-discord-blurple font-mono"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button onClick={cancelEnroll} className="flex-1 py-2 rounded btn-secondary text-sm">
                Cancelar
              </button>
              <button
                onClick={confirmEnroll}
                disabled={code.length < 6 || busy}
                className="flex-1 py-2 rounded btn-primary text-sm disabled:opacity-60"
              >
                {busy ? 'Confirmando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={startEnroll} className="w-full py-2.5 rounded btn-primary text-sm">
            Ativar verificação em duas etapas
          </button>
        )}
        {error && !enrolling && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>
    </div>
  )
}
