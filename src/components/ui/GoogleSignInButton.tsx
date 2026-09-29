import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'

// Botão compartilhado entre Login.tsx e Register.tsx — o mesmo fluxo do
// Google serve tanto pra entrar quanto pra criar conta (se a pessoa
// nunca tinha logado antes com aquele e-mail do Google, o Supabase cria
// a conta na hora, sem precisar de confirmação por e-mail nenhuma —
// é assim que esse botão também resolve o problema do limite de e-mail
// do Supabase pra quem usar ele em vez do formulário de senha).
export function GoogleSignInButton({
  label = 'Continuar com Google',
  beforeStart,
}: {
  label?: string
  // Checagem opcional antes de abrir o Google (ex.: no cadastro, exigir
  // o aceite dos Termos também pra quem cria conta pelo Google). Devolve
  // uma mensagem de erro pra barrar, ou null pra seguir.
  beforeStart?: () => string | null
}) {
  const { signInWithGoogle } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
  }, [])

  async function handleClick() {
    if (loading) return
    setError(null)
    const blocked = beforeStart?.()
    if (blocked) {
      setError(blocked)
      return
    }
    setLoading(true)
    // No app desktop, se a pessoa fechar o navegador sem terminar o
    // login, nada volta pro app — sem isso o botão ficava travado em
    // "Abrindo o Google..." até reiniciar o app.
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    resetTimerRef.current = setTimeout(() => setLoading(false), 30_000)
    const { error } = await signInWithGoogle()
    // No app desktop, um sucesso aqui só significa "o navegador abriu" —
    // a sessão de verdade chega minutos depois pelo link de volta (ver
    // AuthContext.tsx), então não tem "loading" pra desligar num sucesso
    // real. No navegador, um sucesso já REDIRECIONA a página inteira, então
    // esse setLoading(false) só roda mesmo se der erro.
    if (error) {
      setError(error)
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        aria-busy={loading}
        className="btn-secondary flex h-11 w-full items-center justify-center gap-2.5 text-[14px] font-semibold text-white"
      >
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
        ) : (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" width="18" height="18" aria-hidden>
          <path
            fill="#4285F4"
            d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.48a5.54 5.54 0 0 1-2.4 3.63v3h3.87c2.27-2.09 3.57-5.17 3.57-8.82Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.87-3c-1.08.72-2.45 1.15-4.08 1.15-3.13 0-5.79-2.11-6.74-4.96H1.27v3.09A11.998 11.998 0 0 0 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5.26 14.28A7.2 7.2 0 0 1 4.88 12c0-.79.14-1.56.38-2.28V6.63H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.37l3.99-3.09Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.77c1.76 0 3.34.6 4.59 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.27 6.63l3.99 3.09C6.21 6.88 8.87 4.77 12 4.77Z"
          />
        </svg>
        )}
        {loading ? 'Abrindo o Google...' : label}
      </button>
      {error && (
        <p role="alert" className="mt-2 rounded-[10px] border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[13px] text-rose-300">
          {error}
        </p>
      )}
    </div>
  )
}
