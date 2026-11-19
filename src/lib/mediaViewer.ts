import { useSyncExternalStore } from 'react'

export type MediaItem = { src: string; kind: 'image' | 'video'; name?: string }

let current: MediaItem | null = null
const listeners = new Set<() => void>()

export function openMedia(item: MediaItem) {
  current = item
  listeners.forEach((l) => l())
}

export function closeMedia() {
  current = null
  listeners.forEach((l) => l())
}

export function useOpenMedia(): MediaItem | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
    () => null
  )
}
