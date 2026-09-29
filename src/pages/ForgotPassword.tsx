import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PUBLIC_WEB_URL } from '../lib/config'
import { traduzErro } from '../context/AuthContext'
import { normalizeEmail, validateEmail } from '../lib/authValidation'
import { checkRateLimit } from '../lib/rateLimit'
import { AuthAlert, AuthField, AuthHeader, AuthIcons, AuthShell } from './AuthShell'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)
    const emailError = validateEmail(email)
    if (emailError) {
      setError(emailError)
      return
    }
    const limit = checkRateLimit('forgot-password', 3, 5 * 60_000)
    if (!limit.allowed) {
      setError(`Você já pediu alguns links agora. Espere ${limit.retryAfterSeconds}s antes de pedir outro.`)
      return
    }
    setLoading(true)
    // Sempre manda pro site (não pro app://) — clicar num link de
    // e-mail sempre abre o navegador do sistema, então a redefinição
    // acontece lá. Depois é só entrar de novo no app (web ou desktop)
    // com a senha nova.
    const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
      redirectTo: `${PUBLIC_WEB_URL}/redefinir-senha`,
    })
    setLoading(false)
    if (error) {
      // Só mostra erro de limite/conexão — qualquer outro caso cai na
      // mesma mensagem de sucesso, pra não revelar se o e-mail tem conta.
      const translated = traduzErro(error.message)
      if (/rate limit|segundos|Muitas|conexão|internet/i.test(error.message + translated)) {
        setError(translated)
        return
      }
    }
    setSent(true)
  }

  return (
    <AuthShell>
      <AuthHeader
        icon={AuthIcons.key}
        title="Esqueceu sua senha?"
        subtitle="Digite seu e-mail e mandamos um link pra você criar uma senha nova."
      />

      {sent ? (
        <div className="mt-6">
          <AuthAlert tone="success">
            Se esse e-mail estiver cadastrado, você vai receber um link em instantes. Confere sua caixa de entrada (e o
            spam).
          </AuthAlert>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <AuthField
            label="E-mail"
            icon={AuthIcons.mail}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
            placeholder="voce@exemplo.com"
          />

          {error && <AuthAlert tone="error">{error}</AuthAlert>}

          <button type="submit" disabled={loading} aria-busy={loading} className="btn-primary flex h-11 w-full items-center justify-center gap-2 text-[15px]">
            {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
            {loading ? 'Enviando...' : 'Enviar link de recuperação'}
          </button>
        </form>
      )}

      <Link
        to="/login"
        className="btn-ghost mt-5 flex h-10 w-full items-center justify-center gap-1.5 text-[14px] font-medium"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
          <path d="M19 12H5M11 18l-6-6 6-6" />
        </svg>
        Voltar pro login
      </Link>
    </AuthShell>
  )
}
