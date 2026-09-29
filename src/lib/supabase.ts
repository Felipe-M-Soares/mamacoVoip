import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

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
// detectSessionInUrl processa e apaga o "#access_token=...&type=..." da
// URL logo em seguida, e aí não dá mais pra saber de onde a sessão veio.
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

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
