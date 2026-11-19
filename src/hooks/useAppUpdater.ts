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
    api
      .getUpdateStatus?.()
      .then((payload) => {
        if (!cancelled && !receivedLiveEvent && payload) setStatus(payload)
      })
      .catch(() => {
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  function restart(): Promise<unknown> {
    return window.electronAPI?.restartToUpdate() ?? Promise.resolve(false)
  }

  function checkNow() {
    window.electronAPI?.checkForUpdatesNow()
  }

  return { status, restart, checkNow }
}
