import { useSyncExternalStore } from 'react'

// Visualizador de imagem/vídeo dentro do próprio app (em vez de abrir uma
// aba do navegador). Qualquer lugar chama openMedia(); o <MediaViewer />
// montado uma vez no layout mostra.
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
