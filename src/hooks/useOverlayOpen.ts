import { useEffect, useState } from 'react'

// Tem algo aberto POR CIMA do app agora (modal, tour, menu lateral do
// celular)? Avisos flutuantes usam isso pra sair da frente em vez de
// ficar sobrepostos (no celular cobriam o tour, o menu e os modais).
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
