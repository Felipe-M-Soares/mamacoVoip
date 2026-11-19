import { useEffect, useRef } from 'react'

export function useClickOutside<T extends HTMLElement>(active: boolean, onOutside: () => void) {
  const ref = useRef<T | null>(null)
  const onOutsideRef = useRef(onOutside)
  onOutsideRef.current = onOutside

  useEffect(() => {
    if (!active) return

    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutsideRef.current()
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onOutsideRef.current()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [active])

  return ref
}
