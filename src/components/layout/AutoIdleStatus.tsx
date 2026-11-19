import { useEffect, useRef } from 'react'
import { useAuth } from '../../hooks/useAuth'

const IDLE_AFTER_MS = 10 * 60 * 1000

export function AutoIdleStatus() {
  const { profile, updateStatus } = useAuth()
  const autoIdleRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function resetTimer() {
      if (autoIdleRef.current && profile?.status === 'idle') {
        autoIdleRef.current = false
        updateStatus('online')
      }
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        if (profile?.status === 'online') {
          autoIdleRef.current = true
          updateStatus('idle')
        }
      }, IDLE_AFTER_MS)
    }

    resetTimer()
    window.addEventListener('mousemove', resetTimer)
    window.addEventListener('keydown', resetTimer)
    window.addEventListener('mousedown', resetTimer)

    return () => {
      window.removeEventListener('mousemove', resetTimer)
      window.removeEventListener('keydown', resetTimer)
      window.removeEventListener('mousedown', resetTimer)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.status])

  return null
}
