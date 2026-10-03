import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { createEphemeralAuthClient, supabase } from '../../lib/supabase'
import { checkRateLimit } from '../../lib/rateLimit'
import { useAuth } from '../../hooks/useAuth'
import { useVoiceCore } from '../../hooks/useVoice'
import { useAppUpdater } from '../../hooks/useAppUpdater'
import { useTheme } from '../../hooks/useTheme'
import { THEMES, type ThemeId } from '../../context/ThemeContext'
import { getNotificationPermission, requestNotificationPermission } from '../../lib/notifications'
import {
  SOUND_CATALOG,
  getSoundVolume,
  isSoundEnabled,
  previewUiSound,
  setSoundEnabled,
  setSoundVolume,
  playConnectSound,
  type UiSoundId,
} from '../../lib/sounds'
import { SecurityTab } from './SecurityTab'
import { exportUserData } from '../../lib/exportUserData'
import { deleteOwnProfileFiles } from '../../lib/deleteOwnProfileFiles'
import { useAdultContent } from '../../hooks/useAdultContent'
import { useIsAppAdmin } from '../../hooks/useAppAdmin'
import { getShowPlaying, setShowPlaying, subscribeShowPlaying } from '../../lib/gamePrivacy'
import { validatePassword } from '../../lib/authValidation'
import { traduzErro } from '../../context/AuthContext'
import { NetworkDiagnosticsPanel } from './NetworkDiagnosticsPanel'
import { Avatar } from '../ui/Avatar'
import { Toggle } from '../ui/Toggle'
import {
  BellIcon,
  CheckIcon,
  CloseIcon,
  LockIcon,
  LogOutIcon,
  MicIcon,
  PaletteIcon,
  PlayIcon,
  ShieldCheckIcon,
  UserIcon,
  InfoIcon,
  AdminIcon,
  MembersIcon,
  type AppIcon,
  KeyboardIcon,
} from '../ui/icons'
import { TabHeader, SettingsCard, SettingRow, RowList, RangeSlider, Segmented, InlineMessage } from './settingsUI'
import { useAvatarTransparent } from '../../hooks/useAvatarTransparent'
import { KeybindsTab } from './KeybindsTab'
import {
  createNoiseSuppressor,
  type NoiseSuppressor,
  MIN_MIC_SENSITIVITY,
  MAX_MIC_SENSITIVITY,
  DEFAULT_MIC_SENSITIVITY,
  createAutoSensitivity,
  AUTO_SENSITIVITY_TICK_MS,
} from '../../lib/noiseSuppression'

type Tab =
  | 'account'
  | 'security'
  | 'appearance'
  | 'audio'
  | 'keybinds'
  | 'notifications'
  | 'privacy'
  | 'licenses'
  | 'admin'
  | 'admin-users'

// Abas pesadas/raras, carregadas só quando abertas (a de licenças traz o
// texto inteiro do THIRD_PARTY_NOTICES.md).
const LicensesTab = lazy(() => import('./LicensesTab').then((m) => ({ default: m.LicensesTab })))
const AdminReportsTab = lazy(() => import('./AdminReportsTab').then((m) => ({ default: m.AdminReportsTab })))
const AdminUsersTab = lazy(() => import('./AdminUsersTab').then((m) => ({ default: m.AdminUsersTab })))

// Ícones do menu lateral (Lucide, via ui/icons) — herdam a cor.
const TAB_ICONS: Record<Tab, AppIcon> = {
  account: UserIcon,
  security: ShieldCheckIcon,
  privacy: LockIcon,
  appearance: PaletteIcon,
  audio: MicIcon,
  keybinds: KeyboardIcon,
  notifications: BellIcon,
  licenses: InfoIcon,
  admin: AdminIcon,
  'admin-users': MembersIcon,
}

const TAB_GROUPS: { label: string; tabs: { id: Tab; label: string }[] }[] = [
  {
    label: 'Conta',
    tabs: [
      { id: 'account', label: 'Minha conta' },
      { id: 'security', label: 'Segurança' },
      { id: 'privacy', label: 'Privacidade' },
    ],
  },
  {
    label: 'Aplicativo',
    tabs: [
      { id: 'appearance', label: 'Aparência' },
      { id: 'audio', label: 'Voz e Vídeo' },
      { id: 'keybinds', label: 'Atalhos' },
      { id: 'notifications', label: 'Notificações' },
    ],
  },
  {
    label: 'Sobre',
    tabs: [{ id: 'licenses', label: 'Licenças' }],
  },
]

// Só pra equipe do Mamacos Voip (is_app_admin()).
const ADMIN_GROUP: (typeof TAB_GROUPS)[number] = {
  label: 'Administração',
  tabs: [
    { id: 'admin-users', label: 'Usuários' },
    { id: 'admin', label: 'Denúncias da plataforma' },
  ],
}

function NavIcon({ tab, className = 'w-[18px] h-[18px]' }: { tab: Tab; className?: string }) {
  const Icon = TAB_ICONS[tab]
  return <Icon className={className} strokeWidth={1.8} aria-hidden />
}

function CloseGlyph() {
  return <CloseIcon className="w-[18px] h-[18px]" aria-hidden />
}

