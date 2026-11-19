import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { VoiceConnectionQuality, VoiceContextValue, VoiceParticipant } from './VoiceContext'

export type VoiceParticipantInfo = Omit<VoiceParticipant, 'speaking'>

export type VoiceCoreValue = Omit<VoiceContextValue, 'speaking' | 'connectionQuality' | 'localConnectionQuality' | 'participants'> & {
  participants: Record<string, VoiceParticipantInfo>
}

interface ActivitySnapshot {
  selfId: string | null
  localSpeaking: boolean
  participants: Record<string, VoiceParticipant>
  connectionQuality: Record<string, VoiceConnectionQuality>
  localConnectionQuality: VoiceConnectionQuality | null
}

function createActivityStore() {
  let snapshot: ActivitySnapshot = {
    selfId: null,
    localSpeaking: false,
    participants: {},
    connectionQuality: {},
    localConnectionQuality: null,
  }
  const listeners = new Set<() => void>()
  return {
    get: () => snapshot,
    set(next: ActivitySnapshot) {
      const prev = snapshot
      if (
        prev.selfId === next.selfId &&
        prev.localSpeaking === next.localSpeaking &&
        prev.participants === next.participants &&
        prev.connectionQuality === next.connectionQuality &&
        prev.localConnectionQuality === next.localConnectionQuality
      ) {
        return
      }
      snapshot = next
      listeners.forEach((l) => l())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
type ActivityStore = ReturnType<typeof createActivityStore>

export const VoiceCoreContext = createContext<VoiceCoreValue | undefined>(undefined)
export const VoiceActivityContext = createContext<ActivityStore | undefined>(undefined)

const noopSubscribe = () => () => {}
const EMPTY_SNAPSHOT: ActivitySnapshot = {
  selfId: null,
  localSpeaking: false,
  participants: {},
  connectionQuality: {},
  localConnectionQuality: null,
}

function useActivity<T>(selector: (s: ActivitySnapshot) => T): T {
  const store = useContext(VoiceActivityContext)
  return useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    () => selector(store ? store.get() : EMPTY_SNAPSHOT)
  )
}

export function useVoiceSpeaking(userId: string | null | undefined): boolean {
  return useActivity((s) => {
    if (!userId) return false
    if (userId === s.selfId) return s.localSpeaking
    return s.participants[userId]?.speaking ?? false
  })
}

export function useVoiceSpeakingKey(): string {
  return useActivity((s) => {
    const ids: string[] = []
    if (s.selfId && s.localSpeaking) ids.push(s.selfId)
    for (const [id, p] of Object.entries(s.participants)) if (p?.speaking) ids.push(id)
    return ids.sort().join(',')
  })
}

export function useVoiceConnectionQuality(userId: string | null | undefined): VoiceConnectionQuality | undefined {
  return useActivity((s) => (userId ? s.connectionQuality[userId] : undefined))
}

export function useLocalVoiceConnectionQuality(): VoiceConnectionQuality | null {
  return useActivity((s) => s.localConnectionQuality)
}

type AnyFn = (...args: unknown[]) => unknown

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>) {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is(a[k], b[k]))
}

function useStableObject<T extends object>(obj: T, version: unknown = null): T {
  const latestRef = useRef(obj)
  latestRef.current = obj
  const proxiesRef = useRef(new Map<string, AnyFn>())
  const prevRef = useRef<{ value: T; version: unknown } | null>(null)

  const candidate = {} as Record<string, unknown>
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'function') {
      let proxy = proxiesRef.current.get(k)
      if (!proxy) {
        proxy = (...args: unknown[]) => ((latestRef.current as Record<string, unknown>)[k] as AnyFn)(...args)
        proxiesRef.current.set(k, proxy)
      }
      candidate[k] = proxy
    } else {
      candidate[k] = v
    }
  }

  const prev = prevRef.current
  if (prev && Object.is(prev.version, version)) {
    const p = prev.value as Record<string, unknown>
    const keys = Object.keys(candidate)
    const same =
      keys.length === Object.keys(p).length &&
      keys.every((k) => {
        const a = candidate[k]
        const b = p[k]
        return Object.is(a, b) || (isPlainObject(a) && isPlainObject(b) && shallowEqual(a, b))
      })
    if (same) return prev.value
  }
  const value = candidate as T
  prevRef.current = { value, version }
  return value
}

function useParticipantsWithoutSpeaking(participants: Record<string, VoiceParticipant>): Record<string, VoiceParticipantInfo> {
  const prevRef = useRef(participants)
  const prev = prevRef.current
  if (prev === participants) return prev
  const ids = Object.keys(participants)
  const same =
    ids.length === Object.keys(prev).length &&
    ids.every((id) => {
      const a = participants[id]
      const b = prev[id]
      return (
        b !== undefined &&
        a.userId === b.userId &&
        a.cameraStream === b.cameraStream &&
        a.screenStream === b.screenStream &&
        a.micAudioStream === b.micAudioStream &&
        a.screenAudioStream === b.screenAudioStream
      )
    })
  if (same) return prev
  prevRef.current = participants
  return participants
}

export function useSplitVoiceValue(raw: VoiceContextValue, selfId: string | null, version: unknown) {
  const { speaking, connectionQuality, localConnectionQuality, participants, audioSettings, screenShareQuality, ...rest } = raw
  const stableAudioSettings = useStableObject(audioSettings)
  const stableScreenShareQuality = useStableObject(screenShareQuality)
  const participantsCore = useParticipantsWithoutSpeaking(participants)
  const core = useStableObject<VoiceCoreValue>(
    { ...rest, audioSettings: stableAudioSettings, screenShareQuality: stableScreenShareQuality, participants: participantsCore },
    version
  )
  const full = useMemo<VoiceContextValue>(
    () => ({ ...core, participants, speaking, connectionQuality, localConnectionQuality }),
    [core, participants, speaking, connectionQuality, localConnectionQuality]
  )
  const [store] = useState(createActivityStore)
  useLayoutEffect(() => {
    store.set({ selfId, localSpeaking: speaking, participants, connectionQuality, localConnectionQuality })
  }, [store, selfId, speaking, participants, connectionQuality, localConnectionQuality])
  return { full, core, store }
}
