import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { GoogleSignInButton } from '../components/ui/GoogleSignInButton'
import { MobileDownloadBanner } from '../components/ui/MobileDownloadBanner'
import { AuthAlert, AuthDivider, AuthField, AuthHeader, AuthIcons, AuthShell, DesktopDownloadChip } from './AuthShell'
import { supabase } from '../lib/supabase'
import { acceptCurrentTerms, rememberPendingTerms } from '../lib/termsAcceptance'
import {
  validateEmail,
  validatePassword,
  validateUsername,
  passwordStrength,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
} from '../lib/authValidation'

const STRENGTH_LABELS = ['', 'Fraca', 'Razoável', 'Boa', 'Forte'] as const

export function Register() {
  const { signUp } = useAuth()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [isAdult, setIsAdult] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmationSent, setConfirmationSent] = useState(false)

  const termsError = 'Você precisa aceitar os Termos de Uso e a Política de Privacidade pra continuar.'
  const adultError = 'O Mamacos Voip é só para maiores de 18 anos. Confirme que você tem 18 anos ou mais pra continuar.'

  function validate(): string | null {
    const trimmedUsername = username.trim()
    return (
      validateUsername(trimmedUsername) ??
      validateEmail(email) ??
      validatePassword(password, { email, username: trimmedUsername }) ??
      (password !== confirmPassword ? 'As senhas não são iguais.' : null) ??
      (!acceptedTerms ? termsError : null) ??
      (!isAdult ? adultError : null)
    )
  }

  // O banco acrescenta um número no fim se o nome já estiver em uso
  // (ex.: "joao" vira "joao1") — melhor avisar ANTES de criar a conta.
  // Usa a função is_username_available (migration 013); se ela ainda não
  // existir no banco, simplesmente segue sem essa checagem.
  async function isUsernameTaken(name: string): Promise<boolean> {
    try {
      const { data, error } = await (
        supabase.rpc.bind(supabase) as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
      )('is_username_available', { p_username: name })
      if (error) return false
      return data === false
    } catch {
      return false
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (loading) return // evita duplo envio
    setError(null)

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    const trimmedUsername = username.trim()
    if (await isUsernameTaken(trimmedUsername)) {
      setLoading(false)
      setError('Esse nome de usuário já está em uso. Escolha outro.')
      return
    }
    // Aceite + 18+ ficam "pendentes" neste aparelho: com confirmação de
    // e-mail ainda não há sessão pra chamar accept_terms agora — o
    // TermsGate envia sozinho no primeiro login (ver lib/termsAcceptance.ts).
    rememberPendingTerms(email)
    const { error } = await signUp(email, password, trimmedUsername)
    if (!error) {
      // Projeto sem confirmação de e-mail: já existe sessão — registra agora.
      const { data } = await supabase.auth.getSession()
      if (data.session) await acceptCurrentTerms()
    }
    setLoading(false)

    if (error) {
      setError(error)
      return
    }
    setConfirmationSent(true)
  }

  const strength = password ? passwordStrength(password) : 0
  const strengthColor = ['bg-rose-500', 'bg-rose-500', 'bg-amber-400', 'bg-mv-green', 'bg-mv-green'][strength]

  if (confirmationSent) {
    return (
      <AuthShell>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-mv-green/15 text-mv-green ring-1 ring-inset ring-mv-green/25">
            {AuthIcons.mail}
          </div>
          <h1 className="font-display text-2xl font-semibold text-white">Confirme seu e-mail</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-mv-muted">
            Enviamos um link de confirmação para <span className="font-medium text-mv-text">{email}</span>.
            Clique no link para ativar sua conta e poder entrar.
          </p>
          <Link to="/login" className="btn-secondary mt-6 inline-flex h-10 items-center justify-center px-5 text-[14px]">
            Voltar para o login
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell wide>
      <MobileDownloadBanner />
      <AuthHeader title="Criar uma conta" subtitle="Leva menos de um minuto." />

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <AuthField
          label="Nome de usuário"
          icon={AuthIcons.user}
          type="text"
          required
          value={username}
          maxLength={USERNAME_MAX_LENGTH}
          onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
          autoComplete="username"
          placeholder="seunome"
        />

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

        <div>
          <AuthField
            label="Senha"
            icon={AuthIcons.lock}
            type="password"
            revealable
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={72}
            autoComplete="new-password"
            placeholder={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres`}
            hint={
              <>
                Mínimo {PASSWORD_MIN_LENGTH} caracteres, com letras e números.
                {password && ` Força: ${STRENGTH_LABELS[passwordStrength(password)] || 'Muito fraca'}.`}
              </>
            }
          />
          {password && (
            <div className="mt-2 flex gap-1" aria-hidden>
              {[1, 2, 3, 4].map((n) => (
                <span key={n} className={`h-1 flex-1 rounded-full transition-colors ${n <= strength ? strengthColor : 'bg-white/[0.08]'}`} />
              ))}
            </div>
          )}
        </div>

        <AuthField
          label="Confirmar senha"
          icon={AuthIcons.lock}
          type="password"
          revealable
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          maxLength={72}
          autoComplete="new-password"
          placeholder="Repita a senha"
        />

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

        <button type="submit" disabled={loading} aria-busy={loading} className="btn-primary flex h-11 w-full items-center justify-center gap-2 text-[15px]">
          {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
          {loading ? 'Criando conta...' : 'Continuar'}
        </button>
      </form>

      <AuthDivider />

      <GoogleSignInButton
        label="Cadastrar com Google"
        beforeStart={() => {
          const problem = !acceptedTerms ? termsError : !isAdult ? adultError : null
          if (!problem) rememberPendingTerms(null)
          return problem
        }}
      />

      <p className="mt-6 text-center text-[14px] text-mv-muted">
        Já tem uma conta?{' '}
        <Link to="/login" className="font-medium text-mv-accent hover:underline">
          Entrar
        </Link>
      </p>

      <DesktopDownloadChip />
    </AuthShell>
  )
}
