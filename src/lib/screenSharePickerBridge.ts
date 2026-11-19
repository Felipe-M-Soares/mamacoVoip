import type { ScreenShareSourcesPayload } from '../hooks/useGamePresence'

type Listener = (payload: ScreenShareSourcesPayload | null) => void

let listener: Listener | null = null
let pendingResolve: ((sourceId: string | null) => void) | null = null

export function subscribeScreenSharePicker(fn: Listener): () => void {
  listener = fn
  return () => {
    if (listener === fn) listener = null
  }
}

export function openScreenSharePicker(payload: ScreenShareSourcesPayload): Promise<string | null> {
  if (pendingResolve) {
    const resolve = pendingResolve
    pendingResolve = null
    resolve(null)
  }
  if (!listener) return Promise.resolve(null)
  const notify = listener
  return new Promise((resolve) => {
    pendingResolve = resolve
    notify(payload)
  })
}

export function resolveScreenSharePicker(sourceId: string | null) {
  const resolve = pendingResolve
  pendingResolve = null
  listener?.(null)
  resolve?.(sourceId)
}
