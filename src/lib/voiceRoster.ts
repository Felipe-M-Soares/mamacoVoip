import { useSyncExternalStore } from 'react'

const byChannel = new Map<string, string[]>()
let snapshot = new Map<string, string>()
let channelSnapshot = new Map<string, string[]>()
const listeners = new Set<() => void>()

function rebuild() {
  const next = new Map<string, string>()
  for (const [channelId, ids] of byChannel) for (const id of ids) next.set(id, channelId)
  snapshot = next
  channelSnapshot = new Map(byChannel)
  listeners.forEach((l) => l())
}

export function setVoiceRoster(channelId: string, userIds: string[]) {
  const prev = byChannel.get(channelId)
  if (prev && prev.length === userIds.length && prev.every((id, i) => id === userIds[i])) return
  if (userIds.length === 0) byChannel.delete(channelId)
  else byChannel.set(channelId, userIds)
  rebuild()
}

export function clearVoiceRoster(channelId: string) {
  if (!byChannel.has(channelId)) return
  byChannel.delete(channelId)
  rebuild()
}

export function useVoiceRoster(): Map<string, string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
    () => snapshot
  )
}

const EMPTY: string[] = []
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useVoiceRosterChannel(channelId: string): string[] {
  return useSyncExternalStore(
    subscribe,
    () => channelSnapshot.get(channelId) ?? EMPTY,
    () => channelSnapshot.get(channelId) ?? EMPTY
  )
}

export function useVoiceRosterByChannel(): Map<string, string[]> {
  return useSyncExternalStore(subscribe, () => channelSnapshot, () => channelSnapshot)
}
