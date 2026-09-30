import { lazy, Suspense } from 'react'
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { PresenceProvider } from './context/PresenceContext'
import { FriendsProvider } from './context/FriendsContext'
import { GroupConversationsProvider } from './context/GroupConversationsContext'
import { ThemeProvider } from './context/ThemeContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ConnectionBanner } from './components/ui/ConnectionBanner'
import { UpdateStatusBadge } from './components/ui/UpdateStatusBadge'
import { ScreenSharePicker } from './components/ui/ScreenSharePicker'
import { FriendRequestToast } from './components/ui/FriendRequestToast'
import { TitleBar } from './components/layout/TitleBar'
import { LoadingScreen } from './components/ui/LoadingScreen'

// Divisão de código por rota: antes TUDO (telas de login/cadastro, páginas
// legais, o layout principal inteiro com voz/LiveKit, todos os modais) ia
// num único arquivo de ~1 MB que precisava ser baixado e interpretado
// antes de qualquer tela aparecer. Agora cada rota carrega só o que usa.
const loadMainLayout = () => import('./pages/MainLayout')
const MainLayout = lazy(() => loadMainLayout().then((m) => ({ default: m.MainLayout })))
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword').then((m) => ({ default: m.ForgotPassword })))
const ResetPassword = lazy(() => import('./pages/ResetPassword').then((m) => ({ default: m.ResetPassword })))
const Register = lazy(() => import('./pages/Register').then((m) => ({ default: m.Register })))
const InviteRedirect = lazy(() => import('./pages/InviteRedirect').then((m) => ({ default: m.InviteRedirect })))
const PrivacyPolicy = lazy(() => import('./pages/legal/PrivacyPolicy').then((m) => ({ default: m.PrivacyPolicy })))
const TermsOfService = lazy(() => import('./pages/legal/TermsOfService').then((m) => ({ default: m.TermsOfService })))
const DeleteAccountInfo = lazy(() => import('./pages/legal/DeleteAccountInfo').then((m) => ({ default: m.DeleteAccountInfo })))

// Quase toda sessão termina no layout principal — começa a baixá-lo em
// segundo plano logo após a primeira pintura (em paralelo com a checagem
// de sessão), pra que o `lazy` acima não acrescente espera nenhuma.
if (typeof window !== 'undefined') {
  const preload = () => {
    loadMainLayout().catch(() => {
      // se falhar aqui, o lazy() tenta de novo (e mostra o erro) quando for usado
    })
  }
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
  if (w.requestIdleCallback) w.requestIdleCallback(preload, { timeout: 1500 })
  else setTimeout(preload, 200)
}

// Dentro do app desktop, o documento é servido por um protocolo próprio
// (app://bundle/index.html), então o "caminho" real da URL não é "/"
// como o BrowserRouter espera — isso fazia nenhuma rota bater e a tela
// ficar em branco. HashRouter usa a parte depois do "#" pra decidir a
// rota, o que funciona independente de qual seja o caminho real do
// documento. No site (Vercel), continua tudo em BrowserRouter normal.
const Router = window.electronAPI?.isElectron ? HashRouter : BrowserRouter

function App() {
  return (
    <ErrorBoundary>
    <ThemeProvider>
      <Router>
        <AuthProvider>
          <PresenceProvider>
          <FriendsProvider>
          <GroupConversationsProvider>
          {/* Coluna vertical: barra de título (só existe dentro do
              Electron — TitleBar.tsx se auto-anula no site) em cima, e
              o resto do app ocupando o espaço que sobrar. Sem isso, uma
              página com h-screen (como o MainLayout) ficaria mais alta
              que o espaço restante depois da barra de título, cortando
              o fundo da tela pra fora da área visível. */}
          <div className="h-screen w-screen flex flex-col overflow-hidden">
            <TitleBar />
            <div className="flex-1 min-h-0 relative overflow-y-auto">
              <ConnectionBanner />
              <UpdateStatusBadge />
              <ScreenSharePicker />
              <FriendRequestToast />
              <Suspense fallback={<LoadingScreen />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/esqueci-senha" element={<ForgotPassword />} />
                <Route path="/redefinir-senha" element={<ResetPassword />} />
                <Route path="/cadastro" element={<Register />} />
                <Route path="/privacidade" element={<PrivacyPolicy />} />
                <Route path="/termos" element={<TermsOfService />} />
                <Route path="/excluir-conta" element={<DeleteAccountInfo />} />
                <Route
                  path="/convite/:code"
                  element={
                    <ProtectedRoute>
                      <InviteRedirect />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <MainLayout />
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              </Suspense>
            </div>
          </div>
        </GroupConversationsProvider>
        </FriendsProvider>
        </PresenceProvider>
        </AuthProvider>
      </Router>
    </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
