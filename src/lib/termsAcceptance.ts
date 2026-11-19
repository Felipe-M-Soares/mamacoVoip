import { supabase } from './supabase'
import { TERMS_VERSION } from './config'
import { callRpc, isMissingDbObject } from './rpcCompat'

const PENDING_KEY = 'mamacos-pending-terms'
const PENDING_ANY_TTL_MS = 30 * 60 * 1000
const PENDING_EMAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000

type Pending = { version: string; email: string | null; at: number }

export function rememberPendingTerms(email: string | null) {
  try {
    const value: Pending = { version: TERMS_VERSION, email: email ? email.trim().toLowerCase() : null, at: Date.now() }
    localStorage.setItem(PENDING_KEY, JSON.stringify(value))
  } catch {
  }
}

export function takePendingTerms(email: string | null | undefined): boolean {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return false
    const p = JSON.parse(raw) as Pending
    const age = Date.now() - (p.at || 0)
    const mine = email ? email.trim().toLowerCase() : null
    const ok =
      p.version === TERMS_VERSION &&
      (p.email ? p.email === mine && age < PENDING_EMAIL_TTL_MS : age < PENDING_ANY_TTL_MS)
    if (ok || age >= PENDING_EMAIL_TTL_MS) localStorage.removeItem(PENDING_KEY)
    return ok
  } catch {
    return false
  }
}

export type TermsStatus = 'accepted' | 'needed' | 'unsupported'

export async function fetchTermsStatus(userId: string): Promise<TermsStatus> {
  const { data, error } = await supabase
    .from('user_private_settings')
    .select('terms_accepted_at, terms_version, age_declared_adult_at' as never)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    return 'unsupported'
  }
  const row = data as { terms_accepted_at?: string | null; terms_version?: string | null; age_declared_adult_at?: string | null } | null
  if (row?.terms_accepted_at && row.terms_version === TERMS_VERSION && row.age_declared_adult_at) return 'accepted'
  return 'needed'
}

export async function acceptCurrentTerms(): Promise<{ error: string | null; missing: boolean }> {
  const { error, missing } = await callRpc('accept_terms', { p_version: TERMS_VERSION, p_is_adult: true })
  if (error) {
    if (missing || isMissingDbObject(error)) return { error: null, missing: true }
    return { error: 'Não foi possível registrar o aceite. Tente de novo.', missing: false }
  }
  return { error: null, missing: false }
}
