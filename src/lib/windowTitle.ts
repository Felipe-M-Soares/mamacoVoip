import { useSyncExternalStore } from 'react'

export type WindowPlace = { label: string; iconUrl?: string | null } | null

let current: WindowPlace = null
let unreadCount = 0
const listeners = new Set<() => void>()

function applyTitle() {
  const base = current ? `${current.label} — Mamacos Voip` : 'Mamacos Voip'
  document.title = unreadCount > 0 ? `(${unreadCount > 9 ? '9+' : unreadCount}) ${base}` : base
}

export function setWindowPlace(place: WindowPlace) {
  if (current?.label === place?.label && current?.iconUrl === place?.iconUrl) return
  current = place
  applyTitle()
  listeners.forEach((l) => l())
}

export function setWindowUnreadCount(count: number) {
  if (count === unreadCount) return
  unreadCount = count
  applyTitle()
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
