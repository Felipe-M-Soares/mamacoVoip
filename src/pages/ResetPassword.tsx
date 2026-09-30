import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AUTH_REDIRECT_TYPE, supabase, wasPasswordRecoveryDetected } from '../lib/supabase'
import { traduzErro } from '../context/AuthContext'
import { PASSWORD_MIN_LENGTH, validatePassword } from '../lib/authValidation'
import { AuthAlert, AuthField, AuthHeader, AuthIcons, AuthShell } from './AuthShell'

export function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(true)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    // O link do e-mail traz a prova de que a pessoa é dona da conta.
    // Formatos aceitos (ver ForgotPassword.tsx e supabase/README.md):
    //  1) "?code=..." (PKCE, mesmo navegador que pediu): o cliente troca
    //     sozinho (detectSessionInUrl) e avisa com PASSWORD_RECOVERY;
    //  2) "?token_hash=...&type=recovery" (template de e-mail
    //     recomendado): verifyOtp aqui — funciona em qualquer aparelho;
    //  3) "#access_token=...&type=recovery" (template padrão, pedido no
    //     fluxo implícito): o cliente principal (PKCE) recusa esse
    //     formato, então a sessão é aplicada aqui com setSession.
    //
    // Antes, QUALQUER sessão servia: alguém com acesso a um app já
    // logado (computador destravado) abria /redefinir-senha e trocava a
    // senha da conta sem saber a atual. Agora o formulário só aparece
    // quando a sessão veio de fato de um link de recuperação.
    let cancelled = false
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session && !cancelled) setReady(true)
    })

    async function consumeRecoveryLink(): Promise<boolean> {
      const query = new URLSearchParams(window.location.search)
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const clearUrl = () => window.history.replaceState(null, '', window.location.pathname)

      const tokenHash = query.get('token_hash')
      if (tokenHash && AUTH_REDIRECT_TYPE === 'recovery') {
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
        clearUrl()
        return !error && Boolean(data.session)
      }

      const accessToken = hash.get('access_token')
      const refreshToken = hash.get('refresh_token')
      if (accessToken && refreshToken && AUTH_REDIRECT_TYPE === 'recovery') {
        const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        clearUrl()
        return !error && Boolean(data.session)
      }
      return false
    }

    void (async () => {
      let fromLink = false
      try {
        fromLink = await consumeRecoveryLink()
      } catch {
        fromLink = false
      }
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (cancelled) return
      // fromLink: formatos 2/3 acima. wasPasswordRecoveryDetected: formato
      // 1, cuja troca pode ter acontecido antes desta tela montar.
      if (session && (fromLink || wasPasswordRecoveryDetected())) setReady(true)
      setChecking(false)
    })()
    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)
    const { data: userData } = await supabase.auth.getUser()
    const passwordError = validatePassword(password, { email: userData.user?.email ?? undefined })
    if (passwordError) {
      setError(passwordError)
      return
    }
    if (password !== confirmPassword) {
      setError('As senhas não são iguais.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setLoading(false)
      setError(traduzErro(error.message))
      return
    }
    // Senha trocada por recuperação = pode ser que alguém tenha a senha
    // antiga. Derruba as outras sessões abertas (outros aparelhos).
    await supabase.auth.signOut({ scope: 'others' }).catch(() => {})
    setLoading(false)
    setSuccess(true)
    setTimeout(() => navigate('/', { replace: true }), 2000)
  }

  return (
    <AuthShell>
      <AuthHeader icon={AuthIcons.lock} title="Nova senha" subtitle="Escolha uma senha forte que você não usa em outro lugar." />

      {success ? (
        <div className="mt-6">
          <AuthAlert tone="success">Senha alterada! Levando você pro app...</AuthAlert>
        </div>
      ) : !ready && checking ? (
        <div className="mt-6 space-y-4" aria-busy="true" aria-label="Verificando o link...">
          <div className="h-3 w-24 animate-pulse rounded bg-white/[0.05]" />
          <div className="h-11 animate-pulse rounded-[10px] bg-white/[0.05]" />
          <div className="h-3 w-32 animate-pulse rounded bg-white/[0.05]" />
          <div className="h-11 animate-pulse rounded-[10px] bg-white/[0.05]" />
          <p className="text-center text-[13px] text-mv-muted">Verificando o link...</p>
        </div>
      ) : !ready ? (
        <div className="mt-6 space-y-4">
          <AuthAlert tone="error">Esse link não é mais válido, ou já expirou. Peça um novo na tela de login.</AuthAlert>
          <Link to="/esqueci-senha" className="btn-secondary flex h-10 w-full items-center justify-center text-[14px]">
            Pedir um novo link
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <AuthField
            label="Nova senha"
            icon={AuthIcons.lock}
            type="password"
            revealable
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={72}
            autoComplete="new-password"
            autoFocus
            hint={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres, com letras e números.`}
          />
          <AuthField
            label="Confirmar nova senha"
            icon={AuthIcons.lock}
            type="password"
            revealable
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />

          {error && <AuthAlert tone="error">{error}</AuthAlert>}

          <button type="submit" disabled={loading} aria-busy={loading} className="btn-primary flex h-11 w-full items-center justify-center gap-2 text-[15px]">
            {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
            {loading ? 'Salvando...' : 'Salvar nova senha'}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
