import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const root = createRoot(document.getElementById('root')!)

// Checa ANTES de importar o resto do app — se importássemos ./App.tsx
// de forma estática lá em cima, o cliente do Supabase seria avaliado
// (e travaria, se faltar configuração) antes mesmo dessa checagem
// rodar. Com import() dinâmico, só carregamos o resto do app depois de
// confirmar que a configuração existe.
const hasSupabaseConfig = Boolean(import.meta.env.VITE_SUPABASE_URL) && Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)

if (!hasSupabaseConfig) {
  root.render(
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        background: '#09090a',
        color: '#f3efee',
        fontFamily: 'system-ui, sans-serif',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '20px', margin: 0 }}>Configuração ausente</h1>
      <p style={{ color: '#a39a9c', maxWidth: '420px', margin: 0 }}>
        As variáveis <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> não foram definidas
        na hora de gerar este build. Configure-as e gere o build de novo.
      </p>
    </div>,
  )
} else {
  import('./App.tsx').then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
}

// Service worker só em produção — em dev ele atrapalha o hot reload do Vite
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // instalação do service worker é best-effort — não bloqueia o app
    })
  })
}
