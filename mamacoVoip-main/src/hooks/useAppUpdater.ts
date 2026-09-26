import { useEffect, useState } from 'react'
import type { UpdateStatusPayload } from './useGamePresence'

export function useAppUpdater() {
  const [status, setStatus] = useState<UpdateStatusPayload | null>(null)

  useEffect(() => {
    if (!window.electronAPI) return
    const unsubscribe = window.electronAPI.onUpdateStatus((payload) => {
      setStatus(payload)
    })
    return unsubscribe
  }, [])

  function restart() {
    window.electronAPI?.restartToUpdate()
  }

  function checkNow() {
    window.electronAPI?.checkForUpdatesNow()
  }

  return { status, restart, checkNow }
}
