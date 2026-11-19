import { useSyncExternalStore } from 'react'

export type StreamQuality = 'auto' | 'media' | 'baixa'

type State = { hidden: ReadonlySet<string>; focused: string | null; quality: ReadonlyMap<string, StreamQuality> }

let state: State = { hidden: new Set(), focused: null, quality: new Map() }
const listeners = new Set<() => void>()
const seen = new Set<string>()

function set(next: State) {
  state = next
  listeners.forEach((l) => l())
}

export function useStreamView(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
    () => state
  )
}

export function getStreamView(): State {
  return state
}

export function subscribeStreamView(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function syncActiveStreams(active: ReadonlySet<string>, startClosed = true) {
  const hidden = new Set(state.hidden)
  let focused = state.focused
  let changed = false
  for (const key of [...seen]) {
    if (active.has(key)) continue
    seen.delete(key)
    if (hidden.delete(key)) changed = true
    if (focused === key) {
      focused = null
      changed = true
    }
  }
  for (const key of active) {
    if (seen.has(key)) continue
    seen.add(key)
    if (startClosed && key !== 'local' && focused !== key && !hidden.has(key)) {
      hidden.add(key)
      changed = true
    }
  }
  let quality = state.quality
  for (const key of quality.keys()) {
    if (active.has(key)) continue
    if (quality === state.quality) quality = new Map(quality)
    ;(quality as Map<string, StreamQuality>).delete(key)
    changed = true
  }
  if (changed) set({ hidden, focused, quality })
}

export function setStreamQuality(key: string, q: StreamQuality) {
  if ((state.quality.get(key) ?? 'auto') === q) return
  const quality = new Map(state.quality)
  if (q === 'auto') quality.delete(key)
  else quality.set(key, q)
  set({ ...state, quality })
}

export function getStreamQuality(key: string): StreamQuality {
  return state.quality.get(key) ?? 'auto'
}

export function hideStream(key: string) {
  const hidden = new Set(state.hidden)
  hidden.add(key)
  set({ ...state, hidden, focused: state.focused === key ? null : state.focused })
}

export function showStream(key: string) {
  if (!state.hidden.has(key)) return
  const hidden = new Set(state.hidden)
  hidden.delete(key)
  set({ ...state, hidden })
}

export function focusStream(key: string | null) {
  if (key === null) {
    set({ ...state, focused: null })
    return
  }
  const hidden = new Set(state.hidden)
  hidden.delete(key)
  set({ ...state, hidden, focused: key })
}

export function resetStreamView() {
  seen.clear()
  if (state.hidden.size === 0 && state.focused === null && state.quality.size === 0) return
  set({ hidden: new Set(), focused: null, quality: new Map() })
}

export function requestWatchStream(serverId: string, channelId: string, key: string) {
  focusStream(key)
  window.dispatchEvent(new CustomEvent('mv:open-voice-room', { detail: { serverId, channelId } }))
}
