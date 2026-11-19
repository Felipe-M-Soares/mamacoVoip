import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import {
  getShowAdultContent,
  isLocallyConfirmedAdult,
  setLocallyConfirmedAdult,
  setShowAdultContent,
  subscribeAdultContent,
} from '../lib/adultContent'

type VerifiedState = { userId: string | null; verifiedAt: string | null; loaded: boolean }
let state: VerifiedState = { userId: null, verifiedAt: null, loaded: false }
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null

function setState(next: VerifiedState) {
  state = next
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

async function loadVerifiedAt(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('user_private_settings')
    .select('age_verified_adult_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (state.userId !== userId) return
  if (error) return
  setState({ userId, verifiedAt: data?.age_verified_adult_at ?? null, loaded: true })
}

function ensureLoaded(userId: string | null) {
  if (state.userId === userId && (state.loaded || inflight)) return
  setState({ userId, verifiedAt: null, loaded: false })
  if (!userId) return
  inflight = loadVerifiedAt(userId).finally(() => {
    inflight = null
  })
}

export function useAdultContent() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const showAdult = useSyncExternalStore(subscribeAdultContent, getShowAdultContent, () => true)
  const locallyConfirmed = useSyncExternalStore(
    subscribeAdultContent,
    () => isLocallyConfirmedAdult(userId),
    () => false,
  )
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state)

  useEffect(() => {
    ensureLoaded(userId)
  }, [userId])

  const loadedFromDb = snapshot.userId === userId && snapshot.loaded
  const verifiedAt = snapshot.userId === userId ? snapshot.verifiedAt : null
  const verified = loadedFromDb ? !!verifiedAt : locallyConfirmed

  useEffect(() => {
    if (loadedFromDb && !verifiedAt && locallyConfirmed) setLocallyConfirmedAdult(null)
  }, [loadedFromDb, verifiedAt, locallyConfirmed])

  const confirmAdult = useCallback(async (): Promise<{ error: string | null }> => {
    if (!userId) return { error: 'Não autenticado' }
    const { data, error } = await supabase
      .from('user_private_settings')
      .upsert({ user_id: userId, age_verified_adult_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .select('age_verified_adult_at')
      .maybeSingle()
    if (error) {
      console.warn('[useAdultContent] Não foi possível salvar a confirmação de idade:', error.message)
      return { error: 'Não foi possível salvar a confirmação de idade. Tente de novo.' }
    }
    setLocallyConfirmedAdult(userId)
    setState({ userId, verifiedAt: data?.age_verified_adult_at ?? new Date().toISOString(), loaded: true })
    return { error: null }
  }, [userId])

  const revokeAdult = useCallback(async (): Promise<{ error: string | null }> => {
    if (!userId) return { error: 'Não autenticado' }
    setLocallyConfirmedAdult(null)
    const { error } = await supabase
      .from('user_private_settings')
      .upsert({ user_id: userId, age_verified_adult_at: null }, { onConflict: 'user_id' })
    if (error) return { error: 'Não foi possível revogar a confirmação. Tente de novo.' }
    setState({ userId, verifiedAt: null, loaded: true })
    return { error: null }
  }, [userId])

  return { verified, verifiedAt, showAdult, setShowAdult: setShowAdultContent, confirmAdult, revokeAdult }
}
