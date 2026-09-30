import { useEffect, useRef, useState } from 'react'
import { useAppUpdater } from '../../hooks/useAppUpdater'

export function UpdateStatusBadge() {
  const { status, restart } = useAppUpdater()
  const [dismissedError, setDismissedError] = useState(false)
  const [dismissedUpToDate, setDismissedUpToDate] = useState(false)
  const [applying, setApplying] = useState(false)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    if (applying) return
    setApplying(true)
    // AUDITORIA: antes, se o reinício falhasse (ou não houvesse
    // atualização baixada de fato), a tela cheia de "Aplicando
    // atualização..." ficava travada pra sempre, cobrindo o app inteiro.
    // Agora, se o processo principal recusar/falhar, a tela some.
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null
      restart()
        .then((scheduled) => {
          if (scheduled === false) setApplying(false)
        })
        .catch(() => setApplying(false))
    }, 900)
  }

  useEffect(() => {
    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current)
    }
  }, [])

  // Se o processo principal avisar erro enquanto a tela de "Aplicando"
  // está aberta (ex.: quitAndInstall falhou), volta pro app normal.
  useEffect(() => {
    if (status?.status === 'error') setApplying(false)
  }, [status?.status])

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
      <div className="fixed inset-0 z-[500] bg-mv-canvas flex flex-col items-center justify-center gap-5">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 500px 350px at 50% 42%, color-mix(in srgb, var(--color-mv-accent) 22%, transparent), transparent 70%)',
          }}
        />
        <div className="relative w-20 h-20">
          <div className="w-20 h-20 rounded-[26px] bg-brand-gradient ring-1 ring-white/10 shadow-[0_20px_50px_-15px_var(--color-mv-accent)] flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-9 h-9 text-white">
              <path d="M12 3a1 1 0 0 1 1 1v9.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4l3.3 3.3V4a1 1 0 0 1 1-1zM4 19a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2H4z" />
            </svg>
          </div>
        </div>
        <p className="relative font-display font-semibold text-white">Aplicando atualização…</p>
        <div className="relative w-6 h-6 border-2 border-mv-accent border-t-transparent rounded-full animate-spin" role="status" aria-label="Aplicando atualização" />
      </div>
    )
  }

  if (!status) return null
  if (status.status === 'error' && dismissedError) return null
  if (status.status === 'up-to-date' && dismissedUpToDate) return null

  if (status.status === 'checking') {
    return (
      <div role="status" className="fixed bottom-4 right-4 z-[250] flex items-center gap-2 surface-elevated rounded-full pl-3 pr-4 py-2 animate-pop-in">
        <div className="w-3.5 h-3.5 border-2 border-mv-accent border-t-transparent rounded-full animate-spin shrink-0" />
        <span className="text-xs text-mv-muted">Verificando atualizações...</span>
      </div>
    )
  }

  if (status.status === 'up-to-date') {
    return (
      <div role="status" className="fixed bottom-4 right-4 z-[250] flex items-center gap-2 surface-elevated !border-mv-green/30 rounded-full pl-3 pr-4 py-2 animate-pop-in">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-mv-green shrink-0">
          <path d="M9 16.2l-3.5-3.5-1.4 1.4L9 19 20 8l-1.4-1.4z" />
        </svg>
        <span className="text-xs text-mv-muted">App atualizado</span>
      </div>
    )
  }

  if (status.status === 'downloading') {
    return (
      <div role="status" className="fixed bottom-4 right-4 z-[250] flex items-center gap-2.5 surface-elevated rounded-full pl-3 pr-4 py-2 animate-pop-in">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-mv-accent shrink-0 animate-bounce">
          <path d="M12 3a1 1 0 0 1 1 1v9.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4l3.3 3.3V4a1 1 0 0 1 1-1zM4 19a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2H4z" />
        </svg>
        <span className="text-xs text-mv-text">
          Baixando atualização{typeof status.percent === 'number' ? ` (${status.percent}%)` : '...'}
        </span>
      </div>
    )
  }

  if (status.status === 'ready') {
    return (
      <div role="status" className="fixed bottom-4 right-4 z-[250] flex items-center gap-3 surface-elevated !border-mv-green/30 rounded-full pl-3 pr-1.5 py-1.5 animate-pop-in">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-mv-green shrink-0">
          <path d="M9 16.2l-3.5-3.5-1.4 1.4L9 19 20 8l-1.4-1.4z" />
        </svg>
        <span className="text-xs text-mv-text">
          Atualização {status.version ? `v${status.version} ` : ''}pronta
        </span>
        <button
          onClick={handleRestart}
          className="text-xs h-7 px-3.5 rounded-full bg-mv-green text-white font-semibold hover:brightness-110 transition-all"
        >
          Reiniciar
        </button>
      </div>
    )
  }

  // status === 'error'
  return (
    <div role="alert" className="fixed bottom-4 right-4 z-[250] max-w-sm flex items-start gap-2.5 surface-elevated !border-rose-500/25 rounded-xl px-3.5 py-3 animate-pop-in">
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-rose-400 shrink-0 mt-0.5">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2zm0-4h-2V7h2z" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-mv-text">Não foi possível verificar atualizações</p>
        {status.message && (
          <>
            <p className="text-[10px] text-mv-muted/70 mt-0.5 break-words max-h-24 overflow-y-auto font-mono">
              {status.message}
            </p>
            <div className="flex items-center gap-3 mt-1.5">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(status.message ?? '').catch(() => {
                    // sem permissão de área de transferência — nada a fazer
                  })
                }}
                className="text-[11px] font-medium text-mv-accent hover:underline"
              >
                Copiar detalhes
              </button>
              {status.downloadUrl && (
                <a
                  href={status.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-mv-green hover:underline font-medium"
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
