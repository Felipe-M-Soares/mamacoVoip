import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { LoadingScreen } from './ui/LoadingScreen'
import { MfaChallengeScreen } from '../pages/MfaChallengeScreen'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, mfaPending } = useAuth()
  const location = useLocation()

  if (loading) {
    return <LoadingScreen />
  }

  if (!session) {
    // Guarda pra onde a pessoa tentou ir (ex: um link de convite) —
    // o Login usa isso pra mandar de volta pro lugar certo depois de entrar.
    if (location.pathname !== '/login' && location.pathname !== '/cadastro') {
      try {
        sessionStorage.setItem('mamacos-post-login-redirect', location.pathname + location.search)
      } catch {
        // best-effort
      }
    }
    return <Navigate to="/login" replace />
  }

  if (mfaPending) {
    return <MfaChallengeScreen />
  }

  return <>{children}</>
}
