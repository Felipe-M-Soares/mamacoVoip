import { useCallback, useSyncExternalStore } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { changesChannel } from '../lib/realtimeChannel'
import type { Profile, ServerMember } from '../types/database'

export type ServerMemberWithProfile = ServerMember & { profile: Profile }

// Armazenamento COMPARTILHADO por servidor.
//
// useServerMembers() é chamado ao mesmo tempo por vários componentes pro
// MESMO servidor (ChatArea, ChannelSidebar, MemberList, OverlayStateSync,
// ServerHoverCard, VoiceChannelView, SearchModal…). Antes cada chamada
// fazia a sua própria busca (server_members + profiles) E abria a sua
// própria assinatura de tempo real — com o servidor aberto eram 4–5 cópias
// idênticas de tudo, e cada entrada/saída de membro disparava 4–5 recargas
// completas. Agora existe uma entrada por servidor, com uma busca e uma
// assinatura só, compartilhadas por todo mundo que pedir aquele servidor.
// Quando o último componente solta o servidor, a entrada fica em cache por
// alguns segundos (ex.: passar o mouse de novo no mesmo ícone do
// ServerHoverCard não refaz a busca) e depois é descartada.

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
    // Se ninguém chegar a assinar (render descartado), não fica pra sempre.
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
      // Map em vez de `profiles.find()` dentro do loop (era O(n²)).
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

// Várias mudanças seguidas (ex.: alguém entra e recebe cargo) viram uma
// recarga só.
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
    // Sem isso, quem entrasse no servidor com ele já aberto não tinha o
    // perfil carregado (o aviso "entrou no servidor" mostrava "Alguém").
    let hadProblem = false
    const channel = changesChannel(`server_members:${serverId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'server_members', filter: `server_id=eq.${serverId}` }, () =>
        scheduleReload(serverId, entry)
      )
      .subscribe((status) => {
        if (entry.channel !== channel) return // canal já descartado
        if (status === 'SUBSCRIBED') {
          // voltou depois de uma queda: pega o que mudou enquanto estava fora
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

// Fotos/nomes de perfil não chegam em tempo real (a tabela profiles não
// está no Realtime, de propósito: status muda o tempo todo). Pra que uma
// foto nova apareça nas listas e salas sem precisar reiniciar o app,
// recarrega os servidores abertos ao voltar pra janela e a cada 90s com
// ela visível — uma consulta leve por servidor aberto.
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
