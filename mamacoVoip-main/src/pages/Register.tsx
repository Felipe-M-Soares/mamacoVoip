import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { GoogleSignInButton } from '../components/ui/GoogleSignInButton'
import { MobileDownloadBanner } from '../components/ui/MobileDownloadBanner'

function GlowBackdrop() {
  return (
    <>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 900px 600px at 50% 0%, color-mix(in srgb, var(--color-discord-blurple) 22%, transparent), transparent 70%)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, var(--color-discord-text) 0, var(--color-discord-text) 1px, transparent 1px, transparent 14px)',
        }}
      />
    </>
  )
}

export function Register() {
  const { signUp } = useAuth()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmationSent, setConfirmationSent] = useState(false)

  function validate(): string | null {
    if (username.length < 3) return 'O nome de usuário precisa ter no mínimo 3 caracteres.'
    if (!/^[a-zA-Z0-9_.]+$/.test(username))
      return 'O nome de usuário só pode ter letras, números, ponto e underline.'
    if (password.length < 6) return 'A senha precisa ter no mínimo 6 caracteres.'
    if (!acceptedTerms) return 'Você precisa aceitar os Termos de Uso e a Política de Privacidade pra continuar.'
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    const { error } = await signUp(email, password, username)
    setLoading(false)

    if (error) {
      setError(error)
      return
    }
    setConfirmationSent(true)
  }

  if (confirmationSent) {
    return (
      <div className="min-h-full bg-discord-darker flex items-center justify-center p-4 relative overflow-hidden">
        <GlowBackdrop />
        <div className="relative bg-discord-dark rounded-xl shadow-2xl w-full max-w-md p-8 text-center border border-white/5">
          <img src="/logo.png" alt="Mamacos Voip" className="w-16 h-16 rounded-full object-cover mx-auto mb-4 brand-glow-sm" />
          <h1 className="font-display text-2xl font-bold text-white tracking-wide">Confirme seu e-mail</h1>
          <p className="text-discord-text-muted mt-3">
            Enviamos um link de confirmação para <span className="text-discord-text">{email}</span>.
            Clique no link para ativar sua conta e poder entrar.
          </p>
          <Link to="/login" className="text-discord-blurple hover:underline mt-6 inline-block">
            Voltar para o login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-discord-darker flex items-center justify-center p-4 relative overflow-hidden">
      <GlowBackdrop />
      <div className="relative bg-discord-dark rounded-xl shadow-2xl w-full max-w-md p-8 border border-white/5">
        <MobileDownloadBanner />
        <div className="flex justify-center mb-5">
          <img src="/logo.png" alt="Mamacos Voip" className="w-24 h-24 rounded-full object-cover brand-glow" />
        </div>
        <h1 className="font-display text-3xl font-bold text-white text-center tracking-wide">Criar uma conta</h1>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
              Nome de usuário
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border border-white/5 outline-none focus:ring-2 focus:ring-discord-blurple focus:border-transparent transition-shadow"
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
              E-mail
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border border-white/5 outline-none focus:ring-2 focus:ring-discord-blurple focus:border-transparent transition-shadow"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
              Senha
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border border-white/5 outline-none focus:ring-2 focus:ring-discord-blurple focus:border-transparent transition-shadow"
              autoComplete="new-password"
            />
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-discord-blurple shrink-0"
            />
            <span className="text-xs text-discord-text-muted">
              Eu li e concordo com os{' '}
              <Link to="/termos" target="_blank" className="text-discord-blurple hover:underline">
                Termos de Uso
              </Link>{' '}
              e a{' '}
              <Link to="/privacidade" target="_blank" className="text-discord-blurple hover:underline">
                Política de Privacidade
              </Link>
              .
            </span>
          </label>

          {error && (
            <p className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded bg-discord-blurple text-white font-display font-semibold tracking-wide text-base hover:brightness-110 hover:brand-glow-sm transition-all disabled:opacity-60"
          >
            {loading ? 'Criando conta...' : 'Continuar'}
          </button>

          <p className="text-sm text-discord-text-muted">
            Já tem uma conta?{' '}
            <Link to="/login" className="text-discord-blurple hover:underline">
              Entrar
            </Link>
          </p>
        </form>

        <div className="flex items-center gap-3 mt-5">
          <div className="h-px flex-1 bg-white/5" />
          <span className="text-[11px] uppercase text-discord-text-muted">ou</span>
          <div className="h-px flex-1 bg-white/5" />
        </div>

        <div className="mt-4">
          <GoogleSignInButton label="Cadastrar com Google" />
        </div>
      </div>
    </div>
  )
}
