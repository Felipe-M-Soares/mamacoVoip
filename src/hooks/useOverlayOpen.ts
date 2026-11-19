import { useEffect, useState } from 'react'

const SELECTOR = '[aria-modal="true"], [data-overlay-open]'

export function useOverlayOpen(): boolean {
  const [open, setOpen] = useState(() => typeof document !== 'undefined' && !!document.querySelector(SELECTOR))
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector(SELECTOR))
    check()
    const obs = new MutationObserver(check)
    obs.observe(document.body, { childList: true, subtree: true })
    return () => obs.disconnect()
  }, [])
  return open
}