export function SettingsModal({ onClose, initialTab }: { onClose: () => void; initialTab?: Tab }) {
  const { user, profile, signOut } = useAuth()
  const [tab, setTab] = useState<Tab>(initialTab ?? 'account')
  const contentRef = useRef<HTMLDivElement>(null)
  const isAppAdmin = useIsAppAdmin()
  const tabGroups = isAppAdmin ? [...TAB_GROUPS, ADMIN_GROUP] : TAB_GROUPS

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Trocar de aba volta a rolagem pro topo (senão abre no meio da aba nova).
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [tab])

  return createPortal(
    // Mesmo z-[500] do Modal.tsx — ver comentário lá. Configurações é uma
    // tela cheia que também deve ficar acima de qualquer painel lateral
    // (thread, mensagens fixadas) aberto antes dela.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Configurações"
      className="fixed inset-0 z-[500] bg-mv-main flex flex-col md:flex-row animate-fade-in"
    >
      {/* Navegação — coluna à esquerda no desktop; no celular vira uma
          faixa de abas roláveis no topo. */}
      <nav
        aria-label="Seções das configurações"
        className="shrink-0 bg-mv-side border-b md:border-b-0 md:border-r border-[var(--color-line)] md:flex-[1_0_250px] md:h-full md:overflow-y-auto flex flex-col"
      >
        <div className="md:ml-auto w-full md:max-w-[232px] px-3 md:px-3 pt-3 md:pt-14 md:pb-8">
          {/* Topo mobile: título + fechar */}
          <div className="flex md:hidden items-center justify-between px-1 pb-2">
            <p className="font-display text-[17px] font-semibold text-white">Configurações</p>
            <button onClick={onClose} className="icon-btn w-9 h-9" aria-label="Fechar" title="Fechar (Esc)">
              <CloseGlyph />
            </button>
          </div>

          {profile && (
            <div className="hidden md:flex items-center gap-2.5 px-2 pb-4 mb-3 border-b border-[var(--color-line)]">
              <Avatar name={profile.username} avatarUrl={profile.avatar_url} size={36} />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-white truncate">{profile.display_name || profile.username}</p>
                <p className="text-[12px] text-mv-muted truncate">@{profile.username}</p>
              </div>
            </div>
          )}

          <div className="flex md:flex-col gap-1 md:gap-5 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-1 px-1">
            {tabGroups.map((group) => (
              <div key={group.label} className="flex md:flex-col gap-1 md:gap-0.5 shrink-0">
                <p className="hidden md:block px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted">
                  {group.label}
                </p>
                {group.tabs.map((t) => {
                  const active = tab === t.id
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      aria-current={active ? 'page' : undefined}
                      className={`relative shrink-0 flex items-center gap-2.5 whitespace-nowrap text-left px-2.5 py-[7px] rounded-lg text-[14px] font-medium transition-colors ${
                        active
                          ? 'bg-white/[0.08] text-white'
                          : 'text-mv-muted hover:bg-white/[0.04] hover:text-mv-text'
                      }`}
                    >
                      {active && (
                        <span aria-hidden="true" className="hidden md:block absolute -left-3 top-1.5 bottom-1.5 w-1 rounded-r-full bg-brand-gradient" />
                      )}
                      <span className={active ? 'text-mv-accent' : ''}>
                        <NavIcon tab={t.id} />
                      </span>
                      {t.label}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          <div className="mt-5 pt-4 border-t border-[var(--color-line)] space-y-0.5">
            <button
              onClick={() => {
                onClose()
                setTimeout(() => window.dispatchEvent(new Event('mv:start-tour')), 150)
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[14px] font-medium text-mv-text hover:bg-white/[0.05] transition-colors"
            >
              <InfoIcon className="w-[18px] h-[18px]" strokeWidth={1.8} aria-hidden />
              Fazer o tour guiado
            </button>
            <button
              onClick={signOut}
              className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[14px] font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
            >
              <LogOutIcon className="w-[18px] h-[18px]" strokeWidth={1.8} aria-hidden />
              Sair
            </button>
          </div>
        </div>
      </nav>

      {/* Conteúdo */}
      <div ref={contentRef} className="flex-1 md:flex-[1_1_800px] min-w-0 overflow-y-auto">
        <div className="flex">
          <div key={tab} className="flex-1 min-w-0 max-w-[680px] px-4 sm:px-8 lg:px-10 py-6 md:py-14 animate-fade-slide-in">
            {tab === 'account' && <AccountTab email={user?.email} onSignOut={signOut} />}
            {tab === 'security' && <SecurityTab />}
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'audio' && <AudioTab />}
            {tab === 'keybinds' && <KeybindsTab />}
            {tab === 'notifications' && <NotificationsTab />}
            {tab === 'privacy' && <PrivacyTab />}
            {(tab === 'licenses' || ((tab === 'admin' || tab === 'admin-users') && isAppAdmin)) && (
              <Suspense fallback={<p className="text-[13px] text-mv-muted">Carregando...</p>}>
                {tab === 'licenses' ? <LicensesTab /> : tab === 'admin-users' ? <AdminUsersTab /> : <AdminReportsTab />}
              </Suspense>
            )}
          </div>

          {/* Fechar estilo apps de chat: círculo + "ESC" embaixo. Fica na coluna
              ao lado do conteúdo e acompanha a rolagem (sticky).
              top-14 (não top-6) — essa tela cobre a janela inteira (fixed
              inset-0) desde y=0, mas os botões NATIVOS de
              minimizar/maximizar/fechar do Windows ficam desenhados por
              cima dos primeiros 40px (ver titleBarOverlay em
              electron/main.cjs). Com top-6 (24px) esse botão ficava bem
              embaixo dessa faixa, cortado/"vazando" por trás dos botões
              nativos — descendo pra depois dos 40px (com uma folga) ele
              para de disputar esse espaço com o sistema. */}
          <div className="hidden md:block shrink-0 w-24 pl-2">
            <div className="sticky top-14 flex flex-col items-center gap-1.5">
              <button
                onClick={onClose}
                className="w-10 h-10 rounded-full border-2 border-[var(--color-line-strong)] text-mv-muted hover:border-mv-muted hover:text-white hover:bg-white/[0.04] flex items-center justify-center transition-colors"
                aria-label="Fechar"
                title="Fechar (Esc)"
              >
                <CloseGlyph />
              </button>
              <span aria-hidden="true" className="text-[11px] font-semibold tracking-wider text-mv-muted">
                ESC
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function AppVersionInfo() {
  const [version, setVersion] = useState<string | null>(null)
  const { checkNow } = useAppUpdater()
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    window.electronAPI?.getVersion().then(setVersion)
  }, [])

  // Só existe dentro do app desktop — no site não faz sentido mostrar
  // versão de instalador nenhuma.
  if (!version) return null

  return (
    <div className="flex items-center justify-between gap-3 px-1 pt-1">
      <p className="text-[12px] text-mv-muted">Mamacos Voip — versão {version}</p>
      <button
        onClick={() => {
          setChecking(true)
          checkNow()
          setTimeout(() => setChecking(false), 3000)
        }}
        disabled={checking}
        className="text-[12px] font-medium text-mv-accent hover:underline disabled:opacity-60"
      >
        {checking ? 'Verificando...' : 'Verificar atualização agora'}
      </button>
    </div>
  )
}

function gradientFor(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  return `linear-gradient(135deg, hsl(${hue} 70% 40%), hsl(${(hue + 45) % 360} 65% 22%))`
}

function AccountTab({ email, onSignOut }: { email: string | undefined; onSignOut: () => void }) {
  const { profile, user } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const avatarTransparent = useAvatarTransparent(profile?.avatar_url)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  // Conta sem senha (entrou com Google) ou esqueceu a atual: confirma a
  // identidade com o código que o Supabase manda por e-mail
  // (reauthenticate + nonce) em vez da senha atual.
  const [useEmailCode, setUseEmailCode] = useState(false)
  const [emailCode, setEmailCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSendCode() {
    setError(null)
    if (sendingCode) return
    const limit = checkRateLimit('password-change-code', 2, 5 * 60_000)
    if (!limit.allowed) {
      setError(`Espere ${limit.retryAfterSeconds}s antes de pedir outro código.`)
      return
    }
    setSendingCode(true)
    const { error } = await supabase.auth.reauthenticate()
    setSendingCode(false)
    if (error) {
      setError(traduzErro(error.message))
      return
    }
    setCodeSent(true)
  }

  // M4 — confere a senha atual SEM mexer na sessão desta janela: o
  // login de conferência roda num cliente descartável (não substitui a
  // sessão atual nem derruba o 2FA dela) e é encerrado logo em seguida.
  async function verifyCurrentPassword(): Promise<string | null> {
    if (!email) return 'Não foi possível identificar o e-mail da conta.'
    if (!currentPassword) return 'Digite a sua senha atual.'
    const verifier = createEphemeralAuthClient()
    const { data, error } = await verifier.auth.signInWithPassword({ email, password: currentPassword })
    if (data.session) await verifier.auth.signOut({ scope: 'local' }).catch(() => {})
    if (error) {
      if (/invalid login credentials/i.test(error.message)) return 'Senha atual incorreta.'
      return traduzErro(error.message)
    }
    if (!data.user || data.user.id !== user?.id) return 'Senha atual incorreta.'
    return null
  }

  async function handleChangePassword() {
    setError(null)
    setSuccess(false)
    if (loading) return
    const invalid = validatePassword(newPassword, { email })
    if (invalid) {
      setError(invalid)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas não conferem.')
      return
    }
    if (useEmailCode && !/^\d{6,10}$/.test(emailCode.trim())) {
      setError(codeSent ? 'Digite o código que chegou no seu e-mail.' : 'Peça o código por e-mail primeiro.')
      return
    }
    // Freio local contra tentativa e erro da senha atual (o Supabase
    // também limita por IP no servidor).
    const limit = checkRateLimit('password-change', 5, 10 * 60_000)
    if (!limit.allowed) {
      setError(`Muitas tentativas. Espere ${limit.retryAfterSeconds}s e tente de novo.`)
      return
    }
    setLoading(true)
    if (!useEmailCode) {
      const reauthError = await verifyCurrentPassword()
      if (reauthError) {
        setLoading(false)
        setError(reauthError)
        return
      }
    }
    const { error } = await supabase.auth.updateUser(
      useEmailCode ? { password: newPassword, nonce: emailCode.trim() } : { password: newPassword }
    )
    if (error) {
      setLoading(false)
      if (/reauthentication|nonce/i.test(error.message)) {
        if (useEmailCode) {
          setError('Código inválido ou expirado. Peça um novo código.')
        } else {
          // "Secure password change" ligado no Supabase e a sessão não é
          // recente: o servidor exige o código por e-mail.
          setUseEmailCode(true)
          setError('Por segurança, confirme com o código enviado por e-mail (botão "Enviar código").')
        }
        return
      }
      setError(traduzErro(error.message))
      return
    }
    // Senha trocada = derruba as sessões dos outros aparelhos (quem
    // tinha a senha antiga não continua logado). Esta fica.
    await supabase.auth.signOut({ scope: 'others' }).catch(() => {})
    setLoading(false)
    setCurrentPassword('')
    setConfirmPassword('')
    setEmailCode('')
    setCodeSent(false)
    setSuccess(true)
    setNewPassword('')
  }

  return (
    <div className="space-y-5">
      <TabHeader title="Minha conta" description="Seus dados de acesso e o que acontece com a sua conta." />

      {/* Cartão de identidade */}
      <section className="rounded-2xl border border-[var(--color-line)] bg-white/[0.02] overflow-hidden">
        <div
          className="h-20 bg-cover bg-center"
          style={
            profile?.banner_url
              ? { backgroundImage: `url(${profile.banner_url})` }
              : { background: gradientFor(profile?.username ?? email ?? 'x') }
          }
        />
        <div className="px-5 pb-5 flex items-start gap-4">
          <div className={`-mt-9 shrink-0 ${avatarTransparent ? '' : 'rounded-full ring-[5px] ring-[var(--color-mv-main)] bg-mv-main'}`}>
            <Avatar name={profile?.username ?? email ?? '?'} avatarUrl={profile?.avatar_url} size={72} />
          </div>
          <div className="min-w-0 pt-2.5">
            <p className="font-display text-lg font-semibold text-white truncate">
              {profile?.display_name || profile?.username || 'Você'}
            </p>
            {profile && <p className="text-[13px] text-mv-muted truncate">@{profile.username}</p>}
          </div>
        </div>
        <div className="mx-5 mb-5 rounded-xl bg-mv-canvas/60 border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted">E-mail</p>
              <p className="text-[14px] text-mv-text truncate mt-0.5">{email}</p>
            </div>
          </div>
          {profile && (
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted">Nome de usuário</p>
                <p className="text-[14px] text-mv-text truncate mt-0.5">{profile.username}</p>
              </div>
            </div>
          )}
        </div>
      </section>

      <SettingsCard title="Alterar senha" description="Use pelo menos 8 caracteres, com letras e números.">
        {useEmailCode ? (
          <div className="mb-3">
            <label htmlFor="settings-email-code" className="field-label">
              Código enviado por e-mail
            </label>
            <div className="flex gap-2">
              <input
                id="settings-email-code"
                type="text"
                inputMode="numeric"
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="000000"
                autoComplete="one-time-code"
                className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none text-sm"
              />
              <button onClick={handleSendCode} disabled={sendingCode} className="btn-secondary h-10 px-4 text-sm shrink-0">
                {sendingCode ? 'Enviando...' : codeSent ? 'Reenviar' : 'Enviar código'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setUseEmailCode(false)
                setError(null)
              }}
              className="mt-1.5 text-xs text-mv-accent font-medium hover:underline"
            >
              Usar a senha atual
            </button>
          </div>
        ) : (
          <div className="mb-3">
            <label htmlFor="settings-current-password" className="field-label">
              Senha atual
            </label>
            <input
              id="settings-current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none text-sm"
            />
            <button
              type="button"
              onClick={() => {
                setUseEmailCode(true)
                setError(null)
              }}
              className="mt-1.5 text-xs text-mv-accent font-medium hover:underline"
            >
              Entrou com Google ou não lembra a senha atual? Confirmar por código no e-mail
            </button>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="settings-new-password" className="field-label">
              Nova senha
            </label>
            <input
              id="settings-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres, com letra e número"
              autoComplete="new-password"
              className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none text-sm"
            />
          </div>
          <div>
            <label htmlFor="settings-confirm-password" className="field-label">
              Confirmar nova senha
            </label>
            <input
              id="settings-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none text-sm"
            />
          </div>
        </div>

        {(error || success) && (
          <div className="mt-3">
            {error && <InlineMessage tone="error">{error}</InlineMessage>}
            {success && (
              <InlineMessage tone="success">Senha alterada com sucesso. Os outros aparelhos foram desconectados.</InlineMessage>
            )}
          </div>
        )}

        <div className="flex justify-end mt-4">
          <button onClick={handleChangePassword} disabled={loading} className="btn-primary h-10 px-5 text-sm">
            {loading ? 'Salvando...' : 'Alterar senha'}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard tone="danger" title="Zona de perigo" description="Ações que afetam o acesso à sua conta.">
        <RowList>
          <SettingRow
            title="Sair da conta"
            description="Encerra a sessão neste aparelho."
            control={
              <button
                onClick={onSignOut}
                className="shrink-0 h-9 px-4 rounded-[10px] text-sm font-medium text-rose-300 border border-rose-500/40 hover:bg-rose-500/10 transition-colors"
              >
                Sair
              </button>
            }
          />
          <DeleteAccountSection />
        </RowList>
      </SettingsCard>

      <AppVersionInfo />
    </div>
  )
}

function DeleteAccountSection() {
  const { signOut, user, profile } = useAuth()
  const [confirming, setConfirming] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (confirmText.trim().toLowerCase() !== 'excluir') return
    setLoading(true)
    setError(null)
    // Imagens de perfil (avatar/banner/decoração) ficam no Storage, fora
    // do alcance do delete_own_account — apaga antes (best-effort).
    if (user) {
      await deleteOwnProfileFiles(user.id, [profile?.avatar_url, profile?.banner_url, profile?.avatar_decoration_url])
    }
    const { error } = await supabase.rpc('delete_own_account')
    if (error) {
      setLoading(false)
      setError(traduzErro(error.message))
      return
    }
    await signOut()
  }

  return (
    <SettingRow
      title="Excluir conta"
      description="Apaga sua conta, mensagens e os servidores dos quais você é dono."
      control={
        !confirming ? (
          <button onClick={() => setConfirming(true)} className="btn-danger shrink-0 h-9 px-4 text-sm">
            Excluir conta
          </button>
        ) : undefined
      }
    >
      {confirming && (
        <div className="mt-3 rounded-xl bg-rose-500/[0.06] border border-rose-500/25 p-4 space-y-3 animate-fade-slide-in">
          <p className="text-[14px] text-rose-300 font-semibold">Isso não pode ser desfeito.</p>
          <p className="text-[13px] text-mv-muted leading-relaxed">
            Sua conta, mensagens e servidores que você é dono são apagados de vez. Se você é dono de algum
            servidor, ele é apagado inteiro pra todo mundo — considere transferir a propriedade antes, se quiser
            manter o servidor de pé.
          </p>
          <label htmlFor="settings-delete-confirm" className="block text-[13px] text-mv-muted">
            Digite <span className="text-white font-mono">excluir</span> pra confirmar.
          </label>
          <input
            id="settings-delete-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="excluir"
            className="w-full px-3 py-2.5 text-sm bg-mv-canvas text-mv-text outline-none"
          />
          {error && <InlineMessage tone="error">{error}</InlineMessage>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setConfirming(false)
                setConfirmText('')
                setError(null)
              }}
              className="btn-secondary h-9 px-4 text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={handleDelete}
              disabled={confirmText.trim().toLowerCase() !== 'excluir' || loading}
              className="btn-danger h-9 px-4 text-sm"
            >
              {loading ? 'Excluindo...' : 'Excluir de vez'}
            </button>
          </div>
        </div>
      )}
    </SettingRow>
  )
}

function NotificationsTab() {
  const [permission, setPermission] = useState(getNotificationPermission())

  useEffect(() => {
    setPermission(getNotificationPermission())
  }, [])

  async function handleEnable() {
    const result = await requestNotificationPermission()
    setPermission(result)
  }

  const state =
    permission === 'unsupported'
      ? { chip: 'Indisponível', chipClass: '', text: 'Seu navegador não suporta notificações.' }
      : permission === 'granted'
        ? { chip: 'Ativadas', chipClass: '!text-mv-green !border-mv-green/30 !bg-mv-green/10', text: 'Tudo certo — você vai ser avisado de novas mensagens.' }
        : permission === 'denied'
          ? {
              chip: 'Bloqueadas',
              chipClass: '!text-rose-300 !border-rose-500/30 !bg-rose-500/10',
              text: 'Notificações bloqueadas. Habilite manualmente nas configurações do navegador pra este site.',
            }
          : { chip: 'Desativadas', chipClass: '', text: 'Ative pra ser avisado quando chegar mensagem.' }

  return (
    <div className="space-y-5">
      <TabHeader
        title="Notificações"
        description="Receba notificações do navegador quando novas mensagens chegarem em uma conversa aberta e a aba estiver em segundo plano."
      />
      <SettingsCard>
        <div className="flex items-center gap-4">
          <span className="w-11 h-11 shrink-0 rounded-xl bg-mv-accent/15 text-mv-accent flex items-center justify-center">
            <NavIcon tab="notifications" className="w-5 h-5" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-medium text-white">Notificações na área de trabalho</p>
              <span className={`chip ${state.chipClass}`}>{state.chip}</span>
            </div>
            <p className="text-[13px] text-mv-muted mt-0.5">{state.text}</p>
          </div>
          {permission !== 'unsupported' && permission !== 'granted' && permission !== 'denied' && (
            <button onClick={handleEnable} className="btn-primary h-9 px-4 text-sm shrink-0">
              Ativar notificações
            </button>
          )}
        </div>
      </SettingsCard>
    </div>
  )
}

// Sons do app: liga/desliga, volume dos efeitos e prévia de cada som da
// identidade sonora (lib/sounds.ts). A prévia toca mesmo com os sons
// desligados — é um clique explícito da pessoa.
function SoundEffectsCard() {
  const [soundsOn, setSoundsOn] = useState(() => isSoundEnabled())
  const [volume, setVolume] = useState(() => getSoundVolume())
  const [lastPlayed, setLastPlayed] = useState<UiSoundId | null>(null)
  const volumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current)
      if (playedTimerRef.current) clearTimeout(playedTimerRef.current)
    },
    []
  )

  function handleVolume(next: number) {
    setVolume(next)
    setSoundVolume(next)
    // Toca uma amostra quando a pessoa para de arrastar.
    if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current)
    volumeTimerRef.current = setTimeout(() => previewUiSound('message'), 250)
  }

  function preview(id: UiSoundId) {
    previewUiSound(id)
    setLastPlayed(id)
    if (playedTimerRef.current) clearTimeout(playedTimerRef.current)
    playedTimerRef.current = setTimeout(() => setLastPlayed(null), 700)
  }

  return (
    <SettingsCard title="Sons do app">
      <RowList>
        <SettingRow
          title="Sons de interface"
          description="Toques originais do Mamacos ao entrar e sair da voz, mutar, receber mensagens, menções e pedidos de amizade."
          control={
            <Toggle
              label="Sons de interface"
              checked={soundsOn}
              onChange={(checked) => {
                setSoundsOn(checked)
                setSoundEnabled(checked)
                if (checked) playConnectSound()
              }}
            />
          }
        />
        <SettingRow title="Volume dos efeitos" description="Só dos sons do app — não mexe no volume das pessoas na call.">
          <div className="flex items-center gap-3 pt-1">
            <RangeSlider label="Volume dos efeitos" min={0} max={100} value={volume} onChange={handleVolume} />
            <span className="w-10 text-right text-[13px] tabular-nums text-mv-muted">{volume}%</span>
          </div>
        </SettingRow>
        <SettingRow title="Ouvir os sons" description="Clique pra ouvir cada som do app.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
            {SOUND_CATALOG.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => preview(s.id)}
                aria-label={`Tocar som: ${s.label}`}
                className={`group flex items-center gap-2.5 h-9 pl-1.5 pr-3 rounded-lg text-left text-[13px] transition-colors ${
                  lastPlayed === s.id ? 'bg-mv-accent/15 text-white' : 'bg-white/[0.03] text-mv-text hover:bg-white/[0.07]'
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                    lastPlayed === s.id ? 'bg-mv-accent text-white' : 'bg-white/[0.06] text-mv-muted group-hover:text-white'
                  }`}
                >
                  <PlayIcon className="w-3 h-3" fill="currentColor" aria-hidden />
                </span>
                <span className="truncate">{s.label}</span>
              </button>
            ))}
          </div>
        </SettingRow>
      </RowList>
    </SettingsCard>
  )
}

