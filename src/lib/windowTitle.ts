import { useSyncExternalStore } from 'react'

// "Onde você está" (servidor aberto, Início, conversa) — mostrado no
// centro da barra de título do app e no título da janela/aba.
export type WindowPlace = { label: string; iconUrl?: string | null } | null

let current: WindowPlace = null
const listeners = new Set<() => void>()

export function setWindowPlace(place: WindowPlace) {
  if (current?.label === place?.label && current?.iconUrl === place?.iconUrl) return
  current = place
  document.title = place ? `${place.label} — Mamacos Voip` : 'Mamacos Voip'
  listeners.forEach((l) => l())
}

export function useWindowPlace(): WindowPlace {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
    () => null
  )
}
