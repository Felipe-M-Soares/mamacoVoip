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
import { Login } from './pages/Login'
import { ForgotPassword } from './pages/ForgotPassword'
import { ResetPassword } from './pages/ResetPassword'
import { Register } from './pages/Register'
import { MainLayout } from './pages/MainLayout'
import { InviteRedirect } from './pages/InviteRedirect'
import { PrivacyPolicy } from './pages/legal/PrivacyPolicy'
import { TermsOfService } from './pages/legal/TermsOfService'

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
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/esqueci-senha" element={<ForgotPassword />} />
                <Route path="/redefinir-senha" element={<ResetPassword />} />
                <Route path="/cadastro" element={<Register />} />
                <Route path="/privacidade" element={<PrivacyPolicy />} />
                <Route path="/termos" element={<TermsOfService />} />
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
