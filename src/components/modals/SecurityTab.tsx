import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { traduzErro } from '../../context/AuthContext'
import { useAuth } from '../../hooks/useAuth'
import { normalizeTotpCode } from '../../lib/authValidation'
import { ConfirmDialog } from './ConfirmDialog'
import { TabHeader, SettingsCard, SettingRow, RowList, InlineMessage } from './settingsUI'

interface EnrolledFactor {
  id: string
  friendly_name?: string | null
  factor_type: string
  status?: string
}

export function SecurityTab() {
  const { signOutOtherSessions, signOutEverywhere } = useAuth()
  const [sessionsBusy, setSessionsBusy] = useState(false)
  const [sessionsMessage, setSessionsMessage] = useState<string | null>(null)
  const [factors, setFactors] = useState<EnrolledFactor[]>([])
  const [loading, setLoading] = useState(true)
  const [enrolling, setEnrolling] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [pendingFactorId, setPendingFactorId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Confirmação própria do app no lugar do confirm() nativo.
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string
    message: string
    confirmLabel: string
    run: () => void | Promise<void>
  } | null>(null)

  async function refreshFactors() {
    setLoading(true)
    const { data } = await supabase.auth.mfa.listFactors()
    // Só conta como "ativado" o fator já verificado — um cadastro
    // abandonado no meio deixa um fator "unverified" que não protege nada.
    setFactors((data?.totp ?? []).filter((f) => !f.status || f.status === 'verified'))
    setLoading(false)
  }

  // Apaga fatores TOTP não verificados (cadastros abandonados). Sem isso
  // eles se acumulam e o próximo "Ativar" pode falhar com "já existe um
  // fator com esse nome".
  async function cleanupUnverifiedFactors() {
    const { data } = await supabase.auth.mfa.listFactors()
    const stale = (data?.all ?? []).filter((f) => f.factor_type === 'totp' && f.status === 'unverified')
    await Promise.all(stale.map((f) => supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => null)))
  }

  useEffect(() => {
    refreshFactors()
  }, [])

  async function startEnroll() {
    if (busy) return
    setError(null)
    setBusy(true)
    await cleanupUnverifiedFactors()
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Autenticador ${new Date().toLocaleDateString('pt-BR')}`,
    })
    setBusy(false)
    if (error) {
      setError(traduzErro(error.message))
      return
    }
    setQrCode(data.totp.qr_code)
    setSecret(data.totp.secret)
    setPendingFactorId(data.id)
    setEnrolling(true)
  }

  async function confirmEnroll() {
    if (busy || !pendingFactorId || code.length !== 6) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: pendingFactorId, code })
    setBusy(false)
    if (error) {
      setError(traduzErro(error.message))
      setCode('')
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
    // Remove o fator pendente no servidor também (antes ele ficava lá
    // pra sempre como "unverified").
    if (pendingFactorId) supabase.auth.mfa.unenroll({ factorId: pendingFactorId }).catch(() => null)
    setEnrolling(false)
    setQrCode(null)
    setSecret(null)
    setPendingFactorId(null)
    setCode('')
    setError(null)
  }

  function removeFactor(factorId: string) {
    if (busy) return
    setPendingConfirm({
      title: 'Remover verificação em duas etapas',
      message: 'Remover a verificação em duas etapas dessa conta?',
      confirmLabel: 'Remover',
      run: () => doRemoveFactor(factorId),
    })
  }

  async function doRemoveFactor(factorId: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    setBusy(false)
    if (error) {
      setError(traduzErro(error.message))
      return
    }
    // O nível de garantia da sessão (aal) muda — renova o token.
    await supabase.auth.refreshSession().catch(() => null)
    await refreshFactors()
  }

  function handleSignOutOthers() {
    if (sessionsBusy) return
    setPendingConfirm({
      title: 'Encerrar outras sessões',
      message: 'Encerrar a sessão em todos os OUTROS aparelhos? Este continua conectado.',
      confirmLabel: 'Encerrar sessões',
      run: doSignOutOthers,
    })
  }

  async function doSignOutOthers() {
    if (sessionsBusy) return
    setSessionsBusy(true)
    setSessionsMessage(null)
    const { error } = await signOutOtherSessions()
    setSessionsBusy(false)
    setSessionsMessage(error ?? 'Pronto — os outros aparelhos vão precisar entrar de novo.')
  }

  function handleSignOutEverywhere() {
    if (sessionsBusy) return
    setPendingConfirm({
      title: 'Sair de todos os aparelhos',
      message: 'Sair da conta em TODOS os aparelhos, inclusive este?',
      confirmLabel: 'Sair de todos',
      run: doSignOutEverywhere,
    })
  }

  async function doSignOutEverywhere() {
    if (sessionsBusy) return
    setSessionsBusy(true)
    await signOutEverywhere()
  }

  return (
    <div className="space-y-5">
      <TabHeader title="Segurança" description="Proteja o acesso à sua conta e controle onde você está conectado." />

      <SettingsCard
        title="Verificação em duas etapas"
        description="Adiciona uma camada extra de segurança — além da senha, você precisa de um código gerado por um app autenticador (Google Authenticator, Authy, etc.) pra entrar na conta."
      >
        {loading ? (
          <div className="h-12 rounded-xl animate-pulse bg-white/[0.05]" />
        ) : factors.length > 0 ? (
          <div className="space-y-2">
            {factors.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-mv-green/[0.06] border border-mv-green/25 px-3.5 py-3"
              >
                <span className="text-[14px] text-mv-text flex items-center gap-2.5 min-w-0">
                  <span className="w-7 h-7 rounded-lg bg-mv-green/15 text-mv-green flex items-center justify-center shrink-0">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                  <span className="truncate">{f.friendly_name || 'Autenticador'}</span>
                  <span className="chip !text-mv-green !border-mv-green/30 !bg-mv-green/10">Ativado</span>
                </span>
                <button
                  onClick={() => removeFactor(f.id)}
                  disabled={busy}
                  className="shrink-0 h-8 px-3 rounded-lg text-[13px] font-medium text-rose-300 hover:bg-rose-500/10 disabled:opacity-60 transition-colors"
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        ) : enrolling ? (
          <div className="rounded-xl bg-mv-canvas/60 border border-[var(--color-line)] p-4 space-y-4 animate-fade-slide-in">
            <div className="flex flex-col sm:flex-row gap-4 items-center">
              {qrCode && (
                <div className="shrink-0 bg-white rounded-xl p-2.5">
                  <img src={qrCode} alt="QR code de configuração" className="w-36 h-36" />
                </div>
              )}
              <div className="space-y-2 text-[13px] text-mv-muted">
                <p>
                  <span className="text-white font-medium">1.</span> Escaneie com seu app autenticador.
                </p>
                {secret && (
                  <p>
                    Não consegue escanear? Digite o código manualmente:{' '}
                    <span className="font-mono text-mv-text break-all">{secret}</span>
                  </p>
                )}
                <p>
                  <span className="text-white font-medium">2.</span> Digite o código de 6 dígitos gerado:
                </p>
              </div>
            </div>
            <input
              value={code}
              onChange={(e) => setCode(normalizeTotpCode(e.target.value))}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="Código de 6 dígitos"
              onKeyDown={(e) => e.key === 'Enter' && confirmEnroll()}
              placeholder="000000"
              autoFocus
              className="w-full px-3 py-3 text-center text-2xl tracking-[0.4em] bg-mv-canvas text-white outline-none font-mono"
            />
            {error && <InlineMessage tone="error">{error}</InlineMessage>}
            <div className="flex justify-end gap-2">
              <button onClick={cancelEnroll} className="btn-secondary h-9 px-4 text-sm">
                Cancelar
              </button>
              <button onClick={confirmEnroll} disabled={code.length < 6 || busy} className="btn-primary h-9 px-4 text-sm">
                {busy ? 'Confirmando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <button onClick={startEnroll} disabled={busy} className="btn-primary h-10 px-5 text-sm">
              {busy ? 'Preparando...' : 'Ativar verificação em duas etapas'}
            </button>
          </div>
        )}
        {error && !enrolling && (
          <div className="mt-3">
            <InlineMessage tone="error">{error}</InlineMessage>
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="Sessões ativas"
        description="Se você entrou em um computador que não é seu, ou acha que alguém sabe sua senha, encerre as outras sessões (e troque a senha)."
      >
        <RowList>
          <SettingRow
            title="Outros aparelhos"
            description="Desconecta todos os aparelhos menos este."
            control={
              <button onClick={handleSignOutOthers} disabled={sessionsBusy} className="btn-secondary h-9 px-4 text-sm shrink-0">
                {sessionsBusy ? 'Encerrando...' : 'Sair dos outros'}
              </button>
            }
          />
          <SettingRow
            title="Todos os aparelhos"
            description="Desconecta todo lugar, inclusive este aparelho."
            control={
              <button
                onClick={handleSignOutEverywhere}
                disabled={sessionsBusy}
                className="shrink-0 h-9 px-4 rounded-[10px] text-sm font-medium text-rose-300 border border-rose-500/40 hover:bg-rose-500/10 disabled:opacity-60 transition-colors"
              >
                Sair de todos
              </button>
            }
          />
        </RowList>
        {sessionsMessage && (
          <div className="mt-3">
            <InlineMessage tone="info">{sessionsMessage}</InlineMessage>
          </div>
        )}
      </SettingsCard>

      {pendingConfirm && (
        <ConfirmDialog
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          confirmLabel={pendingConfirm.confirmLabel}
          danger
          onCancel={() => setPendingConfirm(null)}
          onConfirm={async () => {
            const run = pendingConfirm.run
            setPendingConfirm(null)
            await run()
          }}
        />
      )}
    </div>
  )
}
