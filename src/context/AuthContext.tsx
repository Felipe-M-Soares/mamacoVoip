import { createContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { isElectron } from '../hooks/useGamePresence'
import type { Profile, ProfileStatus } from '../types/database'
import { normalizeEmail, normalizeTotpCode } from '../lib/authValidation'
import { clearLinkPreviewCache } from '../hooks/useLinkPreview'
import { clearSignedUrlCache } from '../lib/storageUrls'
import { PUBLIC_WEB_URL } from '../lib/config'
import { isNativeMobileApp } from '../lib/platform'
import { unregisterPushToken } from '../lib/pushNotifications'

const GOOGLE_AUTH_BRIDGE_ELECTRON = `${PUBLIC_WEB_URL}/auth/desktop.html`
const GOOGLE_AUTH_REDIRECT_MOBILE = 'com.mamacosvoip.app://auth-callback'

let pendingGoogleAuthState: { value: string; expiresAt: number } | null = null
const GOOGLE_AUTH_STATE_TTL_MS = 5 * 60 * 1000

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  mfaPending: boolean
  verifyMfaChallenge: (code: string) => Promise<{ error: string | null }>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, username: string) => Promise<{ error: string | null }>
  signInWithGoogle: () => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  signOutEverywhere: () => Promise<void>
  signOutOtherSessions: () => Promise<{ error: string | null }>
  refreshProfile: () => Promise<void>
  updateProfile: (
    updates: {
      display_name?: string
      custom_status?: string | null
      playing?: string | null
      profile_visibility?: 'everyone' | 'friends_only'
      banner_url?: null
      avatar_decoration_url?: null
    },
    avatarFile?: File | null,
    bannerFile?: File | null,
    decorationFile?: File | null
  ) => Promise<{ error: string | null }>
  updateStatus: (status: ProfileStatus) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const GOOGLE_AUTH_STATE_KEY = 'mamacos-google-auth-state'
