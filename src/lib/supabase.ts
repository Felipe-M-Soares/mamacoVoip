import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { Capacitor } from '@capacitor/core'
import { createAuthStorage, createNativeAuthStorage } from './authStorage'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Variáveis de ambiente do Supabase ausentes. Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env'
  )
}

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

const authStorage = Capacitor.isNativePlatform()
  ? createNativeAuthStorage(() => import('@capacitor/preferences').then((m) => m.Preferences))
  : createAuthStorage(typeof window !== 'undefined' ? (window.electronAPI?.secureStorage ?? null) : null)

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storage: authStorage,
  },
})

let passwordRecoveryDetected = false
supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') passwordRecoveryDetected = true
  else if (event === 'SIGNED_OUT') passwordRecoveryDetected = false
})
export function wasPasswordRecoveryDetected() {
  return passwordRecoveryDetected
}

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
