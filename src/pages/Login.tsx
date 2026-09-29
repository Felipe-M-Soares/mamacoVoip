import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { AuthAlert, AuthDivider, AuthField, AuthHeader, AuthIcons, AuthShell, DesktopDownloadChip } from './AuthShell'
import { GoogleSignInButton } from '../components/ui/GoogleSignInButton'
import { MobileDownloadBanner } from '../components/ui/MobileDownloadBanner'
import { safeRedirectPath, validateEmail } from '../lib/authValidation'
import { checkRateLimit } from '../lib/rateLimit'

export function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmedBanner, setConfirmedBanner] = useState(false)

  useEffect(() => {
    try {
      if (sessionStorage.getItem('mamacos-email-confirmed') === '1') {
        setConfirmedBanner(true)
        sessionStorage.removeItem('mamacos-email-confirmed')
      }
    } catch {
      // sem acesso a sessionStorage — sem problema, só não mostra o aviso
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (loading) return // evita duplo envio (Enter + clique)
    setError(null)

    const emailError = validateEmail(email)
    if (emailError) {
      setError(emailError)
      return
    }
    if (!password) {
      setError('Informe sua senha.')
      return
    }
    // Só uma trava de UX contra tentativas em sequência — o limite de
    // verdade é o do Supabase Auth, no servidor.
    const limit = checkRateLimit('login', 5, 60_000)
    if (!limit.allowed) {
      setError(`Muitas tentativas seguidas. Espere ${limit.retryAfterSeconds}s e tente de novo.`)
      return
    }

    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      setError(error)
      setPassword('')
      return
    }
    let redirectTo = '/'
    try {
      // Só caminhos internos do app — nunca outro site (open redirect).
      redirectTo = safeRedirectPath(sessionStorage.getItem('mamacos-post-login-redirect'))
      sessionStorage.removeItem('mamacos-post-login-redirect')
    } catch {
      // best-effort
    }
    navigate(redirectTo, { replace: true })
  }

  return (
    <AuthShell>
      <MobileDownloadBanner />
      <AuthHeader title="Bem-vindo de volta!" subtitle="Que bom te ver de novo. Entre pra continuar." />

      {confirmedBanner && (
        <div className="mt-5">
          <AuthAlert tone="success">E-mail confirmado! Você já pode entrar com sua senha.</AuthAlert>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <AuthField
          label="E-mail"
          icon={AuthIcons.mail}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="voce@exemplo.com"
        />

        <AuthField
          label="Senha"
          icon={AuthIcons.lock}
          type="password"
          revealable
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder="Sua senha"
          labelAside={
            <Link to="/esqueci-senha" className="mb-[0.45rem] text-[12px] font-medium text-discord-blurple hover:underline">
              Esqueceu a senha?
            </Link>
          }
        />

        {error && <AuthAlert tone="error">{error}</AuthAlert>}

        <button type="submit" disabled={loading} aria-busy={loading} className="btn-primary flex h-11 w-full items-center justify-center gap-2 text-[15px]">
          {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>

      <AuthDivider />

      <GoogleSignInButton label="Entrar com Google" />

      <p className="mt-6 text-center text-[14px] text-discord-text-muted">
        Precisa de uma conta?{' '}
        <Link to="/cadastro" className="font-medium text-discord-blurple hover:underline">
          Cadastre-se
        </Link>
      </p>

      <DesktopDownloadChip />
    </AuthShell>
  )
}