function storeGoogleAuthState(v: { value: string; expiresAt: number }) {
  try {
    localStorage.setItem(GOOGLE_AUTH_STATE_KEY, JSON.stringify(v))
  } catch {
  }
}
function takeStoredGoogleAuthState(): { value: string; expiresAt: number } | null {
  try {
    const raw = localStorage.getItem(GOOGLE_AUTH_STATE_KEY)
    localStorage.removeItem(GOOGLE_AUTH_STATE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as { value?: unknown; expiresAt?: unknown }
    return typeof v.value === 'string' && typeof v.expiresAt === 'number' ? { value: v.value, expiresAt: v.expiresAt } : null
  } catch {
    return null
  }
}

export const GOOGLE_AUTH_RESULT_EVENT = 'mv:google-auth-result'
function reportGoogleAuth(error: string | null, detail?: string) {
  if (detail) {
    try {
      window.electronAPI?.logDebug?.(`[google-auth] ${detail}`)
    } catch {
    }
  }
  try {
    window.dispatchEvent(new CustomEvent(GOOGLE_AUTH_RESULT_EVENT, { detail: { error } }))
  } catch {
  }
}

let pendingGoogleFlowId: string | null = null
const GOOGLE_AUTH_FLOW_KEY = 'mamacos-google-auth-flow'
function storeGoogleFlowId(id: string | null) {
  pendingGoogleFlowId = id
  try {
    if (id) localStorage.setItem(GOOGLE_AUTH_FLOW_KEY, id)
    else localStorage.removeItem(GOOGLE_AUTH_FLOW_KEY)
  } catch {
  }
}
function takeGoogleFlowId(): string | null {
  let id = pendingGoogleFlowId
  try {
    id = id ?? localStorage.getItem(GOOGLE_AUTH_FLOW_KEY)
    localStorage.removeItem(GOOGLE_AUTH_FLOW_KEY)
  } catch {
  }
  pendingGoogleFlowId = null
  return id && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null
}

const handledGoogleCodes = new Set<string>()

async function handleGoogleAuthCallback(url: string) {
  try {
    const hashIndex = url.indexOf('#')
    const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url
    const queryIndex = beforeHash.indexOf('?')
    const query = new URLSearchParams(queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '')
    const stateFromLink = query.get('state')
    const code = query.get('code')

    const providerError = query.get('error_description') || query.get('error')
    if (providerError) {
      reportGoogleAuth(`O Google não concluiu o login: ${providerError.slice(0, 160)}`, `erro do provedor: ${providerError}`)
      return
    }

    if (!code || !/^[A-Za-z0-9._~-]{1,512}$/.test(code)) {
      reportGoogleAuth('O retorno do Google veio sem o código de login. Tente de novo.', `sem code no link: ${url.slice(0, 80)}`)
      return
    }
    if (handledGoogleCodes.has(code)) return
    handledGoogleCodes.add(code)

    const { data: current } = await supabase.auth.getSession()
    if (current.session) {
      reportGoogleAuth(null, 'retorno ignorado: já logado')
      return
    }

    const pending = pendingGoogleAuthState ?? takeStoredGoogleAuthState()
    pendingGoogleAuthState = null
    takeStoredGoogleAuthState()
    const flowId = takeGoogleFlowId()

    if (pending && stateFromLink && stateFromLink !== pending.value) {
      reportGoogleAuth('Esse link de login não é deste app. Clique em "Entrar com Google" de novo.', 'state não confere')
      return
    }

    const linkFlowId = query.get('sb_flow_id')
    const useFlowId = linkFlowId && /^[A-Za-z0-9_-]{1,128}$/.test(linkFlowId) ? linkFlowId : flowId
    let { error } = await supabase.auth.exchangeCodeForSession(code, useFlowId ? { flowId: useFlowId } : undefined)
    if (error && useFlowId && /verifier/i.test(error.message)) {
      ;({ error } = await supabase.auth.exchangeCodeForSession(code))
    }
    if (error) {
      const verifierMissing = /verifier/i.test(error.message)
      reportGoogleAuth(
        verifierMissing
          ? 'Esse login foi iniciado em outra janela ou versão do app. Clique em "Entrar com Google" de novo por aqui.'
          : `Não foi possível concluir o login com o Google (${traduzErro(error.message)}). Tente de novo.`,
        `exchangeCodeForSession falhou: ${error.name ?? ''} ${error.message}`
      )
      return
    }
    reportGoogleAuth(null, 'login concluído')
  } catch (err) {
    reportGoogleAuth('Não foi possível concluir o login com o Google. Tente de novo.', `exceção: ${(err as Error)?.message ?? err}`)
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [mfaPending, setMfaPending] = useState(false)

  const isEmailConfirmationRef = useRef(
    typeof window !== 'undefined' &&
      (() => {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
        const query = new URLSearchParams(window.location.search)
        const type = hash.get('type') ?? query.get('type')
        return type === 'signup' || type === 'email_change'
      })()
  )

  async function fetchProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data ?? null)
  }

  const currentUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const confirmationWithoutSession =
        isEmailConfirmationRef.current && !session && new URLSearchParams(window.location.search).has('code')
      if (isEmailConfirmationRef.current && (session || confirmationWithoutSession)) {
        if (session) await supabase.auth.signOut()
        try {
          sessionStorage.setItem('mamacos-email-confirmed', '1')
        } catch {
        }
        window.history.replaceState(null, '', '/login')
        isEmailConfirmationRef.current = false
        setSession(null)
        setProfile(null)
        setLoading(false)
        return
      }

      isEmailConfirmationRef.current = false
      currentUserIdRef.current = session?.user?.id ?? null
      setSession(session)
      if (session?.user) {
        fetchProfile(session.user.id)
        await checkMfaLevel()
      }
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (isEmailConfirmationRef.current) return

      const previousUserId = currentUserIdRef.current
      currentUserIdRef.current = session?.user?.id ?? null
      setSession(session)
      if (session?.user) {
        if (event === 'TOKEN_REFRESHED' && previousUserId === session.user.id) return
        const userId = session.user.id
        setTimeout(() => {
          if (currentUserIdRef.current !== userId) return
          fetchProfile(userId)
          checkMfaLevel()
        }, 0)
      } else {
        setProfile(null)
        setMfaPending(false)
        if (previousUserId) clearLocalUserData()
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function checkMfaLevel() {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error) return
    setMfaPending(Boolean(data && data.currentLevel === 'aal1' && data.nextLevel === 'aal2'))
  }

  async function verifyMfaChallenge(code: string): Promise<{ error: string | null }> {
    const normalized = normalizeTotpCode(code)
    if (normalized.length !== 6) return { error: 'Digite os 6 dígitos do código.' }

    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
    if (listError) return { error: traduzErro(listError.message) }
    const factor = factors?.totp?.find((f) => f.status === 'verified')
    if (!factor) return { error: 'Nenhum autenticador ativo encontrado nesta conta.' }

    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: normalized })
    if (error) return { error: traduzErro(error.message) }

    await checkMfaLevel()
    return { error: null }
  }

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        supabase.auth.getSession()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

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
    const { error } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password })
    return { error: error ? traduzErro(error.message) : null }
  }

  async function signUp(email: string, password: string, username: string) {
    const { error } = await supabase.auth.signUp({
      email: normalizeEmail(email),
      password,
      options: {
        data: { username: username.trim() },
        emailRedirectTo: `${
          !isElectron() && /^https?:$/.test(window.location.protocol) ? window.location.origin : PUBLIC_WEB_URL
        }/?type=signup`,
      },
    })
    if (error) return { error: traduzErro(error.message) }
    return { error: null }
  }

  async function signInWithGoogle(): Promise<{ error: string | null }> {
    if (isNativeMobileApp()) {
      const state = crypto.randomUUID()
      pendingGoogleAuthState = { value: state, expiresAt: Date.now() + GOOGLE_AUTH_STATE_TTL_MS }
      storeGoogleAuthState(pendingGoogleAuthState)
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${GOOGLE_AUTH_REDIRECT_MOBILE}?state=${state}`, skipBrowserRedirect: true },
      })
      if (error || !data?.url) {
        pendingGoogleAuthState = null
        return { error: error ? traduzErro(error.message) : 'Não foi possível abrir o login do Google.' }
      }
      storeGoogleFlowId((data as { flowId?: string | null }).flowId ?? null)
      try {
        const { Browser } = await import('@capacitor/browser')
        await Browser.open({ url: data.url })
      } catch {
        pendingGoogleAuthState = null
        return { error: 'Não foi possível abrir o navegador para o login do Google.' }
      }
      return { error: null }
    }
    if (isElectron()) {
      const state = crypto.randomUUID()
      pendingGoogleAuthState = { value: state, expiresAt: Date.now() + GOOGLE_AUTH_STATE_TTL_MS }
      storeGoogleAuthState(pendingGoogleAuthState)

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${GOOGLE_AUTH_BRIDGE_ELECTRON}?state=${state}`, skipBrowserRedirect: true },
      })
      if (error) {
        pendingGoogleAuthState = null
        return { error: traduzErro(error.message) }
      }
      storeGoogleFlowId((data as { flowId?: string | null } | null)?.flowId ?? null)
      if (data?.url) window.open(data.url, '_blank')
      return { error: null }
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    return { error: error ? traduzErro(error.message) : null }
  }

  useEffect(() => {
    if (!window.electronAPI?.onGoogleAuthCallback) return
    return window.electronAPI.onGoogleAuthCallback(handleGoogleAuthCallback)
  }, [])

  useEffect(() => {
    if (!isNativeMobileApp()) return
    let remove: (() => void) | null = null
    let cancelled = false
    void import('@capacitor/app').then(({ App }) => {
      void App.getLaunchUrl()
        .then((launch) => {
          if (launch?.url?.startsWith(GOOGLE_AUTH_REDIRECT_MOBILE)) void handleGoogleAuthCallback(launch.url)
        })
        .catch(() => {})
      return App.addListener('appUrlOpen', ({ url }) => {
        if (!url.startsWith(GOOGLE_AUTH_REDIRECT_MOBILE)) return
        void import('@capacitor/browser').then(({ Browser }) => Browser.close()).catch(() => {})
        void handleGoogleAuthCallback(url)
      }).then((h) => {
        if (cancelled) void h.remove()
        else remove = () => void h.remove()
      })
    })
    return () => {
      cancelled = true
      remove?.()
    }
  }, [])

  function clearLocalUserData() {
    clearLinkPreviewCache()
    clearSignedUrlCache()
    for (const key of ['mamacos-pinned-items', 'mamacos-user-notes', 'mamacos-server-order', 'mamacos-participant-volumes']) {
      try {
        localStorage.removeItem(key)
      } catch {
      }
    }
    try {
      sessionStorage.removeItem('mamacos-post-login-redirect')
    } catch {
    }
    try {
      window.dispatchEvent(new Event('mamacos:signed-out'))
    } catch {
    }
  }

  function signOut() {
    return performSignOut('local')
  }

  function signOutEverywhere() {
    return performSignOut('global')
  }

  async function performSignOut(scope: 'local' | 'global') {
    const userId = session?.user?.id
    await unregisterPushToken()
    if (userId) {
      try {
        await supabase.from('profiles').update({ status: 'offline' }).eq('id', userId)
      } catch {
      }
    }
    try {
      await supabase.removeAllChannels()
    } catch {
    }
    const { error } = await supabase.auth.signOut({ scope })
    if (error) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    }
    currentUserIdRef.current = null
    setSession(null)
    setProfile(null)
    setMfaPending(false)
    clearLocalUserData()
  }

  async function signOutOtherSessions(): Promise<{ error: string | null }> {
    const { error } = await supabase.auth.signOut({ scope: 'others' })
    return { error: error ? traduzErro(error.message) : null }
  }

  async function refreshProfile() {
    if (session?.user) await fetchProfile(session.user.id)
  }

  async function updateProfile(
    updates: {
      display_name?: string
      custom_status?: string | null
      playing?: string | null
      profile_visibility?: 'everyone' | 'friends_only'
      banner_url?: null
      avatar_decoration_url?: null
    },
    avatarFile?: File | null,
    bannerFile?: File | null,
    decorationFile?: File | null
  ) {
    if (!session?.user) return { error: 'Não autenticado' }

    if (updates.display_name !== undefined) {
      const name = updates.display_name.trim()
      if (name.length > 32) return { error: 'O nome de exibição pode ter no máximo 32 caracteres.' }
      updates = { ...updates, display_name: name }
    }
    if (typeof updates.custom_status === 'string' && updates.custom_status.length > 128) {
      return { error: 'O status personalizado pode ter no máximo 128 caracteres.' }
    }
    if (typeof updates.playing === 'string' && updates.playing.length > 128) {
      return { error: 'O texto de "jogando" pode ter no máximo 128 caracteres.' }
    }

    const patch: {
      display_name?: string
      custom_status?: string | null
      playing?: string | null
      profile_visibility?: 'everyone' | 'friends_only'
      avatar_url?: string
      banner_url?: string | null
      avatar_decoration_url?: string | null
    } = { ...updates }

    if (avatarFile) {
      const ext = imageExtension(avatarFile)
      if (!ext) return { error: 'Formato de imagem não aceito.' }
      const path = `${session.user.id}/avatar-${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, avatarFile, {
        upsert: false,
        contentType: avatarFile.type,
      })
      if (uploadError) return { error: traduzErroUpload(uploadError.message) }
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      patch.avatar_url = data.publicUrl
    }

    if (bannerFile) {
      const ext = imageExtension(bannerFile)
      if (!ext) return { error: 'Formato de imagem não aceito.' }
      const path = `${session.user.id}/banner-${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('profile-banners').upload(path, bannerFile, {
        upsert: false,
        contentType: bannerFile.type,
      })
      if (uploadError) return { error: traduzErroUpload(uploadError.message) }
      const { data } = supabase.storage.from('profile-banners').getPublicUrl(path)
      patch.banner_url = data.publicUrl
    }

    if (decorationFile) {
      const ext = imageExtension(decorationFile)
      if (!ext || ext === 'jpg') return { error: 'Formato de imagem não aceito.' }
      const path = `${session.user.id}/decoration-${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('avatar-decorations')
        .upload(path, decorationFile, { upsert: false, contentType: decorationFile.type })
      if (uploadError) return { error: traduzErroUpload(uploadError.message) }
      const { data } = supabase.storage.from('avatar-decorations').getPublicUrl(path)
      patch.avatar_decoration_url = data.publicUrl
    }

    const { error } = await supabase.from('profiles').update(patch).eq('id', session.user.id)
    if (error) return { error: traduzErro(error.message) }
    await refreshProfile()
    window.dispatchEvent(new Event('mv:profile-updated'))
    return { error: null }
  }

  async function updateStatus(status: ProfileStatus) {
    if (!session?.user) return
    await supabase.from('profiles').update({ status }).eq('id', session.user.id)
    await refreshProfile()
  }

  const actions = useStableActions({
    verifyMfaChallenge,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    signOutEverywhere,
    signOutOtherSessions,
    refreshProfile,
    updateProfile,
    updateStatus,
  })
  const value = useMemo(
    () => ({ session, user: session?.user ?? null, profile, loading, mfaPending, ...actions }),
    [session, profile, loading, mfaPending, actions],
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

function imageExtension(file: File): string | null {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  }
  return map[file.type] ?? null
}

function traduzErroUpload(message: string): string {
  if (/exceeded the maximum allowed size|payload too large|too large/i.test(message)) {
    return 'Arquivo muito grande.'
  }
  if (/mime type|invalid.*type/i.test(message)) return 'Formato de arquivo não aceito.'
  if (/row-level security|unauthorized|not authorized/i.test(message)) {
    return 'Sem permissão pra enviar esse arquivo. Entre de novo e tente outra vez.'
  }
  return 'Não foi possível enviar a imagem. Tente de novo.'
}

export function traduzErro(message: string): string {
  const mapa: Record<string, string> = {
    'Invalid login credentials': 'E-mail ou senha incorretos.',
    'User already registered': 'Já existe uma conta com este e-mail.',
    'Password should be at least 6 characters': 'A senha precisa ter no mínimo 6 caracteres.',
    'Email not confirmed': 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.',
    'Unable to validate email address: invalid format': 'Formato de e-mail inválido.',
    'New password should be different from the old password.': 'A senha nova precisa ser diferente da atual.',
    'Signups not allowed for this instance': 'Novos cadastros estão desativados no momento.',
    'Invalid TOTP code entered': 'Código inválido. Confira o app autenticador e tente de novo.',
    'Token has expired or is invalid': 'Esse link ou código expirou. Peça um novo.',
    'Email link is invalid or has expired': 'Esse link expirou ou já foi usado. Peça um novo.',
    'Auth session missing!': 'Sua sessão expirou. Entre de novo.',
    'User not found': 'E-mail ou senha incorretos.',
  }
  if (mapa[message]) return mapa[message]

  if (/password is known to be weak|pwned|leaked/i.test(message)) {
    return 'Essa senha apareceu em vazamentos de dados conhecidos. Escolha outra.'
  }
  if (/password should (be at least|contain)/i.test(message)) {
    return 'A senha não atende aos requisitos mínimos (pelo menos 8 caracteres, com letras e números).'
  }
  if (/AAL2 (session )?is required|aal2/i.test(message)) {
    return 'Confirme o código do seu autenticador (2FA) antes de fazer isso.'
  }
  if (/invalid.*(totp|mfa)|mfa.*(invalid|verification failed)|challenge.*expired/i.test(message)) {
    return 'Código inválido ou expirado. Tente de novo.'
  }
  if (/request rate limit|too many requests|rate limit/i.test(message) && !/email rate limit/i.test(message)) {
    return 'Muitas tentativas em pouco tempo. Aguarde um pouco e tente de novo.'
  }
  if (/profiles_username|duplicate key.*username/i.test(message)) {
    return 'Esse nome de usuário já está em uso.'
  }
  if (/failed to fetch|network ?error|load failed/i.test(message)) {
    return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.'
  }

  if (/email rate limit exceeded/i.test(message)) {
    return 'Muitas contas foram criadas em pouco tempo e o envio de e-mails atingiu o limite temporário do servidor. Aguarde um pouco e tente de novo — se continuar acontecendo, o administrador precisa configurar um provedor de e-mail próprio no Supabase.'
  }
  if (/for security purposes.*after \d+ seconds/i.test(message)) {
    const segundos = message.match(/after (\d+) seconds/i)?.[1]
    return segundos
      ? `Por segurança, espere ${segundos} segundos antes de tentar de novo.`
      : 'Por segurança, espere um pouco antes de tentar de novo.'
  }

  return message
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function useStableActions<T extends Record<string, (...args: any[]) => any>>(fns: T): T {
  const ref = useRef(fns)
  useLayoutEffect(() => {
    ref.current = fns
  })
  return useMemo(() => {
    const out = {} as Record<string, unknown>
    for (const key of Object.keys(ref.current)) {
      out[key] = (...args: unknown[]) => ref.current[key](...args)
    }
    return out as T
  }, [])
}
