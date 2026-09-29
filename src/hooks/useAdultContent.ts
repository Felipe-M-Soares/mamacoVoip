import { useCallback, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import {
  getShowAdultContent,
  isLocallyConfirmedAdult,
  setLocallyConfirmedAdult,
  setShowAdultContent,
  subscribeAdultContent,
} from '../lib/adultContent'

/**
 * Estado de conteúdo +18 da pessoa logada: se já confirmou a idade
 * (perfil ou cópia local), a preferência "mostrar conteúdo +18" e as
 * ações de confirmar/revogar. Ver lib/adultContent.ts.
 */
export function useAdultContent() {
  const { user, profile, refreshProfile } = useAuth()
  const showAdult = useSyncExternalStore(subscribeAdultContent, getShowAdultContent, () => true)
  const locallyConfirmed = useSyncExternalStore(
    subscribeAdultContent,
    () => isLocallyConfirmedAdult(user?.id),
    () => false,
  )
  const verifiedAt = profile?.age_verified_adult_at ?? null
  const verified = !!verifiedAt || locallyConfirmed

  const confirmAdult = useCallback(async (): Promise<{ error: string | null }> => {
    if (!user) return { error: 'Não autenticado' }
    setLocallyConfirmedAdult(user.id)
    // O banco troca o valor pela hora do servidor (gatilho da 015).
    const { error } = await supabase
      .from('profiles')
      .update({ age_verified_adult_at: new Date().toISOString() })
      .eq('id', user.id)
    if (error) {
      // Banco sem a 015 ainda: a confirmação local continua valendo neste
      // aparelho, só não sincroniza com a conta.
      console.warn('[useAdultContent] Não foi possível salvar a confirmação no perfil:', error.message)
      return { error: null }
    }
    await refreshProfile()
    return { error: null }
  }, [user, refreshProfile])

  const revokeAdult = useCallback(async (): Promise<{ error: string | null }> => {
    if (!user) return { error: 'Não autenticado' }
    setLocallyConfirmedAdult(null)
    const { error } = await supabase.from('profiles').update({ age_verified_adult_at: null }).eq('id', user.id)
    if (error) return { error: 'Não foi possível revogar a confirmação no perfil. Tente de novo.' }
    await refreshProfile()
    return { error: null }
  }, [user, refreshProfile])

  return { verified, verifiedAt, showAdult, setShowAdult: setShowAdultContent, confirmAdult, revokeAdult }
}
