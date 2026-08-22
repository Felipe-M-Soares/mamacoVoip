import { createContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile, ProfileStatus } from '../types/database'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  mfaPending: boolean
  verifyMfaChallenge: (code: string) => Promise<{ error: string | null }>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, username: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  updateProfile: (
    updates: { display_name?: string; custom_status?: string | null; playing?: string | null; profile_visibility?: 'everyone' | 'friends_only' },
    avatarFile?: File | null
  ) => Promise<{ error: string | null }>
  updateStatus: (status: ProfileStatus) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [mfaPending, setMfaPending] = useState(false)

  // Capturado de forma síncrona (fora de qualquer efeito) porque o próprio
  // cliente do Supabase pode "limpar" o hash da URL assim que processa a
  // sessão — se a gente checar isso só dentro de um useEffect, pode já ser
  // tarde demais.
  const isEmailConfirmationRef = useRef(
    typeof window !== 'undefined' &&
      (window.location.hash.includes('type=signup') || window.location.hash.includes('type=email_change'))
  )

  async function fetchProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data ?? null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      // O link de confirmação de e-mail já vem com uma sessão válida
      // embutida (pra funcionar o "detectSessionInUrl"). Só que não
      // queremos logar a pessoa automaticamente nesse caso — a gente
      // desloga na hora e manda pra tela de login com um aviso de sucesso.
      if (isEmailConfirmationRef.current && session) {
        await supabase.auth.signOut()
        try {
          sessionStorage.setItem('mamacos-email-confirmed', '1')
        } catch {
          // best-effort — se não der pra guardar a flag, só não mostra o aviso
        }
        window.history.replaceState(null, '', '/login')
        isEmailConfirmationRef.current = false
        setSession(null)
        setProfile(null)
        setLoading(false)
        return
      }

      isEmailConfirmationRef.current = false
      setSession(session)
      if (session?.user) {
        fetchProfile(session.user.id)
        checkMfaLevel()
      }
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      // Ignora eventos disparados enquanto ainda estamos processando o
      // caso de confirmação de e-mail acima, pra não piscar "logado" na tela
      if (isEmailConfirmationRef.current) return

      setSession(session)
      if (session?.user) {
        fetchProfile(session.user.id)
        checkMfaLevel()
      } else {
        setProfile(null)
        setMfaPending(false)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  // Checa se a sessão está travada esperando o código do autenticador
  // (aal1 = só senha, aal2 = senha + segundo fator já verificado).
  // Alguém com 2FA ativado fica preso em "mfaPending" até completar o
  // desafio — o app não deixa entrar antes disso.
  async function checkMfaLevel() {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    setMfaPending(Boolean(data && data.currentLevel === 'aal1' && data.nextLevel === 'aal2'))
  }

  async function verifyMfaChallenge(code: string): Promise<{ error: string | null }> {
    const { data: factors } = await supabase.auth.mfa.listFactors()
    const factor = factors?.totp?.[0]
    if (!factor) return { error: 'Nenhum fator de autenticação encontrado' }

    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() })
    if (error) return { error: traduzErro(error.message) }

    setMfaPending(false)
    return { error: null }
  }

  // Segunda camada de proteção pro problema de "token expira enquanto
  // a janela fica escondida" — mesmo com os timers não mais
  // desacelerados (veja backgroundThrottling no processo principal),
  // essa é uma garantia a mais: sempre que a janela volta a ficar
  // visível (reaberta da bandeja, ou só voltando o foco), confirma que
  // a sessão ainda é válida e renova se precisar, em vez de esperar o
  // próximo ciclo natural de renovação.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        supabase.auth.getSession()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Marca online ao logar / abrir o app. Só muda se o usuário estava
  // "offline" — não sobrescreve um status manual (ausente/não perturbe).
  //
  // Fechar o app abruptamente (crash, sem internet, sem logout) ainda
  // deixa essa coluna travada em "online" no banco — mas isso não é mais
  // um problema pra quem VÊ o status de outra pessoa: o PresenceContext
  // (src/context/PresenceContext.tsx) cruza esse valor com um canal de
  // Realtime Presence, que reflete se o socket da pessoa está mesmo
  // aberto agora, e o Avatar usa esse cruzamento pra decidir a bolinha —
  // então mesmo com o banco desatualizado, ninguém mais vê alguém
  // desconectado como "online".
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
    updates: { display_name?: string; custom_status?: string | null; playing?: string | null; profile_visibility?: 'everyone' | 'friends_only' },
    avatarFile?: File | null
  ) {
    if (!session?.user) return { error: 'Não autenticado' }

    const patch: {
      display_name?: string
      custom_status?: string | null
      playing?: string | null
      profile_visibility?: 'everyone' | 'friends_only'
      avatar_url?: string
    } = { ...updates }

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
        mfaPending,
        verifyMfaChallenge,
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
