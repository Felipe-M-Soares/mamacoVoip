import { createContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { isElectron } from '../hooks/useGamePresence'
import type { Profile, ProfileStatus } from '../types/database'
import { normalizeEmail, normalizeTotpCode } from '../lib/authValidation'
import { clearLinkPreviewCache } from '../hooks/useLinkPreview'

// Esquema de URL customizado que o app desktop registra no sistema
// operacional (ver "protocols" em package.json e o bloco grande no
// topo de electron/main.cjs) — é o "endereço de volta" que o Google
// usa pra devolver a pessoa pro app depois de aceitar o login, já que
// um navegador comum não tem como abrir uma janela do Electron
// diretamente. Só é usado dentro do app desktop; no navegador (site),
// o próprio window.location.origin já funciona como redirecionamento.
const GOOGLE_AUTH_REDIRECT_ELECTRON = 'mamacovoip://auth-callback'

// mamacovoip:// é um esquema de URL REGISTRADO NO SISTEMA OPERACIONAL —
// isso significa que, tecnicamente, QUALQUER site ou programa no
// computador da pessoa pode "abrir" um link desses, não só o navegador
// que a gente mesmo abriu no signInWithGoogle() abaixo. Sem alguma
// forma de conferir "esse link realmente é resposta de um login que EU
// pedi", alguém malicioso poderia forjar um link com token de UMA OUTRA
// conta (a dele mesmo) e, se convencesse a vítima a clicar nele (num
// site, e-mail, etc.), o app da vítima aceitaria e logaria ela sem
// perceber na conta do golpista — um tipo de ataque conhecido (login
// CSRF / session fixation via deep link customizado).
//
// A defesa: gera um código aleatório ANTES de abrir o navegador,
// manda ele junto na URL de volta (?state=...), e só aceita o link que
// chegar de volta se o código bater com o que a gente mesmo gerou —
// um link forjado por fora nunca vai ter o código certo. Uso único
// (apaga assim que usado) e expira sozinho depois de alguns minutos,
// caso a pessoa desista no meio do caminho.
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
  // Sai só deste aparelho (outros aparelhos continuam logados).
  signOut: () => Promise<void>
  // Encerra a sessão em TODOS os aparelhos, inclusive este.
  signOutEverywhere: () => Promise<void>
  // Mantém este aparelho e derruba todas as outras sessões.
  signOutOtherSessions: () => Promise<{ error: string | null }>
  refreshProfile: () => Promise<void>
  updateProfile: (
    updates: {
      display_name?: string
      custom_status?: string | null
      playing?: string | null
      profile_visibility?: 'everyone' | 'friends_only'
      // Só aceitam `null` explícito aqui (não uma URL de verdade) — a URL
      // de verdade só é setada internamente, depois de um upload bem
      // sucedido logo abaixo. `null` é como a tela de edição pede pra
      // REMOVER um banner/decoração já enviado, sem trocar por outro.
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

  // Id do usuário da sessão atual — usado pra descartar respostas
  // atrasadas de fetchProfile/checkMfaLevel que chegam depois de um
  // logout ou troca de conta.
  const currentUserIdRef = useRef<string | null>(null)

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
      currentUserIdRef.current = session?.user?.id ?? null
      setSession(session)
      if (session?.user) {
        fetchProfile(session.user.id)
        // Espera saber se falta o 2º fator ANTES de liberar a tela —
        // antes o app chegava a renderizar (e disparar consultas) por um
        // instante com a sessão aal1, até o checkMfaLevel responder.
        await checkMfaLevel()
      }
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Ignora eventos disparados enquanto ainda estamos processando o
      // caso de confirmação de e-mail acima, pra não piscar "logado" na tela
      if (isEmailConfirmationRef.current) return

      const previousUserId = currentUserIdRef.current
      currentUserIdRef.current = session?.user?.id ?? null
      setSession(session)
      if (session?.user) {
        // Renovação de token não muda perfil nem nível de MFA — evita
        // uma consulta extra a cada ~1h.
        if (event === 'TOKEN_REFRESHED' && previousUserId === session.user.id) return
        const userId = session.user.id
        // A documentação do Supabase pede pra não chamar outras funções
        // do cliente de dentro deste callback (pode travar o lock de
        // auth) — adia pro próximo tick.
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

  // Checa se a sessão está travada esperando o código do autenticador
  // (aal1 = só senha, aal2 = senha + segundo fator já verificado).
  // Alguém com 2FA ativado fica preso em "mfaPending" até completar o
  // desafio — o app não deixa entrar antes disso.
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
    // Só fator JÁ VERIFICADO — um cadastro de 2FA abandonado no meio
    // deixa um fator "unverified" que nunca vai aceitar código nenhum.
    const factor = factors?.totp?.find((f) => f.status === 'verified')
    if (!factor) return { error: 'Nenhum autenticador ativo encontrado nesta conta.' }

    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: normalized })
    if (error) return { error: traduzErro(error.message) }

    await checkMfaLevel()
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
    const { error } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password })
    return { error: error ? traduzErro(error.message) : null }
  }

  async function signUp(email: string, password: string, username: string) {
    const { error } = await supabase.auth.signUp({
      email: normalizeEmail(email),
      password,
      options: {
        data: { username: username.trim() },
        // No site, o link de confirmação volta pro próprio domínio. No
        // app desktop (app://, file://) isso não é uma URL que o
        // navegador consiga abrir, então fica o "Site URL" do projeto.
        ...(!isElectron() && /^https?:$/.test(window.location.protocol)
          ? { emailRedirectTo: window.location.origin }
          : {}),
      },
    })
    if (error) return { error: traduzErro(error.message) }
    // Com confirmação de e-mail ligada, o Supabase NÃO devolve erro pra
    // e-mail já cadastrado (pra não revelar quem tem conta) — devolve um
    // usuário "falso" sem identidades. Mostramos a mesma tela de
    // "confirme seu e-mail" nos dois casos, de propósito.
    return { error: null }
  }

  // No app desktop, não dá pra deixar o Supabase redirecionar a própria
  // janela pro Google — a janela carrega arquivos locais (app://...),
  // não um site de verdade, então "voltar" pra ela depois do Google não
  // funcionaria. Em vez disso: pede a URL de autorização SEM navegar
  // pra ela (skipBrowserRedirect), abre essa URL no navegador padrão do
  // sistema (window.open aqui é interceptado no processo principal e
  // redirecionado pro navegador — ver setWindowOpenHandler em
  // electron/main.cjs), e espera o link de volta chegar pelo esquema
  // customizado mamacovoip:// (capturado no listener de
  // onGoogleAuthCallback logo abaixo).
  //
  // No navegador (site), o fluxo é o padrão do Supabase: a própria
  // página é redirecionada pro Google e volta sozinha pro mesmo
  // endereço, sem precisar de nada especial aqui.
  async function signInWithGoogle(): Promise<{ error: string | null }> {
    if (isElectron()) {
      const state = crypto.randomUUID()
      pendingGoogleAuthState = { value: state, expiresAt: Date.now() + GOOGLE_AUTH_STATE_TTL_MS }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${GOOGLE_AUTH_REDIRECT_ELECTRON}?state=${state}`, skipBrowserRedirect: true },
      })
      if (error) {
        pendingGoogleAuthState = null
        return { error: traduzErro(error.message) }
      }
      if (data?.url) window.open(data.url, '_blank')
      return { error: null }
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    return { error: error ? traduzErro(error.message) : null }
  }

  // Só existe dentro do app desktop (window.electronAPI) — é o outro
  // lado do signInWithGoogle() acima: quando o link mamacovoip://
  // chega de volta (ver electron/main.cjs), extrai o token da URL e
  // efetiva a sessão. onAuthStateChange (já escutado lá em cima) cuida
  // do resto (buscar perfil, etc.) automaticamente a partir daqui.
  useEffect(() => {
    if (!window.electronAPI?.onGoogleAuthCallback) return
    return window.electronAPI.onGoogleAuthCallback(async (url) => {
      try {
        const hashIndex = url.indexOf('#')
        const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url
        const queryIndex = beforeHash.indexOf('?')
        const stateFromLink =
          queryIndex >= 0 ? new URLSearchParams(beforeHash.slice(queryIndex + 1)).get('state') : null

        // Uso único — some com o código pendente já na primeira
        // tentativa, bateu ou não (evita reaproveitar o mesmo código
        // pra um segundo link forjado).
        const pending = pendingGoogleAuthState
        pendingGoogleAuthState = null

        const isExpectedLogin = Boolean(
          pending && pending.expiresAt >= Date.now() && stateFromLink && stateFromLink === pending.value
        )
        if (!isExpectedLogin) {
          // Link não corresponde a um login que ESTE app pediu (código
          // errado, ausente, ou expirado) — ignora silenciosamente em
          // vez de logar a pessoa numa conta que pode não ser a dela.
          // Ver o comentário grande acima sobre por que isso é
          // necessário com um esquema de URL customizado.
          return
        }

        const params = new URLSearchParams(hashIndex >= 0 ? url.slice(hashIndex + 1) : '')
        const access_token = params.get('access_token')
        const refresh_token = params.get('refresh_token')
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token })
        }
      } catch {
        // best-effort — um link malformado não deve derrubar o app
      }
    })
  }, [])

  // Limpa tudo que é da conta e fica guardado no aparelho — num
  // computador compartilhado, a próxima pessoa não pode ver notas,
  // itens fixados ou o destino pós-login de quem saiu.
  function clearLocalUserData() {
    clearLinkPreviewCache()
    for (const key of ['mamacos-pinned-items', 'mamacos-user-notes', 'mamacos-server-order', 'mamacos-participant-volumes']) {
      try {
        localStorage.removeItem(key)
      } catch {
        // best-effort
      }
    }
    try {
      sessionStorage.removeItem('mamacos-post-login-redirect')
    } catch {
      // best-effort
    }
    // Outros módulos (rascunhos, caches de contexto) podem escutar isso
    // pra se limparem também.
    try {
      window.dispatchEvent(new Event('mamacos:signed-out'))
    } catch {
      // best-effort
    }
  }

  // Obs.: signOut/signOutEverywhere não recebem parâmetro de propósito —
  // são usados direto como onClick={signOut}, e o evento do clique não
  // pode ser confundido com uma opção.
  function signOut() {
    return performSignOut('local')
  }

  function signOutEverywhere() {
    return performSignOut('global')
  }

  async function performSignOut(scope: 'local' | 'global') {
    const userId = session?.user?.id
    if (userId) {
      // Não deixa uma falha de rede aqui impedir o logout.
      try {
        await supabase.from('profiles').update({ status: 'offline' }).eq('id', userId)
      } catch {
        // ignora
      }
    }
    // Fecha todas as assinaturas de Realtime ANTES de derrubar a sessão —
    // senão os canais continuam abertos com o token antigo até expirar.
    try {
      await supabase.removeAllChannels()
    } catch {
      // ignora
    }
    const { error } = await supabase.auth.signOut({ scope })
    if (error) {
      // Mesmo se o servidor não responder, a sessão local tem que sumir.
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

    // Limites de tamanho (o banco também confere — migration 013).
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

    // Banner e decoração seguem o MESMO esquema do avatar (upload pro
    // bucket próprio, path {user_id}/{tipo}-{timestamp}.ext — ver
    // 007_profile_customization.sql) — só a URL enviada por último é que
    // fica valendo, arquivos antigos não são apagados do Storage (mesmo
    // comportamento que o avatar já tinha, por simplicidade).
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
    return { error: null }
  }

  async function updateStatus(status: ProfileStatus) {
    if (!session?.user) return
    await supabase.from('profiles').update({ status }).eq('id', session.user.id)
    await refreshProfile()
  }

  // Funções com identidade estável (sempre chamam a versão mais recente)
  // + value memoizado: sem isso, TODO render do AuthProvider (e cada
  // renovação de token) re-renderizava o app inteiro.
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

// Extensão do arquivo derivada do TIPO (mime) real, não do nome — o
// nome vem do sistema da pessoa e pode ter qualquer coisa ("foto.php",
// "a.b.c", sem extensão...). null = tipo não aceito.
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

// Mensagens de erro do Supabase Auth vêm em inglês — traduzimos as mais comuns
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

  // Esses dois vêm com texto variável (número de segundos, etc.), então
  // não dá pra bater exato no mapa acima — o Supabase limita quantos
  // e-mails o PROJETO TODO pode enviar por hora quando não tem um
  // provedor de e-mail próprio configurado (SMTP customizado), não é
  // algo que dependa de código do app. Só quem administra o projeto no
  // Supabase consegue aumentar isso de verdade (Authentication → Emails
  // → SMTP Settings, configurando Resend/SendGrid/etc.) — aqui só dá
  // pra deixar a mensagem clara em vez do texto em inglês.
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
