import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

if (window.electronAPI?.isElectron) {
  document.documentElement.classList.add('mv-electron')
}

const root = createRoot(document.getElementById('root')!)

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

function handleWindowError(e: ErrorEvent) {
  showFatalError(`${e.message}${e.filename ? `\n(${e.filename}:${e.lineno})` : ''}`)
}
function handleUnhandledRejection(e: PromiseRejectionEvent) {
  const reason = e.reason
  showFatalError(reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason))
}

window.addEventListener('error', handleWindowError)
window.addEventListener('unhandledrejection', handleUnhandledRejection)

function detachStartupErrorHandlers() {
  window.removeEventListener('error', handleWindowError)
  window.removeEventListener('unhandledrejection', handleUnhandledRejection)
}

function logRuntimeErrorToFile(source: string, detail: string) {
  try {
    window.electronAPI?.logDebug?.(`[${source}] ${detail}`)
  } catch {
  }
}
window.addEventListener('error', (e) => {
  logRuntimeErrorToFile('window:error', `${e.message}${e.filename ? ` (${e.filename}:${e.lineno})` : ''}`)
})
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason
  logRuntimeErrorToFile('window:unhandledrejection', reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason))
})

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
      setTimeout(detachStartupErrorHandlers, 3000)
    })
    .catch((err) => {
      showFatalError(err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err))
    })
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
    })
  })
}
