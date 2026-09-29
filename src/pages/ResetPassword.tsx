import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AUTH_REDIRECT_TYPE, supabase } from '../lib/supabase'
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
    // O link do e-mail já vem com a sessão de recuperação embutida
    // (processada automaticamente pelo detectSessionInUrl) — só
    // precisa confirmar que ela chegou antes de mostrar o formulário.
    //
    // Antes, QUALQUER sessão servia: alguém com acesso a um app já
    // logado (computador destravado) abria /redefinir-senha e trocava a
    // senha da conta sem saber a atual. Agora o formulário só aparece
    // quando a sessão veio de fato de um link de recuperação.
    let cancelled = false
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session && !cancelled) setReady(true)
    })
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      if (session && AUTH_REDIRECT_TYPE === 'recovery') setReady(true)
      setChecking(false)
    })
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
          <p className="text-center text-[13px] text-discord-text-muted">Verificando o link...</p>
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
