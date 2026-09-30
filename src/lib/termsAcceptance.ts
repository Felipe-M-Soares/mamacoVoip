import { supabase } from './supabase'
import { TERMS_VERSION } from './config'
import { callRpc, isMissingDbObject } from './rpcCompat'

// Aceite dos Termos/Privacidade + declaração de maioridade (18+).
// Grava via RPC accept_terms(p_version, p_is_adult) — o banco carimba a
// hora do servidor em user_private_settings (terms_accepted_at,
// terms_version, age_declared_adult_at).
//
// O cadastro por e-mail normalmente NÃO devolve sessão (precisa
// confirmar o e-mail antes), então o aceite feito no formulário fica
// "pendente" neste aparelho e é enviado sozinho no primeiro login
// (TermsGate). Mesmo esquema pro "Cadastrar com Google".

const PENDING_KEY = 'mamacos-pending-terms'
// Cadastro pelo Google: o e-mail só é conhecido depois — vale por pouco tempo.
const PENDING_ANY_TTL_MS = 30 * 60 * 1000
// Cadastro por e-mail: até a pessoa confirmar o e-mail.
const PENDING_EMAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000

type Pending = { version: string; email: string | null; at: number }

export function rememberPendingTerms(email: string | null) {
  try {
    const value: Pending = { version: TERMS_VERSION, email: email ? email.trim().toLowerCase() : null, at: Date.now() }
    localStorage.setItem(PENDING_KEY, JSON.stringify(value))
  } catch {
    // sem armazenamento — a tela de aceite aparece no primeiro login
  }
}

/** Há aceite pendente feito neste aparelho que vale pra este e-mail? */
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

/** A pessoa logada já aceitou a versão atual? 'unsupported' = banco ainda sem o recurso. */
export async function fetchTermsStatus(userId: string): Promise<TermsStatus> {
  const { data, error } = await supabase
    .from('user_private_settings')
    .select('terms_accepted_at, terms_version, age_declared_adult_at' as never)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    // Coluna ainda não existe (migration não aplicada) → não trava o app.
    // Qualquer outro erro (rede) → também não trava; tenta no próximo login.
    return 'unsupported'
  }
  const row = data as { terms_accepted_at?: string | null; terms_version?: string | null; age_declared_adult_at?: string | null } | null
  if (row?.terms_accepted_at && row.terms_version === TERMS_VERSION && row.age_declared_adult_at) return 'accepted'
  return 'needed'
}

/** Grava o aceite da versão atual. `missing` = RPC ainda não existe no banco. */
export async function acceptCurrentTerms(): Promise<{ error: string | null; missing: boolean }> {
  const { error, missing } = await callRpc('accept_terms', { p_version: TERMS_VERSION, p_is_adult: true })
  if (error) {
    if (missing || isMissingDbObject(error)) return { error: null, missing: true }
    return { error: 'Não foi possível registrar o aceite. Tente de novo.', missing: false }
  }
  return { error: null, missing: false }
}
