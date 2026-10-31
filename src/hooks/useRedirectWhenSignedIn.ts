import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { safeRedirectPath } from '../lib/authValidation'

// Sai da tela de login/cadastro assim que existir uma sessão.
//
// No site, o login com Google recarrega a página inteira e cai direto no
// app. No app de PC e no celular o login volta por um link (mamacovoip:// /
// com.mamacosvoip.app://) e a sessão aparece SEM recarregar — a pessoa
// ficava parada na tela de login, já logada, até fechar e abrir o app.
export function useRedirectWhenSignedIn(enabled = true) {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (!enabled || loading || !session) return
    let redirectTo = '/'
    try {
      // Só caminhos internos do app — nunca outro site (open redirect).
      redirectTo = safeRedirectPath(sessionStorage.getItem('mamacos-post-login-redirect'))
      sessionStorage.removeItem('mamacos-post-login-redirect')
    } catch {
      // best-effort
    }
    navigate(redirectTo, { replace: true })
  }, [enabled, loading, session, navigate])
}
