import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const root = createRoot(document.getElementById('root')!)

// Mostra QUALQUER erro que impeça o app de abrir direto na tela, em
// texto simples — sem isso, uma falha de inicialização vira uma tela
// preta muda, e a única forma de ver o motivo seria abrir as
// ferramentas de desenvolvedor manualmente (chato de fazer e de
// printar certinho). Fica registrado aqui uma única vez, antes de
// qualquer outra coisa rodar.
let errorShown = false
function showFatalError(message: string) {
  if (errorShown) return
  errorShown = true
  const el = document.getElementById('root')
  if (!el) return
  el.innerHTML = ''
  const container = document.createElement('div')
  container.style.cssText =
    'min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#09090a;color:#f3efee;font-family:system-ui,sans-serif;padding:24px;text-align:center;'
  container.innerHTML = `
    <h1 style="font-size:20px;margin:0;">Erro ao iniciar o app</h1>
    <p style="color:#a39a9c;max-width:560px;margin:0;font-size:13px;white-space:pre-wrap;word-break:break-word;font-family:monospace;">${message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</p>
  `
  el.appendChild(container)
}

window.addEventListener('error', (e) => {
  showFatalError(`${e.message}${e.filename ? `\n(${e.filename}:${e.lineno})` : ''}`)
})
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason
  showFatalError(reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason))
})

// Checa ANTES de importar o resto do app — se importássemos ./App.tsx
// de forma estática lá em cima, o cliente do Supabase seria avaliado
// (e travaria, se faltar configuração) antes mesmo dessa checagem
// rodar. Com import() dinâmico, só carregamos o resto do app depois de
// confirmar que a configuração existe.
const hasSupabaseConfig = Boolean(import.meta.env.VITE_SUPABASE_URL) && Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)

if (!hasSupabaseConfig) {
  showFatalError(
    'Configuração ausente: as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não foram definidas na hora de gerar este build.',
  )
} else {
  import('./App.tsx')
    .then(({ default: App }) => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      )
    })
    .catch((err) => {
      showFatalError(err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err))
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
