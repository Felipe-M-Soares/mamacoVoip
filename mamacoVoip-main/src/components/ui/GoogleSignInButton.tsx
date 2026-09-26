import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'

// Botão compartilhado entre Login.tsx e Register.tsx — o mesmo fluxo do
// Google serve tanto pra entrar quanto pra criar conta (se a pessoa
// nunca tinha logado antes com aquele e-mail do Google, o Supabase cria
// a conta na hora, sem precisar de confirmação por e-mail nenhuma —
// é assim que esse botão também resolve o problema do limite de e-mail
// do Supabase pra quem usar ele em vez do formulário de senha).
export function GoogleSignInButton({ label = 'Continuar com Google' }: { label?: string }) {
  const { signInWithGoogle } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setError(null)
    setLoading(true)
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
        className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded bg-white text-gray-800 font-semibold text-sm hover:brightness-95 transition-all disabled:opacity-60"
      >
        <svg viewBox="0 0 24 24" className="w-4.5 h-4.5" width="18" height="18">
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
        {loading ? 'Abrindo o Google...' : label}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-400 bg-red-950/40 border border-red-900 rounded px-3 py-2">{error}</p>
      )}
    </div>
  )
}
