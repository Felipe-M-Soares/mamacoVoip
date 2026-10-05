import { useSyncExternalStore } from 'react'

// Quem está em qual sala de voz do servidor aberto — alimentado pela
// lista de participantes da barra lateral (que já observa cada sala) e
// lido pela lista de membros pra mostrar "Em voz · Sala".
const byChannel = new Map<string, string[]>()
let snapshot = new Map<string, string>() // userId -> channelId
let channelSnapshot = new Map<string, string[]>() // channelId -> userIds
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

/** Map userId → channelId de quem está em alguma sala de voz. */
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

/** Quem está numa sala de voz específica. */
export function useVoiceRosterChannel(channelId: string): string[] {
  return useSyncExternalStore(
    subscribe,
    () => channelSnapshot.get(channelId) ?? EMPTY,
    () => channelSnapshot.get(channelId) ?? EMPTY
  )
}

/** Map channelId → quem está nela (todas as salas observadas). */
export function useVoiceRosterByChannel(): Map<string, string[]> {
  return useSyncExternalStore(subscribe, () => channelSnapshot, () => channelSnapshot)
}
