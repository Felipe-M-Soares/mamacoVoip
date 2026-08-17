import { useEffect, useRef, useState } from 'react'

export function useGameJustDetected() {
  const [justDetectedGame, setJustDetectedGame] = useState<string | null>(null)
  const previousGameRef = useRef<string | null>(null)

  useEffect(() => {
    if (!window.electronAPI) return
    return window.electronAPI.onGameStatusChanged((game) => {
      if (game && game !== previousGameRef.current) {
        setJustDetectedGame(game)
      }
      previousGameRef.current = game
    })
  }, [])

  function dismiss() {
    setJustDetectedGame(null)
  }

  return { justDetectedGame, dismiss }
}
