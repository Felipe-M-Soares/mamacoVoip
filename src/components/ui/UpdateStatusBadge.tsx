import { useEffect, useState } from 'react'
import { useAppUpdater } from '../../hooks/useAppUpdater'

export function UpdateStatusBadge() {
  const { status, restart } = useAppUpdater()
  const [dismissedError, setDismissedError] = useState(false)
  const [dismissedUpToDate, setDismissedUpToDate] = useState(false)
  const [applying, setApplying] = useState(false)

  // A janelinha nativa do Windows que aparece durante a instalação
  // silenciosa ("Instalando, por favor aguarde...") não tem como ser
  // customizada — é uma tela fixa do instalador NSIS, sem opção pra
  // trocar a barra horizontal por um anel de carregamento (o
  // electron-builder só deixa trocar o ÍCONE dela, que já é o nosso).
  // Em vez de tentar reescrever o instalador nativo (arriscado e sem
  // como testar direito), mostramos ANTES disso uma tela cheia com a
  // cara do app — mesmo anel vermelho pulsante + spinner que já aparece
  // ao abrir o app — pra pessoa ver algo com a nossa identidade primeiro.
  // A janela nativa some rápido (só o tempo de copiar o instalador já
  // baixado) e, logo depois, o app reabre sozinho já mostrando essa
  // mesma tela de novo (é a splash normal de abertura) — na prática,
  // o que a pessoa vê a maior parte do tempo é o visual do app, não o
  // do Windows.
  function handleRestart() {
    setApplying(true)
    setTimeout(restart, 900)
  }

  useEffect(() => {
    if (status?.status !== 'error') {
      setDismissedError(false)
      return
    }
    // Não checar com sucesso (ex: sem internet) não é um problema
    // grave o bastante pra ficar um alerta permanente na tela — some
    // sozinho depois de alguns segundos.
    const timer = setTimeout(() => setDismissedError(true), 6000)
    return () => clearTimeout(timer)
  }, [status?.status])

  useEffect(() => {
    if (status?.status !== 'up-to-date') {
      setDismissedUpToDate(false)
      return
    }
    // "Tudo certo" também não precisa ficar preso na tela pra sempre —
    // confirma rapidinho e some sozinho.
    const timer = setTimeout(() => setDismissedUpToDate(true), 3000)
    return () => clearTimeout(timer)
  }, [status?.status])

  if (applying) {
    return (
      <div className="fixed inset-0 z-[500] bg-discord-darker flex flex-col items-center justify-center gap-5">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 500px 350px at 50% 42%, color-mix(in srgb, var(--color-discord-blurple) 22%, transparent), transparent 70%)',
          }}
        />
        <div className="relative w-20 h-20">
          <div className="absolute inset-0 rounded-full border-2 border-discord-blurple/40 animate-ping" />
          <div className="w-20 h-20 rounded-full bg-discord-dark border border-white/10 brand-glow flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-9 h-9 text-discord-blurple">
              <path d="M12 3a1 1 0 0 1 1 1v9.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4l3.3 3.3V4a1 1 0 0 1 1-1zM4 19a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2H4z" />
            </svg>
          </div>
        </div>
        <div className="w-6 h-6 border-[3px] border-discord-blurple border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-discord-text-muted tracking-wide">Aplicando atualização...</p>
      </div>
    )
  }

  if (!status) return null
  if (status.status === 'error' && dismissedError) return null
  if (status.status === 'up-to-date' && dismissedUpToDate) return null

  if (status.status === 'checking') {
    return (
      <div className="fixed bottom-4 right-4 z-[250] flex items-center gap-2 bg-discord-darker border border-white/10 rounded-full pl-3 pr-4 py-2 shadow-xl">
        <div className="w-3.5 h-3.5 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin shrink-0" />
        <span className="text-xs text-discord-text-muted">Verificando atualizações...</span>
      </div>
    )
  }

  if (status.status === 'up-to-date') {
    return (
      <div className="fixed bottom-4 right-4 z-[250] flex items-center gap-2 bg-discord-darker border border-discord-green/40 rounded-full pl-3 pr-4 py-2 shadow-xl">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-discord-green shrink-0">
          <path d="M9 16.2l-3.5-3.5-1.4 1.4L9 19 20 8l-1.4-1.4z" />
        </svg>
        <span className="text-xs text-discord-text-muted">App atualizado</span>
      </div>
    )
  }

  if (status.status === 'downloading') {
    return (
      <div className="fixed bottom-4 right-4 z-[250] flex items-center gap-2.5 bg-discord-darker border border-white/10 rounded-full pl-3 pr-4 py-2 shadow-xl">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-discord-blurple shrink-0 animate-bounce">
          <path d="M12 3a1 1 0 0 1 1 1v9.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4l3.3 3.3V4a1 1 0 0 1 1-1zM4 19a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2H4z" />
        </svg>
        <span className="text-xs text-discord-text">
          Baixando atualização{typeof status.percent === 'number' ? ` (${status.percent}%)` : '...'}
        </span>
      </div>
    )
  }

  if (status.status === 'ready') {
    return (
      <div className="fixed bottom-4 right-4 z-[250] flex items-center gap-3 bg-discord-darker border border-discord-green/40 rounded-full pl-3 pr-2 py-2 shadow-xl brand-glow-sm">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-discord-green shrink-0">
          <path d="M9 16.2l-3.5-3.5-1.4 1.4L9 19 20 8l-1.4-1.4z" />
        </svg>
        <span className="text-xs text-discord-text">
          Atualização {status.version ? `v${status.version} ` : ''}pronta
        </span>
        <button
          onClick={handleRestart}
          className="text-xs px-3 py-1 rounded-full bg-discord-green text-discord-darker font-semibold hover:brightness-110 transition-all"
        >
          Reiniciar
        </button>
      </div>
    )
  }

  // status === 'error'
  return (
    <div className="fixed bottom-4 right-4 z-[250] max-w-sm flex items-start gap-2 bg-discord-darker border border-red-900/50 rounded-lg px-3 py-2.5 shadow-xl">
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-red-400 shrink-0 mt-0.5">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2zm0-4h-2V7h2z" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-discord-text-muted">Não foi possível verificar atualizações</p>
        {status.message && (
          <>
            <p className="text-[10px] text-discord-text-muted/70 mt-0.5 break-words max-h-24 overflow-y-auto font-mono">
              {status.message}
            </p>
            <div className="flex items-center gap-3 mt-1">
              <button
                onClick={() => navigator.clipboard.writeText(status.message ?? '')}
                className="text-[10px] text-discord-blurple hover:underline"
              >
                Copiar detalhes
              </button>
              {status.downloadUrl && (
                <a
                  href={status.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-discord-green hover:underline font-medium"
                >
                  Baixar manualmente
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
