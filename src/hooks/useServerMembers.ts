import { useCallback, useSyncExternalStore } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { changesChannel } from '../lib/realtimeChannel'
import type { Profile, ServerMember } from '../types/database'

export type ServerMemberWithProfile = ServerMember & { profile: Profile }

interface Snapshot {
  members: ServerMemberWithProfile[]
  loading: boolean
}

interface Entry {
  snapshot: Snapshot
  listeners: Set<() => void>
  channel: RealtimeChannel | null
  loadSeq: number
  releaseTimer: ReturnType<typeof setTimeout> | null
  reloadTimer: ReturnType<typeof setTimeout> | null
}

const RELEASE_DELAY_MS = 30_000
const EMPTY_SNAPSHOT: Snapshot = { members: [], loading: false }
const store = new Map<string, Entry>()

function emit(entry: Entry, next: Snapshot) {
  entry.snapshot = next
  entry.listeners.forEach((l) => l())
}

function scheduleRelease(serverId: string, entry: Entry) {
  if (entry.releaseTimer) clearTimeout(entry.releaseTimer)
  entry.releaseTimer = setTimeout(() => {
    if (entry.listeners.size > 0) return
    if (entry.channel) void supabase.removeChannel(entry.channel)
    if (entry.reloadTimer) clearTimeout(entry.reloadTimer)
    entry.channel = null
    store.delete(serverId)
  }, RELEASE_DELAY_MS)
}

function getEntry(serverId: string): Entry {
  let entry = store.get(serverId)
  if (!entry) {
    entry = {
      snapshot: { members: [], loading: true },
      listeners: new Set(),
      channel: null,
      loadSeq: 0,
      releaseTimer: null,
      reloadTimer: null,
    }
    store.set(serverId, entry)
    scheduleRelease(serverId, entry)
  }
  return entry
}

async function load(serverId: string) {
  const entry = store.get(serverId)
  if (!entry) return
  const seq = ++entry.loadSeq
  try {
    const { data: memberRows, error } = await supabase.from('server_members').select('*').eq('server_id', serverId)
    if (error) throw error
    let merged: ServerMemberWithProfile[] = []
    if (memberRows && memberRows.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .in(
          'id',
          memberRows.map((m) => m.user_id)
        )
      if (profilesError) throw profilesError
      const byId = new Map((profiles ?? []).map((p) => [p.id, p]))
      merged = memberRows.flatMap((m) => {
        const profile = byId.get(m.user_id)
        return profile ? [{ ...m, profile }] : []
      })
    }
    if (store.get(serverId) !== entry || seq !== entry.loadSeq) return
    emit(entry, { members: merged, loading: false })
  } catch (err) {
    console.error('[useServerMembers] Falha ao carregar membros:', err)
    if (store.get(serverId) === entry && seq === entry.loadSeq) emit(entry, { ...entry.snapshot, loading: false })
  }
}

function scheduleReload(serverId: string, entry: Entry) {
  if (entry.reloadTimer) clearTimeout(entry.reloadTimer)
  entry.reloadTimer = setTimeout(() => {
    entry.reloadTimer = null
    void load(serverId)
  }, 300)
}

function subscribe(serverId: string, listener: () => void): () => void {
  const entry = getEntry(serverId)
  entry.listeners.add(listener)
  if (entry.releaseTimer) {
    clearTimeout(entry.releaseTimer)
    entry.releaseTimer = null
  }

  installProfileRefresh()
  if (!entry.channel) {
    void load(serverId)
    let hadProblem = false
    const channel = changesChannel(`server_members:${serverId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'server_members', filter: `server_id=eq.${serverId}` }, () =>
        scheduleReload(serverId, entry)
      )
      .subscribe((status) => {
        if (entry.channel !== channel) return
        if (status === 'SUBSCRIBED') {
          if (hadProblem) scheduleReload(serverId, entry)
          hadProblem = false
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          hadProblem = true
          scheduleReload(serverId, entry)
        }
      })
    entry.channel = channel
  }

  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0) scheduleRelease(serverId, entry)
  }
}

let profileRefreshInstalled = false
function installProfileRefresh() {
  if (profileRefreshInstalled || typeof window === 'undefined') return
  profileRefreshInstalled = true
  const reloadAll = () => {
    for (const [serverId, entry] of store) {
      if (entry.listeners.size > 0) scheduleReload(serverId, entry)
    }
  }
  window.addEventListener('focus', reloadAll)
  window.addEventListener('mv:profile-updated', reloadAll)
  window.setInterval(() => {
    if (document.visibilityState === 'visible') reloadAll()
  }, 90_000)
}

export function useServerMembers(serverId: string | null) {
  const subscribeFn = useCallback((listener: () => void) => (serverId ? subscribe(serverId, listener) : () => {}), [serverId])
  const getSnapshot = useCallback(() => (serverId ? getEntry(serverId).snapshot : EMPTY_SNAPSHOT), [serverId])
  const snapshot = useSyncExternalStore(subscribeFn, getSnapshot, getSnapshot)
  const refresh = useCallback(async () => {
    if (!serverId) return
    getEntry(serverId)
    await load(serverId)
  }, [serverId])
  return { members: snapshot.members, loading: snapshot.loading, refresh }
}
