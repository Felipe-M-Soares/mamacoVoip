import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { createAuthStorage } from './authStorage'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Variáveis de ambiente do Supabase ausentes. Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env'
  )
}

// Tipo do link de autenticação que abriu a página (ex.: "recovery" no
// link de redefinir senha, "signup" na confirmação de e-mail). Precisa
// ser lido AQUI, de forma síncrona e ANTES de criar o cliente — o
// detectSessionInUrl processa e apaga os parâmetros da URL logo em
// seguida, e aí não dá mais pra saber de onde a sessão veio.
//
// Com PKCE (ver flowType abaixo) o link do e-mail volta com "?code=..."
// e SEM "type": a recuperação de senha é reconhecida pelo evento
// PASSWORD_RECOVERY (ResetPassword.tsx) e a confirmação de cadastro
// pelo "?type=signup" que o próprio app coloca no emailRedirectTo
// (AuthContext.signUp). "type" no hash continua sendo lido pros links
// no formato antigo (#access_token=...&type=recovery) e pro
// "?token_hash=...&type=recovery" (template de e-mail recomendado —
// ver supabase/README.md).
function readAuthRedirectType(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const query = new URLSearchParams(window.location.search)
    return hash.get('type') ?? query.get('type')
  } catch {
    return null
  }
}
export const AUTH_REDIRECT_TYPE = readAuthRedirectType()

// B7 — no app desktop a sessão vai pro armazenamento cifrado do sistema
// (safeStorage, via IPC); na web continua no localStorage. Ver
// src/lib/authStorage.ts.
const authStorage = createAuthStorage(
  typeof window !== 'undefined' ? (window.electronAPI?.secureStorage ?? null) : null
)

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // B3 — PKCE em vez do fluxo implícito: o retorno do OAuth (e dos
    // links de e-mail) traz só um "code" de uso único, que só vira
    // sessão junto com o code_verifier guardado NESTE aparelho. Antes o
    // access/refresh token vinham direto na URL (#access_token=...) —
    // no app desktop, passando por linha de comando do sistema
    // (mamacovoip://...), onde qualquer programa podia ler/forjar.
    // Na web, detectSessionInUrl + pkce troca o ?code= sozinho.
    flowType: 'pkce',
    storage: authStorage,
  },
})

// PASSWORD_RECOVERY pode ser disparado DURANTE a inicialização do
// cliente (troca do ?code= de um link de recuperação PKCE) — antes de a
// tela de redefinir senha montar e começar a escutar. Este ouvinte é
// registrado junto com o cliente e guarda que aconteceu.
let passwordRecoveryDetected = false
supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') passwordRecoveryDetected = true
  else if (event === 'SIGNED_OUT') passwordRecoveryDetected = false
})
export function wasPasswordRecoveryDetected() {
  return passwordRecoveryDetected
}

// Cliente de autenticação descartável: não guarda sessão, não renova
// token, não lê a URL. Usado pra (1) conferir a senha atual antes de
// trocar a senha, sem substituir a sessão (nem o nível de 2FA) da
// janela atual; (2) pedir o e-mail de recuperação no fluxo implícito —
// o link é aberto no navegador/aparelho que a pessoa quiser, onde não
// existe o code_verifier do PKCE (ver ForgotPassword.tsx).
export function createEphemeralAuthClient(flowType: 'pkce' | 'implicit' = 'pkce') {
  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType,
      storageKey: `mv-ephemeral-${Math.random().toString(36).slice(2)}`,
    },
  })
}
