import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen bg-discord-dark flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
      </div>
    )
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

  return <>{children}</>
}
