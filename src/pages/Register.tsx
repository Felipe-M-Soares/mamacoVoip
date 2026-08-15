import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function Register() {
  const { signUp } = useAuth()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmationSent, setConfirmationSent] = useState(false)

  function validate(): string | null {
    if (username.length < 3) return 'O nome de usuário precisa ter no mínimo 3 caracteres.'
    if (!/^[a-zA-Z0-9_.]+$/.test(username))
      return 'O nome de usuário só pode ter letras, números, ponto e underline.'
    if (password.length < 6) return 'A senha precisa ter no mínimo 6 caracteres.'
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
      <div className="min-h-screen bg-discord-darker flex items-center justify-center p-4">
        <div className="bg-discord-dark rounded-lg shadow-xl w-full max-w-md p-8 text-center">
          <h1 className="text-2xl font-bold text-white">Confirme seu e-mail</h1>
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
    <div className="min-h-screen bg-discord-darker flex items-center justify-center p-4">
      <div className="bg-discord-dark rounded-lg shadow-xl w-full max-w-md p-8">
        <div className="flex justify-center mb-4">
          <img src="/logo.png" alt="Mamacos Voip" className="w-20 h-20 rounded-full object-cover" />
        </div>
        <h1 className="text-2xl font-bold text-white text-center">Criar uma conta</h1>

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
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
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
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
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
              className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple"
              autoComplete="new-password"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded bg-discord-blurple text-white font-medium hover:bg-indigo-600 transition-colors disabled:opacity-60"
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
      </div>
    </div>
  )
}
