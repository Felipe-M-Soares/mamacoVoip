import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    // O link do e-mail já vem com a sessão de recuperação embutida
    // (processada automaticamente pelo detectSessionInUrl) — só
    // precisa confirmar que ela chegou antes de mostrar o formulário.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setReady(Boolean(session))
    })
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('A senha precisa ter pelo menos 6 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setError('As senhas não são iguais.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess(true)
    setTimeout(() => navigate('/', { replace: true }), 2000)
  }

  return (
    <div className="min-h-full bg-discord-darker flex items-center justify-center p-4 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 900px 600px at 50% 0%, color-mix(in srgb, var(--color-discord-blurple) 22%, transparent), transparent 70%)',
        }}
      />
      <div className="relative bg-discord-dark rounded-xl shadow-2xl w-full max-w-md p-8 border border-white/5">
        <h1 className="font-display text-2xl font-bold text-white text-center tracking-wide">Nova senha</h1>

        {success ? (
          <p className="mt-6 text-sm text-discord-green bg-green-950/40 border border-green-900 rounded px-3 py-3 text-center">
            Senha alterada! Levando você pro app...
          </p>
        ) : !ready ? (
          <p className="text-discord-text-muted text-center mt-6 text-sm">
            Esse link não é mais válido, ou já expirou. Peça um novo na tela de login.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">Nova senha</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
                className="w-full px-3 py-2.5 rounded bg-discord-darker text-discord-text border border-white/5 outline-none focus:ring-2 focus:ring-discord-blurple focus:border-transparent transition-shadow"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
                Confirmar nova senha
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
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
              {loading ? 'Salvando...' : 'Salvar nova senha'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
