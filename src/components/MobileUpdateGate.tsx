import { useEffect, useRef, useState } from 'react'
import { isNativeMobileApp } from '../lib/platform'
import { ApkUpdater, fetchLatestApk, isNewerVersion } from '../lib/mobileUpdate'

// Tela de "Atualizando o Mamacos Voip..." do app Android — igual a do
// app de PC: ao abrir, se tem versão nova, baixa sozinho e abre o
// instalador. Sem internet ou sem versão nova, não aparece nada.

type State =
  | { kind: 'idle' }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'install'; version: string; needsPermission: boolean }
  | { kind: 'error'; version: string; message: string }

export function MobileUpdateGate() {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const versionRef = useRef('')

  useEffect(() => {
    if (!isNativeMobileApp()) return
    const ctrl = new AbortController()
    let progressHandle: { remove: () => Promise<void> } | null = null
    let resumeHandle: { remove: () => Promise<void> } | null = null
    void (async () => {
      try {
        const { App } = await import('@capacitor/app')
        const info = await App.getInfo()
        const latest = await fetchLatestApk(ctrl.signal)
        if (!latest || !isNewerVersion(latest.version, info.version) || ctrl.signal.aborted) return
        versionRef.current = latest.version
        setState({ kind: 'downloading', version: latest.version, percent: 0 })
        progressHandle = await ApkUpdater.addListener('progress', ({ percent }) =>
          setState((s) => (s.kind === 'downloading' ? { ...s, percent } : s))
        )
        await ApkUpdater.download({ url: latest.apkUrl })
        const { needsPermission } = await ApkUpdater.install()
        setState({ kind: 'install', version: latest.version, needsPermission })
        // Voltou da tela de permissão: tenta instalar de novo sozinho.
        resumeHandle = await App.addListener('resume', () => {
          void ApkUpdater.install()
            .then(({ needsPermission: still }) => setState({ kind: 'install', version: latest.version, needsPermission: still }))
            .catch(() => {})
        })
      } catch (err) {
        if (ctrl.signal.aborted) return
        if (versionRef.current) {
          setState({
            kind: 'error',
            version: versionRef.current,
            message: err instanceof Error ? err.message : 'Não foi possível atualizar agora.',
          })
        }
      }
    })()
    return () => {
      ctrl.abort()
      void progressHandle?.remove()
      void resumeHandle?.remove()
    }
  }, [])

  if (state.kind === 'idle') return null

  const close = () => setState({ kind: 'idle' })
  return (
    <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center bg-mv-canvas/95 backdrop-blur-sm px-8 text-center animate-fade-in">
      <div className="relative w-28 h-28 mb-6">
        <span className="absolute inset-0 rounded-full border-2 border-mv-accent/20" aria-hidden />
        <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-mv-accent animate-spin" aria-hidden />
        <img src="/logo-192.png" alt="" className="absolute inset-3 w-[88px] h-[88px] rounded-full object-cover animate-pulse" />
      </div>
      {state.kind === 'downloading' && (
        <>
          <p className="text-[17px] font-semibold text-white">Atualizando o Mamacos Voip...</p>
          <p className="mt-1 text-[13px] text-mv-muted">Versão {state.version}</p>
          <div className="mt-5 w-56 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-brand-gradient transition-all" style={{ width: `${state.percent}%` }} />
          </div>
          <p className="mt-2 text-[12px] tabular-nums text-mv-muted">{state.percent}%</p>
        </>
      )}
      {state.kind === 'install' && (
        <>
          <p className="text-[17px] font-semibold text-white">Atualização pronta</p>
          <p className="mt-2 max-w-xs text-[13.5px] text-mv-muted">
            {state.needsPermission
              ? 'Permita "Instalar apps desta fonte" pro Mamacos Voip na tela que abriu e volte aqui.'
              : 'Toque em "Instalar" na janela do Android pra terminar.'}
          </p>
          <div className="mt-5 flex gap-2">
            <button
              onClick={() =>
                void ApkUpdater.install()
                  .then(({ needsPermission }) => setState({ kind: 'install', version: state.version, needsPermission }))
                  .catch(() => {})
              }
              className="btn-primary h-10 px-5 text-sm"
            >
              Instalar
            </button>
            <button onClick={close} className="btn-secondary h-10 px-4 text-sm">
              Agora não
            </button>
          </div>
        </>
      )}
      {state.kind === 'error' && (
        <>
          <p className="text-[17px] font-semibold text-white">Não deu pra atualizar agora</p>
          <p className="mt-2 max-w-xs text-[13px] text-mv-muted">{state.message}</p>
          <button onClick={close} className="btn-secondary mt-5 h-10 px-5 text-sm">
            Continuar
          </button>
        </>
      )}
    </div>
  )
}
