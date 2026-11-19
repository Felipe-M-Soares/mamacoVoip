import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { safeRedirectPath } from '../lib/authValidation'

export function useRedirectWhenSignedIn(enabled = true) {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (!enabled || loading || !session) return
    let redirectTo = '/'
    try {
      redirectTo = safeRedirectPath(sessionStorage.getItem('mamacos-post-login-redirect'))
      sessionStorage.removeItem('mamacos-post-login-redirect')
    } catch {
    }
    navigate(redirectTo, { replace: true })
  }, [enabled, loading, session, navigate])
}
