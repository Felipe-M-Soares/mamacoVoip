import { createContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile, ProfileStatus } from '../types/database'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, username: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  updateProfile: (
    updates: { display_name?: string; custom_status?: string | null },
    avatarFile?: File | null
  ) => Promise<{ error: string | null }>
  updateStatus: (status: ProfileStatus) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function fetchProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data ?? null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) fetchProfile(session.user.id)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  // Marca online ao logar / abrir o app. Só muda se o usuário estava
  // "offline" — não sobrescreve um status manual (ausente/não perturbe).
  //
  // Limitação conhecida: não há um sistema de presence (heartbeat) real
  // aqui, então fechar a aba abruptamente não marca o usuário como
  // offline automaticamente — ele continua "online" até abrir o app de
  // novo ou fazer logout explicitamente. Um heartbeat via Supabase
  // Realtime Presence resolveria isso, mas fica fora do escopo desta fase.
  useEffect(() => {
    if (!session?.user) return

    supabase
      .from('profiles')
      .select('status')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        if (data && data.status === 'offline') {
          supabase.from('profiles').update({ status: 'online' }).eq('id', session.user.id).then()
        }
      })
  }, [session?.user])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? traduzErro(error.message) : null }
  }

  async function signUp(email: string, password: string, username: string) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    })
    return { error: error ? traduzErro(error.message) : null }
  }

  async function signOut() {
    if (session?.user) {
      await supabase.from('profiles').update({ status: 'offline' }).eq('id', session.user.id)
    }
    await supabase.auth.signOut()
  }

  async function refreshProfile() {
    if (session?.user) await fetchProfile(session.user.id)
  }

  async function updateProfile(
    updates: { display_name?: string; custom_status?: string | null },
    avatarFile?: File | null
  ) {
    if (!session?.user) return { error: 'Não autenticado' }

    const patch: { display_name?: string; custom_status?: string | null; avatar_url?: string } = { ...updates }

    if (avatarFile) {
      const ext = avatarFile.name.split('.').pop()
      const path = `${session.user.id}/avatar-${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, avatarFile, {
        upsert: true,
      })
      if (uploadError) return { error: uploadError.message }
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      patch.avatar_url = data.publicUrl
    }

    const { error } = await supabase.from('profiles').update(patch).eq('id', session.user.id)
    if (error) return { error: error.message }
    await refreshProfile()
    return { error: null }
  }

  async function updateStatus(status: ProfileStatus) {
    if (!session?.user) return
    await supabase.from('profiles').update({ status }).eq('id', session.user.id)
    await refreshProfile()
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        signIn,
        signUp,
        signOut,
        refreshProfile,
        updateProfile,
        updateStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// Mensagens de erro do Supabase Auth vêm em inglês — traduzimos as mais comuns
function traduzErro(message: string): string {
  const mapa: Record<string, string> = {
    'Invalid login credentials': 'E-mail ou senha incorretos.',
    'User already registered': 'Já existe uma conta com este e-mail.',
    'Password should be at least 6 characters': 'A senha precisa ter no mínimo 6 caracteres.',
    'Email not confirmed': 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.',
    'Unable to validate email address: invalid format': 'Formato de e-mail inválido.',
  }
  return mapa[message] ?? message
}