// Os valores do tema padrão (vermelho) moram no @theme do index.css, que
// vale pro :root — não existe um bloco [data-theme='vermelho'] pra
// "reaplicar" dentro da prévia quando outro tema está ativo. Por isso a
// prévia dele recebe as mesmas variáveis explicitamente (espelho do
// @theme; se mudar lá, mudar aqui).
const VERMELHO_PREVIEW_VARS = {
  '--color-mv-canvas': '#07070a',
  '--color-mv-main': '#121218',
  '--color-mv-side': '#0d0d12',
  '--color-mv-raised': '#25252e',
  '--color-mv-accent': '#ee3a34',
  '--color-accent-2': '#ff8a3d',
  '--color-accent-text': '#ee3a34',
  '--color-mv-muted': '#9d9dab',
} as React.CSSProperties

function ThemePreview({ id }: { id: ThemeId }) {
  return (
    <div
      data-theme={id === 'vermelho' ? undefined : id}
      style={id === 'vermelho' ? VERMELHO_PREVIEW_VARS : undefined}
      aria-hidden="true"
      className="h-[104px] rounded-xl overflow-hidden flex bg-mv-canvas border border-[var(--color-line)]"
    >
      <div className="w-7 flex flex-col items-center gap-1.5 pt-2">
        <span className="w-4 h-4 rounded-[6px] bg-brand-gradient" />
        <span className="w-4 h-4 rounded-full bg-mv-raised" />
        <span className="w-4 h-4 rounded-full bg-mv-raised" />
      </div>
      <div className="w-16 bg-mv-side rounded-tl-lg mt-1.5 p-1.5 space-y-1.5">
        <span className="block h-1.5 w-10 rounded-full bg-mv-muted/40" />
        <span className="block h-2.5 w-full rounded bg-mv-raised" />
        <span className="block h-1.5 w-9 rounded-full bg-mv-muted/30" />
        <span className="block h-1.5 w-11 rounded-full bg-mv-muted/30" />
      </div>
      <div className="flex-1 bg-mv-main mt-1.5 p-2 flex flex-col justify-end gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-full bg-mv-raised shrink-0" />
          <span className="h-1.5 w-16 rounded-full bg-mv-muted/40" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-full bg-mv-accent shrink-0" />
          <span className="h-1.5 w-7 rounded-full bg-[var(--color-accent-text,var(--color-mv-accent))]" />
          <span className="h-1.5 w-12 rounded-full bg-mv-muted/30" />
        </div>
        <div className="h-4 rounded-md bg-mv-raised/70 flex items-center justify-end px-1">
          <span className="w-2.5 h-2.5 rounded-full bg-mv-accent" />
        </div>
      </div>
    </div>
  )
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="space-y-5">
      <TabHeader title="Aparência" description="Escolha a paleta de cores do app. A troca é na hora e vale só pra este aparelho." />
      <SettingsCard title="Tema">
        <div role="radiogroup" aria-label="Tema" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {THEMES.map((t) => {
            const active = theme === t.id
            return (
              <button
                key={t.id}
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(t.id)}
                className={`group text-left rounded-2xl p-2 transition-all ${
                  active
                    ? 'bg-mv-accent/[0.08] shadow-[0_0_0_2px_var(--color-mv-accent)]'
                    : 'bg-white/[0.02] shadow-[0_0_0_1px_var(--color-line)] hover:shadow-[0_0_0_1px_var(--color-line-strong)] hover:bg-white/[0.04]'
                }`}
              >
                <ThemePreview id={t.id} />
                <div className="flex items-center gap-2.5 px-1.5 pt-2.5 pb-1">
                  <span
                    className={`w-[18px] h-[18px] rounded-full shrink-0 flex items-center justify-center border-2 transition-colors ${
                      active ? 'border-mv-accent bg-mv-accent' : 'border-[var(--color-line-strong)]'
                    }`}
                  >
                    {active && (
                      <CheckIcon className="w-2.5 h-2.5 text-white" strokeWidth={4} aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-white">{t.label}</p>
                    <p className="text-[12px] text-mv-muted truncate">{t.description}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </SettingsCard>
    </div>
  )
}

function AudioTab() {
  // Antes esse componente chamava useAudioSettings() direto, criando uma
  // SEGUNDA instância independente do estado — separada da que o
  // VoiceContext usa de verdade pra call em andamento (voice.audioSettings).
  // As duas liam o mesmo localStorage só na hora de montar, então
  // funcionavam bem na primeira vez que a pessoa abria o app, mas
  // qualquer mudança feita aqui dentro (trocar microfone, ligar/desligar
  // redutor de ruído, trocar alto-falante) nunca chegava na call já
  // conectada nem no restante do app (ex.: o ícone de redutor de ruído
  // ao lado do perfil) — só valia depois de fechar e abrir o app de
  // novo. Usando a MESMA instância do VoiceContext, qualquer alteração
  // aqui já é a fonte da verdade em todo lugar.
  const voice = useVoiceCore()
  const audio = voice.audioSettings
  const [testing, setTesting] = useState(false)
  const [echoing, setEchoing] = useState(false)
  const [level, setLevel] = useState(0)
  // Nível do mic em dB (antes do corte da sensibilidade), pro medidor.
  const [inputDb, setInputDb] = useState<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const echoAudioRef = useRef<HTMLAudioElement>(null)
  // Reforço de redução de ruído (RNNoise) pro teste de mic/eco — usa a
  // mesma lógica de VoiceContext.tsx, pra o que a pessoa OUVE/VÊ aqui
  // bater com o que realmente sai na call de verdade.
  const noiseSuppressorTestRef = useRef<NoiseSuppressor | null>(null)
  // Arrastar o slider de sensibilidade dispara um onChange por PIXEL —
  // chamar voice.refreshAudioConstraints (que recaptura o microfone e
  // reconstrói o gráfico do RNNoise) a cada um desses seria pesado
  // demais numa call em andamento. Espera 400ms sem nenhuma mudança nova
  // antes de aplicar de verdade na call — a pessoa só ouve/vê o efeito
  // quando solta o slider (ou para de arrastar por um instante).
  const sensitivityDebounceRef = useRef<number | null>(null)

  function handleSensitivityChange(value: number) {
    audio.setMicSensitivity(value)
    // No teste o efeito é na hora (sem reiniciar o microfone).
    noiseSuppressorTestRef.current?.setSensitivity(value)
    if (sensitivityDebounceRef.current) window.clearTimeout(sensitivityDebounceRef.current)
    sensitivityDebounceRef.current = window.setTimeout(() => {
      voice.refreshAudioConstraints({ micSensitivity: value })
    }, 400)
  }

  function handleSensitivityModeChange(mode: 'auto' | 'manual') {
    audio.setMicSensitivityMode(mode)
    voice.refreshAudioConstraints({ micSensitivityMode: mode })
    const testSuppressor = noiseSuppressorTestRef.current
    if (testSuppressor) {
      if (mode === 'auto') {
        testSuppressor.setSensitivity(DEFAULT_MIC_SENSITIVITY)
        startTestAutoSensitivity(testSuppressor)
      } else {
        stopTestAutoSensitivity()
        testSuppressor.setSensitivity(audio.micSensitivity)
      }
    }
  }

  // Réplica, só pro teste/eco daqui do modal (que usa seu próprio
  // NoiseSuppressor local em vez do da call de verdade), do mesmo loop
  // de auto-ajuste de sensibilidade que roda em VoiceContext.tsx — ver o
  // comentário grande no useEffect "Sensibilidade automática do
  // microfone" lá pra entender a lógica da média móvel assimétrica.
  // Mantido em sincronia de propósito: assim o que a pessoa vê/ouve
  // testando aqui bate com o que acontece numa call de verdade.
  const testAutoRef = useRef(createAutoSensitivity())
  const testAutoIntervalRef = useRef<number | null>(null)

  function stopTestAutoSensitivity() {
    if (testAutoIntervalRef.current) {
      window.clearInterval(testAutoIntervalRef.current)
      testAutoIntervalRef.current = null
    }
    testAutoRef.current.reset()
  }

  function startTestAutoSensitivity(suppressor: NoiseSuppressor) {
    stopTestAutoSensitivity()
    testAutoIntervalRef.current = window.setInterval(() => {
      const level = suppressor.sampleLevelDb()
      if (level === null) return
      const threshold = testAutoRef.current.push(level)
      if (threshold !== null) suppressor.setSensitivityDb(threshold)
    }, AUTO_SENSITIVITY_TICK_MS)
  }

  // Aplica o RNNoise na track crua, se a redução de ruído estiver ligada
  // — devolve a stream já tratada (ou a crua sem alteração, se estiver
  // desligada ou o WASM falhar ao carregar).
  async function applyTestNoiseSuppression(rawStream: MediaStream): Promise<MediaStream> {
    // Sempre monta o gráfico (com ou sem RNNoise): a sensibilidade mora nele.
    try {
      const suppressor = await createNoiseSuppressor()
      noiseSuppressorTestRef.current = suppressor
      const isAuto = audio.micSensitivityMode === 'auto'
      const processedTrack = suppressor.setInputTrack(rawStream.getAudioTracks()[0], isAuto ? DEFAULT_MIC_SENSITIVITY : audio.micSensitivity, {
        denoise: audio.noiseSuppression,
      })
      if (isAuto) startTestAutoSensitivity(suppressor)
      return new MediaStream([processedTrack])
    } catch {
      // segue só com o cancelamento nativo do navegador
      return rawStream
    }
  }

  async function handleRequestPermission() {
    await audio.requestPermission()
  }

  async function startTest() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audio.getAudioConstraints() })
      streamRef.current = stream
      const testStream = await applyTestNoiseSuppression(stream)
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(testStream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const buffer = new Uint8Array(analyser.frequencyBinCount)

      function tick() {
        analyser.getByteFrequencyData(buffer)
        const avg = buffer.reduce((a, b) => a + b, 0) / buffer.length
        setLevel(Math.min(100, Math.round((avg / 100) * 100)))
        setInputDb(noiseSuppressorTestRef.current?.sampleLevelDb() ?? null)
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
      setTesting(true)
    } catch {
      // sem permissão/dispositivo — o botão simplesmente não faz nada
    }
  }

  function stopTest() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    audioCtxRef.current?.close()
    streamRef.current = null
    audioCtxRef.current = null
    noiseSuppressorTestRef.current?.destroy()
    noiseSuppressorTestRef.current = null
    stopTestAutoSensitivity()
    setTesting(false)
    setLevel(0)
    setInputDb(null)
  }

  // Eco de áudio: pega o microfone, atrasa um pouco (150ms) e toca de
  // volta pelo alto-falante escolhido. É o jeito mais direto de
  // confirmar que o fone/headset inteiro funciona (mic + saída), sem
  // precisar de outra pessoa online — o pequeno atraso evita a
  // microfonia (efeito Larsen) que aconteceria com um loopback instantâneo.
  async function startEcho() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audio.getAudioConstraints() })
      streamRef.current = stream
      const echoStream = await applyTestNoiseSuppression(stream)
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(echoStream)
      const delay = ctx.createDelay(1)
      delay.delayTime.value = 0.15
      // Duplica explicitamente pros dois canais (ver o mesmo truque em
      // noiseSuppression.ts) — sem isso, o eco às vezes só saía pelo
      // lado esquerdo do fone quando a captura do microfone é mono
      // (praticamente sempre é, ver getAudioConstraints).
      const merger = ctx.createChannelMerger(2)
      const dest = ctx.createMediaStreamDestination()
      source.connect(delay)
      delay.connect(merger, 0, 0)
      delay.connect(merger, 0, 1)
      merger.connect(dest)

      if (echoAudioRef.current) {
        echoAudioRef.current.srcObject = dest.stream
        const el = echoAudioRef.current as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
        if (audio.speakerId && el.setSinkId) await el.setSinkId(audio.speakerId).catch(() => {})
        await echoAudioRef.current.play()
      }
      setEchoing(true)
    } catch {
      // sem permissão/dispositivo — o botão simplesmente não faz nada
    }
  }

  function stopEcho() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    audioCtxRef.current?.close()
    streamRef.current = null
    audioCtxRef.current = null
    noiseSuppressorTestRef.current?.destroy()
    noiseSuppressorTestRef.current = null
    stopTestAutoSensitivity()
    if (echoAudioRef.current) echoAudioRef.current.srcObject = null
    setEchoing(false)
  }

  useEffect(
    () => () => {
      stopTest()
      stopEcho()
      stopTestAutoSensitivity()
      if (sensitivityDebounceRef.current) window.clearTimeout(sensitivityDebounceRef.current)
    },
    []
  )

  // Igual o app de chat popular faz na tela de configurações: se o teste de
  // microfone já está rodando, ligar/desligar redução de ruído (ou eco,
  // ou ganho automático) reinicia o teste na hora com a config nova —
  // assim dá pra OUVIR/VER a diferença na barra de nível imediatamente,
  // em vez de ter que parar e começar o teste nas mãos toda vez. Não
  // depende de `testing` de propósito: só deve disparar quando uma
  // dessas configs muda enquanto o teste já está ativo, não quando o
  // teste começa (senão dispararia duas vezes ao clicar em "Testar
  // microfone").
  useEffect(() => {
    if (!testing) return
    stopTest()
    startTest()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    audio.echoCancellation,
    audio.noiseSuppression,
    audio.autoGainControl,
    audio.micId,
    // Sensibilidade NÃO reinicia o teste: é aplicada ao vivo
    // (handleSensitivityChange / handleSensitivityModeChange).
  ])


  // "Sons de interface" era um checkbox não controlado (defaultChecked) —
  // agora é um Toggle, que precisa de estado pra desenhar a posição.

  const selectClass = 'w-full px-3 py-2.5 bg-mv-canvas text-mv-text outline-none text-sm disabled:opacity-50'

  return (
    <div className="space-y-5">
      <audio ref={echoAudioRef} className="hidden" />
      <TabHeader title="Voz e Vídeo" description="Dispositivos, processamento de voz e testes rápidos pra deixar a call redonda." />

      {!audio.permissionGranted && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-mv-accent/30 bg-mv-accent/[0.07] p-4">
          <span className="w-10 h-10 shrink-0 rounded-xl bg-mv-accent/15 text-mv-accent flex items-center justify-center">
            <NavIcon tab="audio" className="w-5 h-5" />
          </span>
          <p className="flex-1 text-[13px] text-mv-text">
            Autorize o acesso ao microfone pra ver os nomes dos seus dispositivos de áudio.
          </p>
          <button onClick={handleRequestPermission} className="btn-primary h-9 px-4 text-sm shrink-0">
            Permitir acesso ao microfone
          </button>
        </div>
      )}

      <SettingsCard title="Dispositivos">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="settings-mic" className="field-label">
              Microfone de entrada
            </label>
            <select
              id="settings-mic"
              value={audio.micId ?? ''}
              onChange={(e) => voice.changeMicrophone(e.target.value)}
              className={selectClass}
            >
              <option value="">Padrão do sistema</option>
              {audio.microphones.map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="settings-speaker" className="field-label">
              Alto-falante de saída
            </label>
            <select
              id="settings-speaker"
              value={audio.speakerId ?? ''}
              onChange={(e) => audio.setSpeakerId(e.target.value || null)}
              disabled={!audio.supportsOutputSelection}
              className={selectClass}
            >
              <option value="">Padrão do sistema</option>
              {audio.speakers.map((s) => (
                <option key={s.deviceId} value={s.deviceId}>
                  {s.label}
                </option>
              ))}
            </select>
            {!audio.supportsOutputSelection && (
              <p className="text-[11px] text-mv-muted mt-1.5">Não suportado neste navegador.</p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="settings-camera" className="field-label">
              Câmera
            </label>
            <select
              id="settings-camera"
              value={audio.cameraId ?? ''}
              onChange={(e) => audio.setCameraId(e.target.value || null)}
              className={selectClass}
            >
              <option value="">Padrão do sistema</option>
              {audio.cameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="text-[12px] text-mv-muted mt-2 leading-relaxed">
              Se você usa OBS (ou outro programa de captura) e liga a "Câmera Virtual" dele, pode escolher ela aqui — a
              câmera do app passa a mostrar o que o OBS estiver capturando, em vez da sua webcam de verdade. Útil se o
              compartilhamento de tela normal não funcionar bem com algum jogo específico, mas o OBS captura ele sem
              problema.
            </p>
            <CameraTest cameraId={audio.cameraId ?? null} />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Testes" description="Confira se o microfone e o fone estão funcionando antes de entrar na call.">
        <RowList>
          <SettingRow
            title="Testar microfone"
            description={
              testing
                ? 'Fala alguma coisa — a barra reage ao volume captado. Dá pra ligar/desligar os controles abaixo com o teste rodando pra ouvir a diferença na hora.'
                : 'Mostra o nível do que o microfone está captando.'
            }
            control={
              <button
                onClick={testing ? stopTest : startTest}
                className={`${testing ? 'btn-secondary' : 'btn-primary'} h-9 px-4 text-sm shrink-0`}
              >
                {testing ? 'Parar teste' : 'Testar microfone'}
              </button>
            }
          >
            <div
              className="mt-3 h-2.5 rounded-full bg-mv-canvas border border-[var(--color-line)] overflow-hidden"
              role="meter"
              aria-label="Nível do microfone"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={level}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-mv-green via-mv-green to-amber-400 transition-[width] duration-75"
                style={{ width: `${level}%` }}
              />
            </div>
          </SettingRow>
          <SettingRow
            title="Testar mic + fone juntos (eco)"
            description="Fala alguma coisa e escuta sua própria voz voltando com um pequeno atraso — se você se ouvir, o microfone e o alto-falante/fone escolhidos estão funcionando juntos. Use fone de ouvido pra evitar microfonia."
            control={
              <button
                onClick={echoing ? stopEcho : startEcho}
                className={`${echoing ? 'btn-danger' : 'btn-secondary'} h-9 px-4 text-sm shrink-0`}
              >
                {echoing ? 'Parar eco' : 'Ouvir a si mesmo'}
              </button>
            }
          />
        </RowList>
      </SettingsCard>

      <SettingsCard title="Processamento de voz">
        <RowList>
          <SettingRow
            title="Redução de ruído"
            description="Reduz ruído de fundo constante (ventoinha, teclado, ar-condicionado) enquanto você fala."
            control={
              <Toggle
                label="Redução de ruído"
                checked={audio.noiseSuppression}
                onChange={(checked) => {
                  audio.setNoiseSuppression(checked)
                  voice.refreshAudioConstraints({ noiseSuppression: checked })
                }}
              />
            }
          />
          <SettingRow
            title="Cancelamento de eco"
            description="Evita que o som que sai do seu alto-falante volte pelo microfone."
            control={
              <Toggle
                label="Cancelamento de eco"
                checked={audio.echoCancellation}
                onChange={(checked) => {
                  audio.setEchoCancellation(checked)
                  voice.refreshAudioConstraints({ echoCancellation: checked })
                }}
              />
            }
          />
          <SettingRow
            title="Controle automático de ganho"
            description="Ajusta o volume de captura sozinho, pra sua voz não ficar baixa nem estourar."
            control={
              <Toggle
                label="Controle automático de ganho"
                checked={audio.autoGainControl}
                onChange={(checked) => {
                  audio.setAutoGainControl(checked)
                  voice.refreshAudioConstraints({ autoGainControl: checked })
                }}
              />
            }
          />
          <SettingRow
            title="Sensibilidade do microfone"
            description="Corta o microfone quando o volume está abaixo desse nível — bom pra parar de captar o teclado ou sons baixos da mesa entre uma fala e outra."
          >
            <div className="mt-3 space-y-3">
              <Segmented
                label="Modo de sensibilidade"
                value={audio.micSensitivityMode}
                onChange={handleSensitivityModeChange}
                options={[
                  { value: 'auto', label: 'Automática' },
                  { value: 'manual', label: 'Manual' },
                ]}
              />
              {audio.micSensitivityMode === 'auto' && (
                <p className="text-[12.5px] text-mv-muted leading-relaxed">
                  O app mede o ruído do seu ambiente sozinho e ajusta o corte automaticamente enquanto você está numa
                  chamada — não precisa mexer em nada.
                </p>
              )}
              <SensitivityMeter
                manual={audio.micSensitivityMode === 'manual'}
                sensitivity={audio.micSensitivity}
                onChange={handleSensitivityChange}
                inputDb={testing ? inputDb : null}
                testing={testing}
                onStartTest={startTest}
              />
            </div>
          </SettingRow>
        </RowList>
      </SettingsCard>

      <SettingsCard title="Entrada e interface">
        <RowList>
          <PushToTalkSection />
          {window.electronAPI?.isElectron && (
            <SettingRow
              title="Sobreposição em jogos"
              description={
                <>
                  Mostra quem está falando na call por cima do jogo. Ligue pelo menu da sala de voz ou crie um atalho em
                  Atalhos → "Mostrar/esconder sobreposição no jogo" (ele começa vazio pra não brigar com a AMD, NVIDIA,
                  Xbox etc.). No jogo, use o modo "tela cheia em janela"/"janela sem borda": em tela cheia exclusiva
                  nenhum app aparece por cima sem injetar código no jogo, o que dá ban — o Mamacos Voip não faz isso.
                </>
              }
            />
          )}
        </RowList>
      </SettingsCard>

      <SoundEffectsCard />

      <SettingsCard title="Transmissão de tela">
        <SettingRow
          title="Redução de ruído da transmissão"
          description="Ajuda com chiado/estática constante no áudio da tela/jogo compartilhado — mas como é uma tecnologia feita pra isolar VOZ, ela pode cortar ou abafar sons não-vocais do jogo (tiros, explosões, música). Deixe desligado se quiser o áudio do jogo completo; ligue só se estiver incomodado com chiado."
          control={
            <Toggle
              label="Redução de ruído da transmissão"
              checked={audio.screenAudioNoiseSuppression}
              onChange={(checked) => audio.setScreenAudioNoiseSuppression(checked)}
            />
          }
        />
      </SettingsCard>

      <InlineMessage tone="info">
        As mudanças aqui valem pra próxima vez que você entrar em um canal de voz. Trocar o microfone durante uma
        chamada já em andamento também dá — use o seletor que aparece na barra de controles da chamada.
      </InlineMessage>

      <div className="h-px bg-[var(--color-line)]" />

      <NetworkDiagnosticsPanel />
    </div>
  )
}

function PushToTalkSection() {
  const voice = useVoiceCore()
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    if (!capturing || voice.globalPushToTalkAvailable) return
    // Reserva: só usada quando o modo global não está disponível
    // nesse sistema — captura via teclado normal do navegador/app,
    // que só funciona com o app em foco.
    function handleKey(e: KeyboardEvent) {
      e.preventDefault()
      voice.setPushToTalkKey(e.code)
      setCapturing(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [capturing, voice])

  async function handleCaptureClick() {
    if (voice.globalPushToTalkAvailable) {
      setCapturing(true)
      await voice.captureGlobalPushToTalkKey()
      setCapturing(false)
      return
    }
    setCapturing(true)
  }

  const currentKeyLabel = voice.globalPushToTalkAvailable
    ? voice.pushToTalkGlobalKeyName ?? 'Nenhuma definida'
    : formatKeyCode(voice.pushToTalkKey)

  return (
    <SettingRow
      title="Push-to-talk"
      description={
        <>
          Microfone fica desligado o tempo todo — só transmite enquanto você segura a tecla escolhida.{' '}
          {voice.globalPushToTalkAvailable
            ? 'Funciona mesmo com outro programa (o jogo, por exemplo) em foco.'
            : 'Só funciona com o Mamacos Voip em foco (não funciona por cima de um jogo em tela cheia).'}
        </>
      }
      control={
        <Toggle label="Push-to-talk" checked={voice.pushToTalkEnabled} onChange={(checked) => voice.setPushToTalkEnabled(checked)} />
      }
    >
      {voice.pushToTalkEnabled && (
        <div className="flex items-center justify-between gap-3 mt-3 rounded-xl bg-mv-canvas/70 border border-[var(--color-line)] px-3 py-2.5">
          <span className="text-[13px] text-mv-muted">Tecla de atalho</span>
          <button
            onClick={handleCaptureClick}
            className={`min-w-[7rem] h-8 px-3 rounded-lg font-mono text-[12px] transition-colors border ${
              capturing
                ? 'bg-mv-accent/15 border-mv-accent text-white animate-pulse'
                : 'bg-mv-raised border-[var(--color-line-strong)] border-b-2 text-mv-text hover:text-white'
            }`}
          >
            {capturing ? 'Pressione uma tecla...' : currentKeyLabel}
          </button>
        </div>
      )}
    </SettingRow>
  )
}

function formatKeyCode(code: string): string {
  const map: Record<string, string> = {
    ControlLeft: 'Ctrl (esquerdo)',
    ControlRight: 'Ctrl (direito)',
    ShiftLeft: 'Shift (esquerdo)',
    ShiftRight: 'Shift (direito)',
    AltLeft: 'Alt (esquerdo)',
    AltRight: 'Alt (direito)',
    Space: 'Espaço',
    CapsLock: 'Caps Lock',
  }
  return map[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '')
}

function PrivacyTab() {
  const { profile, updateProfile } = useAuth()
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  async function handleChange(visibility: 'everyone' | 'friends_only') {
    setSaving(true)
    await updateProfile({ profile_visibility: visibility })
    setSaving(false)
  }

  async function handleExport() {
    if (!profile) return
    setExporting(true)
    try {
      await exportUserData(profile.id)
    } finally {
      setExporting(false)
    }
  }

  const current = profile?.profile_visibility ?? 'everyone'
  const options: { value: 'everyone' | 'friends_only'; title: string; text: string }[] = [
    { value: 'everyone', title: 'Todo mundo', text: 'Qualquer pessoa que compartilha um servidor com você vê seu perfil completo.' },
    {
      value: 'friends_only',
      title: 'Só amigos',
      text: 'Quem não é seu amigo vê só seu nome e foto — nada de status, "jogando" ou outros detalhes.',
    },
  ]

  return (
    <div className="space-y-5">
      <TabHeader title="Privacidade" description="Controle quem vê o quê e baixe uma cópia dos seus dados." />

      <SettingsCard title="Quem pode ver seu perfil completo">
        <div role="radiogroup" aria-label="Visibilidade do perfil" className="space-y-2">
          {options.map((o) => {
            const active = current === o.value
            return (
              <button
                key={o.value}
                role="radio"
                aria-checked={active}
                onClick={() => handleChange(o.value)}
                disabled={saving}
                className={`w-full flex items-start gap-3 text-left px-3.5 py-3 rounded-xl border transition-colors disabled:opacity-60 ${
                  active
                    ? 'border-mv-accent/60 bg-mv-accent/[0.08]'
                    : 'border-[var(--color-line)] bg-mv-canvas/50 hover:bg-white/[0.04]'
                }`}
              >
                <span
                  className={`mt-0.5 w-[18px] h-[18px] rounded-full shrink-0 border-2 flex items-center justify-center ${
                    active ? 'border-mv-accent' : 'border-[var(--color-line-strong)]'
                  }`}
                >
                  {active && <span className="w-2 h-2 rounded-full bg-mv-accent" />}
                </span>
                <span>
                  <span className="block text-[14px] text-white font-medium">{o.title}</span>
                  <span className="block text-[12.5px] text-mv-muted mt-0.5">{o.text}</span>
                </span>
              </button>
            )
          })}
        </div>
      </SettingsCard>

      <GameActivityCard />

      <AdultContentCard />

      <SettingsCard>
        <div className="flex gap-3">
          <span className="w-9 h-9 shrink-0 rounded-xl bg-white/[0.05] text-mv-muted flex items-center justify-center">
            <NavIcon tab="security" className="w-[18px] h-[18px]" />
          </span>
          <div className="space-y-2 text-[13px] text-mv-muted leading-relaxed">
            <p>
              Para gerenciar quem pode te adicionar como amigo, use a lista de bloqueados na aba{' '}
              <span className="text-white">Amigos</span> na tela inicial.
            </p>
            <p>
              Seus dados (perfil, mensagens, servidores) são protegidos por Row Level Security no banco — só você e quem
              compartilha um servidor com você consegue ver seu conteúdo.
            </p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Seus dados"
        description="Gera um arquivo com seu perfil, servidores, amizades e mensagens que você mandou."
        action={
          <button onClick={handleExport} disabled={exporting} className="btn-secondary h-9 px-4 text-sm shrink-0">
            {exporting ? 'Preparando arquivo...' : 'Baixar meus dados'}
          </button>
        }
      />
    </div>
  )
}

// "Jogando X" — ver lib/gamePrivacy.ts e useGamePresence.ts.
function GameActivityCard() {
  const showPlaying = useSyncExternalStore(subscribeShowPlaying, getShowPlaying, () => true)
  return (
    <SettingsCard title="Atividade de jogo">
      <RowList>
        <SettingRow
          title="Mostrar o jogo que estou jogando"
          description={
            window.electronAPI
              ? 'Desligado: o app para de verificar quais programas estão abertos e ninguém vê "Jogando…" no seu perfil. Vale para este computador.'
              : 'Desligado: o "Jogando…" some do seu perfil. A detecção de jogos só existe no app para computador.'
          }
          control={<Toggle label="Mostrar o jogo que estou jogando" checked={showPlaying} onChange={setShowPlaying} />}
        />
      </RowList>
    </SettingsCard>
  )
}

// Conteúdo +18 (canais com restrição de idade — migration 015): a
// preferência de mostrar direto e o estado da confirmação de idade.
function AdultContentCard() {
  const { verified, verifiedAt, showAdult, setShowAdult, revokeAdult } = useAdultContent()
  const [revoking, setRevoking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRevoke() {
    setRevoking(true)
    setError(null)
    const { error } = await revokeAdult()
    setRevoking(false)
    if (error) setError(error)
  }

  const verifiedLabel = verifiedAt
    ? `Confirmada em ${new Date(verifiedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}.`
    : verified
      ? 'Confirmada neste aparelho.'
      : 'Ainda não confirmada — o aviso aparece ao abrir um canal +18.'

  return (
    <SettingsCard
      title="Conteúdo +18"
      description="Canais marcados como +18 pelo servidor podem ter conteúdo adulto (inclusive GIFs com classificação R). Fora deles, nada muda."
    >
      <RowList>
        <SettingRow
          title="Mostrar conteúdo +18 em canais com restrição de idade"
          description="Desligado: o conteúdo fica oculto e o aviso de idade aparece toda vez que você abrir um canal +18."
          control={<Toggle label="Mostrar conteúdo +18 em canais com restrição de idade" checked={showAdult} onChange={setShowAdult} />}
        />
        <SettingRow
          title="Confirmação de idade"
          description={verifiedLabel}
          control={
            verified ? (
              <button onClick={handleRevoke} disabled={revoking} className="btn-secondary h-9 px-4 text-sm shrink-0">
                {revoking ? 'Revogando...' : 'Revogar'}
              </button>
            ) : undefined
          }
        />
      </RowList>
      {error && (
        <div className="mt-3">
          <InlineMessage tone="error">{error}</InlineMessage>
        </div>
      )}
    </SettingsCard>
  )
}

// Prévia da câmera escolhida, sem precisar entrar numa call — pra
// conferir sozinho que a imagem está chegando. A câmera só abre quando a
// pessoa clica, e é solta ao parar, trocar de câmera ou fechar a tela.
function CameraTest({ cameraId }: { cameraId: string | null }) {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
  }, [stream])
  // Solta a câmera ao desmontar e ao trocar de dispositivo.
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream])
  useEffect(() => {
    setStream(null)
  }, [cameraId])

  async function start() {
    if (opening) return
    setError(null)
    setOpening(true)
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { ...(cameraId ? { deviceId: { exact: cameraId } } : {}), width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      setStream(s)
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      setError(
        name === 'NotAllowedError'
          ? 'Permissão da câmera negada. Libere o acesso à câmera nas permissões do navegador/sistema.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'Câmera não encontrada. Confira se ela está conectada (ou se a câmera virtual está ligada).'
            : name === 'NotReadableError'
              ? 'A câmera está sendo usada por outro programa. Feche-o e tente de novo.'
              : 'Não foi possível abrir a câmera.'
      )
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="mt-3">
      <div className="relative aspect-video w-full max-w-sm rounded-xl overflow-hidden bg-mv-canvas border border-[var(--color-line)]">
        {stream ? (
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover -scale-x-100" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-mv-muted px-4 text-center">
            {error ?? 'A prévia aparece aqui. Só você vê.'}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => (stream ? setStream(null) : void start())}
        disabled={opening}
        className="btn-secondary mt-2 h-9 px-4 text-sm"
      >
        {opening ? 'Abrindo câmera...' : stream ? 'Parar teste' : 'Testar câmera'}
      </button>
    </div>
  )
}

// Medidor + controle de sensibilidade (estilo "a barra mostra sua voz e
// a alça marca o corte"). Escala em dB: esquerda = -80 dB (capta tudo),
// direita = -20 dB (só som bem alto). O valor salvo continua sendo a
// sensibilidade 0-100 (100 = mais sensível), só a tela é que mostra na
// ordem intuitiva.
function SensitivityMeter({
  manual,
  sensitivity,
  onChange,
  inputDb,
  testing,
  onStartTest,
}: {
  manual: boolean
  sensitivity: number
  onChange: (value: number) => void
  inputDb: number | null
  testing: boolean
  onStartTest: () => void
}) {
  const cutPos = MAX_MIC_SENSITIVITY - sensitivity // 0..100, mesma escala do dB abaixo
  const levelPos = inputDb === null ? 0 : Math.max(0, Math.min(100, ((inputDb + 80) / 60) * 100))
  const passing = inputDb !== null && (!manual || levelPos >= cutPos)
  return (
    <div className="pt-1">
      <div className="relative h-7 flex items-center">
        <div className="absolute inset-x-0 h-2.5 rounded-full bg-mv-canvas border border-[var(--color-line)] overflow-hidden">
          <div
            className={`h-full transition-[width] duration-75 ${passing ? 'bg-mv-speaking' : 'bg-white/25'}`}
            style={{ width: `${levelPos}%` }}
          />
          {manual && (
            <div
              className="absolute inset-y-0 left-0 bg-black/35 pointer-events-none"
              style={{ width: `${cutPos}%` }}
              aria-hidden
            />
          )}
        </div>
        {manual && (
          <input
            type="range"
            min={MIN_MIC_SENSITIVITY}
            max={MAX_MIC_SENSITIVITY}
            value={cutPos}
            aria-label="Sensibilidade do microfone (ponto de corte)"
            onChange={(e) => onChange(MAX_MIC_SENSITIVITY - Number(e.target.value))}
            className="relative w-full h-7 appearance-none bg-transparent cursor-pointer
              [&::-webkit-slider-runnable-track]:bg-transparent
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[6px] [&::-webkit-slider-thumb]:h-[26px]
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
              [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-mv-accent)_45%,transparent),0_2px_6px_rgb(0_0_0/0.5)]
              [&::-moz-range-thumb]:w-[6px] [&::-moz-range-thumb]:h-[26px] [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-track]:bg-transparent"
          />
        )}
      </div>
      {manual && (
        <div className="flex justify-between text-[11px] text-mv-muted mt-1">
          <span>Capta tudo</span>
          <span>Só voz alta</span>
        </div>
      )}
      <p className="text-[12px] text-mv-muted mt-2 leading-relaxed">
        {testing ? (
          manual ? (
            <>
              Fale normalmente: a barra fica <span className="text-mv-speaking font-medium">colorida</span> quando sua
              voz passa. Arraste a alça pra direita até o barulho de fundo (teclado, ventilador) ficar cinza.
            </>
          ) : (
            'Fale normalmente pra ver o nível da sua voz.'
          )
        ) : (
          <>
            <button type="button" onClick={onStartTest} className="text-mv-accent hover:underline font-medium">
              Testar agora
            </button>{' '}
            pra ver sua voz na barra enquanto ajusta.
          </>
        )}
      </p>
    </div>
  )
}
