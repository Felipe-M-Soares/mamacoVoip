import { useEffect, useState } from 'react'
import type { UpdateStatusPayload } from './useGamePresence'

export function useAppUpdater() {
  const [status, setStatus] = useState<UpdateStatusPayload | null>(null)

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    let cancelled = false
    let receivedLiveEvent = false
    const unsubscribe = api.onUpdateStatus((payload) => {
      receivedLiveEvent = true
      setStatus(payload)
    })
    // AUDITORIA: eventos de atualização mandados ANTES deste componente
    // montar (ou antes de uma recarga da página) se perdiam — ex.: o
    // download terminava enquanto a página recarregava e o botão
    // "Reiniciar" nunca aparecia. Pede o último estado relevante
    // (baixando/pronta) ao processo principal logo ao montar; se um evento
    // "ao vivo" já chegou nesse meio-tempo, ele é mais novo e prevalece.
    api
      .getUpdateStatus?.()
      .then((payload) => {
        if (!cancelled && !receivedLiveEvent && payload) setStatus(payload)
      })
      .catch(() => {
        // versão antiga do processo principal sem esse canal — ignora
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  // Devolve a Promise pra quem chama poder reagir a uma falha (ex.: tirar
  // a tela de "Aplicando atualização..." se não der pra reiniciar).
  function restart(): Promise<unknown> {
    return window.electronAPI?.restartToUpdate() ?? Promise.resolve(false)
  }

  function checkNow() {
    window.electronAPI?.checkForUpdatesNow()
  }

  return { status, restart, checkNow }
}
