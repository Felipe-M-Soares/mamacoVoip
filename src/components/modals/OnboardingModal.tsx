import { useState } from 'react'

function seenKey(userId: string) {
  return `mamacos-onboarding-seen:${userId}`
}

// Primeiro uso: mostra o convite pro tour guiado (components/GuidedTour).
// Mesma ideia do useServerWelcomeScreen (ServerWelcomeModal.tsx): só
// guarda localmente que a pessoa já viu, sem precisar de coluna nova
// no banco pra algo que é puramente de interface.
export function useOnboarding(userId: string | undefined) {
  const [show, setShow] = useState(() => {
    if (!userId) return false
    try {
      return !localStorage.getItem(seenKey(userId))
    } catch {
      return false
    }
  })

  function dismiss() {
    if (userId) {
      try {
        localStorage.setItem(seenKey(userId), '1')
      } catch {
        // best-effort
      }
    }
    setShow(false)
  }

  return { show, dismiss }
}
