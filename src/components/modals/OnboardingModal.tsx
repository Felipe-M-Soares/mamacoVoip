import { useState } from 'react'

function seenKey(userId: string) {
  return `mamacos-onboarding-seen:${userId}`
}

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
      }
    }
    setShow(false)
  }

  return { show, dismiss }
}
