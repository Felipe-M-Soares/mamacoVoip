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

// A confirmação de idade mora em `user_private_settings` (migration 016),
// legível SÓ pela própria pessoa — antes ficava em
// profiles.age_verified_adult_at, que qualquer um que visse o perfil lia.
// O banco usa esse valor pra liberar a leitura de canais +18 (RLS de
// messages), então a confirmação precisa estar salvo lá, não só local.
//
// Store no nível do módulo: vários componentes usam o hook ao mesmo tempo
// (ChatArea, Busca, Configurações) e todos precisam ver a mesma coisa
// logo depois de confirmar/revogar.
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
  // Erro de rede/banco: fica "não carregado" (vale a cópia local e uma
  // próxima montagem tenta de novo) — não apaga a confirmação por engano.
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

/**
 * Estado de conteúdo +18 da pessoa logada: se já confirmou a idade
 * (no banco ou cópia local), a preferência "mostrar conteúdo +18" e as
 * ações de confirmar/revogar. Ver lib/adultContent.ts.
 */
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
  // Depois que o banco respondeu, vale SÓ o que está no banco (a RLS de
  // messages usa esse valor — a cópia local sozinha só mostraria o
  // aviso sumindo sem liberar nada). A cópia local só serve pra não
  // piscar o aviso enquanto o banco ainda não respondeu.
  const verified = loadedFromDb ? !!verifiedAt : locallyConfirmed

  // Banco diz "não confirmado" → apaga a cópia local (revogada em outro
  // aparelho, conta recriada etc.).
  useEffect(() => {
    if (loadedFromDb && !verifiedAt && locallyConfirmed) setLocallyConfirmedAdult(null)
  }, [loadedFromDb, verifiedAt, locallyConfirmed])

  const confirmAdult = useCallback(async (): Promise<{ error: string | null }> => {
    if (!userId) return { error: 'Não autenticado' }
    // O banco troca o valor pela hora do servidor (gatilho da 015/016).
    const { data, error } = await supabase
      .from('user_private_settings')
      .upsert({ user_id: userId, age_verified_adult_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .select('age_verified_adult_at')
      .maybeSingle()
    if (error) {
      console.warn('[useAdultContent] Não foi possível salvar a confirmação de idade:', error.message)
      return { error: 'Não foi possível salvar a confirmação de idade. Tente de novo.' }
    }
    // Cópia local só depois que o banco aceitou.
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
