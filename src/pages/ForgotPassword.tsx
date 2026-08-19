import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    // Sempre manda pro site (não pro app://) — clicar num link de
    // e-mail sempre abre o navegador do sistema, então a redefinição
    // acontece lá. Depois é só entrar de novo no app (web ou desktop)
    // com a senha nova.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://mamaco-voip.vercel.app/redefinir-senha',
    })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setSent(true)
  }

  return (
    <div className="min-h-screen bg-discord-darker flex items-center justify-center p-4 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 900px 600px at 50% 0%, color-mix(in srgb, var(--color-discord-blurple) 22%, transparent), transparent 70%)',
        }}
      />
      <div className="relative bg-discord-dark rounded-xl shadow-2xl w-full max-w-md p-8 border border-white/5">
        <h1 className="font-display text-2xl font-bold text-white text-center tracking-wide">
          Esqueceu sua senha?
        </h1>
        <p className="text-discord-text-muted text-center mt-1 text-sm">
          Digite seu e-mail e mandamos um link pra você criar uma senha nova.
        </p>

        {sent ? (
          <p className="mt-6 text-sm text-discord-green bg-green-950/40 border border-green-900 rounded px-3 py-3 text-center">
            Se esse e-mail estiver cadastrado, você vai receber um link em instantes. Confere sua caixa de
            entrada (e o spam).
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">E-mail</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border border-white/5 outline-none focus:ring-2 focus:ring-discord-blurple focus:border-transparent transition-shadow"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded btn-primary disabled:opacity-60"
            >
              {loading ? 'Enviando...' : 'Enviar link de recuperação'}
            </button>
          </form>
        )}

        <Link to="/login" className="block text-center text-sm text-discord-blurple hover:underline mt-5">
          Voltar pro login
        </Link>
      </div>
    </div>
  )
}
