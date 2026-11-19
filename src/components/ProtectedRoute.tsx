import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { LoadingScreen } from './ui/LoadingScreen'
import { MfaChallengeScreen } from '../pages/MfaChallengeScreen'
import { safeRedirectPath } from '../lib/authValidation'
import { TermsGate } from './TermsGate'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, mfaPending } = useAuth()
  const location = useLocation()

  if (loading) {
    return <LoadingScreen />
  }

  if (!session) {
    if (location.pathname !== '/login' && location.pathname !== '/cadastro') {
      try {
        const target = safeRedirectPath(location.pathname + location.search)
        if (target !== '/') sessionStorage.setItem('mamacos-post-login-redirect', target)
      } catch {
      }
    }
    return <Navigate to="/login" replace />
  }

  if (mfaPending) {
    return <MfaChallengeScreen />
  }

  return <TermsGate>{children}</TermsGate>
}
