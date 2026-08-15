import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

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
    setError(null)
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      setError(error)
      return
    }
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-discord-darker flex items-center justify-center p-4 relative overflow-hidden">
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

      <div className="relative bg-discord-dark rounded-xl shadow-2xl w-full max-w-md p-8 border border-white/5">
        <div className="flex justify-center mb-5">
          <img src="/logo.png" alt="Mamacos Voip" className="w-24 h-24 rounded-full object-cover brand-glow" />
        </div>
        <h1 className="font-display text-3xl font-bold text-white text-center tracking-wide">Bem-vindo de volta!</h1>
        <p className="text-discord-text-muted text-center mt-1">Que bom te ver de novo!</p>

        {confirmedBanner && (
          <p className="mt-4 text-sm text-discord-green bg-green-950/40 border border-green-900 rounded px-3 py-2 text-center">
            ✓ E-mail confirmado! Você já pode entrar com sua senha.
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
              autoComplete="current-password"
            />
            <Link to="/esqueci-senha" className="text-xs text-discord-blurple hover:underline mt-2 inline-block">
              Esqueceu sua senha?
            </Link>
          </div>

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
            {loading ? 'Entrando...' : 'Entrar'}
          </button>

          <p className="text-sm text-discord-text-muted">
            Precisa de uma conta?{' '}
            <Link to="/cadastro" className="text-discord-blurple hover:underline">
              Cadastre-se
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
