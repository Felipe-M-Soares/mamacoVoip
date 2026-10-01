import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { lazyComponent, preloadLazyChunks } from '../components/modals/lazyModal'
import { preloadNoiseSuppression } from '../lib/noiseSuppression'
import { useLocation, useNavigate } from 'react-router-dom'
import { ServerBar } from '../components/layout/ServerBar'
import { ChannelSidebar } from '../components/layout/ChannelSidebar'
import { ChatArea } from '../components/layout/ChatArea'
import { MemberList } from '../components/layout/MemberList'
import { HomeSidebar } from '../components/layout/HomeSidebar'
import { UserPanel } from '../components/layout/UserPanel'
import { useGroupConversations } from '../context/GroupConversationsContext'
import { GroupChatArea } from '../components/layout/GroupChatArea'
import { FriendsPanel } from '../components/home/FriendsPanel'
import { DMChatArea } from '../components/layout/DMChatArea'
import { OnboardingModal, useOnboarding } from '../components/modals/OnboardingModal'
import { DMCallOverlay } from '../components/layout/DMCallOverlay'
import { VoiceCallAudio } from '../components/layout/VoiceCallAudio'
import { ProfileSidePanel } from '../components/layout/ProfileSidePanel'
import { ServersProvider } from '../context/ServersContext'
import { ChannelsProvider } from '../context/ChannelsContext'
import { VoiceProvider } from '../context/VoiceContext'
import { useAuth } from '../hooks/useAuth'
import { useVoiceCore } from '../hooks/useVoice'
import { useServers } from '../hooks/useServers'
import { useChannels } from '../hooks/useChannels'
import { useConversations } from '../hooks/useConversations'
import { useUnreadOverview } from '../hooks/useUnreadOverview'
import { useGamePresence } from '../hooks/useGamePresence'
import { GameDetectedToast } from '../components/ui/GameDetectedToast'
import { VoiceMovedToast } from '../components/ui/VoiceMovedToast'
import { OverlayStateSync } from '../components/layout/OverlayStateSync'
import { AutoIdleStatus } from '../components/layout/AutoIdleStatus'
import type { Channel, Profile, Server } from '../types/database'
import { setWindowPlace } from '../lib/windowTitle'

const VoiceChannelView = lazyComponent(() =>
  import('../components/layout/VoiceChannelView').then((m) => m.VoiceChannelView)
)
// Modais que só abrem sob demanda — fora do pacote inicial.
const UserProfileModal = lazyComponent(() => import('../components/modals/UserProfileModal').then((m) => m.UserProfileModal))
const EditProfileModal = lazyComponent(() => import('../components/modals/EditProfileModal').then((m) => m.EditProfileModal))
const QuickSwitcher = lazyComponent(() => import('../components/modals/QuickSwitcher').then((m) => m.QuickSwitcher))
const KeyboardShortcutsModal = lazyComponent(() =>
  import('../components/modals/KeyboardShortcutsModal').then((m) => m.KeyboardShortcutsModal)
)

// Fica DENTRO do ChannelsProvider, então tem acesso à lista de canais
// já carregada — é aqui que a seleção automática do primeiro canal de
// texto acontece quando você entra num servidor ou o canal atual deixa
// de existir (foi excluído por outra pessoa, por exemplo).
function ActiveServerBody({
  server,
  activeChannel,
  pendingChannelId,
  onSelectChannel,
  onViewProfile,
  onMessageUser,
  onToggleMembers,
  membersOpen,
}: {
  server: Server
  activeChannel: Channel | null
  pendingChannelId?: string | null
  onSelectChannel: (channel: Channel, serverId?: string) => void
  onViewProfile: (profile: Profile) => void
  onMessageUser?: (userId: string) => void
  onToggleMembers: () => void
  membersOpen?: boolean
}) {
  const { channels, loading: loadingChannels } = useChannels()
  // O canal ativo guardado lá em cima é uma CÓPIA de quando foi clicado —
  // renomear, mudar o tópico, ligar modo lento/spoiler etc. não aparecia no
  // chat até trocar de canal e voltar. Usa sempre a versão atual da lista.
  const liveChannel = activeChannel ? channels.find((c) => c.id === activeChannel.id) ?? activeChannel : null

  useEffect(() => {
    if (loadingChannels) return
    const stillValid = activeChannel && channels.some((c) => c.id === activeChannel.id)
    if (stillValid) return

    const pending = pendingChannelId ? channels.find((c) => c.id === pendingChannelId) : undefined
    const firstText = [...channels].sort((a, b) => a.position - b.position).find((c) => c.type === 'text')
    const fallback = pending ?? firstText ?? channels[0]
    if (fallback) onSelectChannel(fallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, loadingChannels, activeChannel?.id])

  if (!liveChannel) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 bg-mv-main border-t border-l border-[var(--color-line)]">
        {loadingChannels ? (
          <div role="status" aria-label="Carregando canal" className="w-7 h-7 border-2 border-mv-accent border-t-transparent rounded-full animate-spin" />
        ) : (
          <div className="flex flex-col items-center animate-fade-in">
            <span className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-[var(--color-line)] flex items-center justify-center mb-4" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-mv-muted">
                <path d="M9.3 3.1a1 1 0 0 1 1.94.48L10.6 6.5h3.24l.68-2.92a1 1 0 1 1 1.94.48L15.86 6.5h2.14a1 1 0 1 1 0 2h-2.6l-.7 3h2.3a1 1 0 1 1 0 2h-2.77l-.72 3.1a1 1 0 1 1-1.94-.48l.6-2.62H9.13l-.72 3.1a1 1 0 1 1-1.94-.48l.6-2.62H4.9a1 1 0 1 1 0-2h2.64l.7-3H6a1 1 0 1 1 0-2h2.6l.7-3zm.84 5.4-.7 3h3.24l.7-3z" />
              </svg>
            </span>
            <p className="font-display font-semibold text-white">Nenhum canal por aqui</p>
            <p className="text-sm text-mv-muted mt-1 max-w-xs">Este servidor ainda não tem canais. Quem administra pode criar um pela lista ao lado.</p>
          </div>
        )}
      </div>
    )
  }

  return liveChannel.type === 'voice' ? (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center bg-mv-main border-t border-l border-[var(--color-line)]">
          <div role="status" aria-label="Carregando" className="w-7 h-7 border-2 border-mv-accent border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <VoiceChannelView channel={liveChannel} serverId={server.id} onViewProfile={onViewProfile} onMessageUser={onMessageUser} />
    </Suspense>
  ) : (
    <ChatArea
      channel={liveChannel}
      server={server}
      onViewProfile={onViewProfile}
      onJumpToChannel={onSelectChannel}
      onToggleMembers={onToggleMembers}
      membersOpen={membersOpen}
    />
  )
}

// Tudo que depende da lista de canais de UM servidor específico fica
// dentro do ChannelsProvider. key={server.id} garante que trocar de
// servidor reinicia o estado do zero, sem vazar canal de um servidor
// pro outro.
function ActiveServerContent({
  server,
  activeChannel,
  pendingChannelId,
  unreadChannelIds,
  drawerOpen,
  isElectronApp,
  unreadServerIds,
  onSelectServer,
  onSelectHome,
  onSelectChannel,
  onServerGone,
  onViewProfile,
  onMessageUser,
  dmConversation,
}: {
  server: Server
  activeChannel: Channel | null
  pendingChannelId?: string | null
  /** DM aberta por cima do servidor (a lateral do servidor continua) */
  dmConversation?: { id: string; otherProfile: Profile } | null
  unreadChannelIds: Set<string>
  drawerOpen: boolean
  isElectronApp: boolean
  unreadServerIds: Set<string>
  onSelectServer: (server: Server) => void
  onSelectHome: () => void
  onSelectChannel: (channel: Channel, serverId?: string) => void
  onServerGone: () => void
  onViewProfile: (profile: Profile) => void
  onMessageUser?: (userId: string) => void
}) {
  const [mobileMembersOpen, setMobileMembersOpen] = useState(false)
  // No computador a lista de membros começa escondida; o botão "Membros"
  // do topo do chat mostra/esconde (lembra a escolha).
  const [desktopMembersOpen, setDesktopMembersOpen] = useState(() => {
    try {
      return localStorage.getItem('mv-members-open') === '1'
    } catch {
      return false
    }
  })
  function toggleMembers() {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setDesktopMembersOpen((v) => {
        try {
          localStorage.setItem('mv-members-open', v ? '0' : '1')
        } catch {
          // sem armazenamento — só não lembra
        }
        return !v
      })
    } else setMobileMembersOpen((v) => !v)
  }

  return (
    <ChannelsProvider serverId={server.id} key={server.id}>
      {/* Coluna esquerda inteira (barra de servidores + lista de canais)
          empilhada em cima do rodapé compartilhado (UserPanel) — igual o
          apps de chat populares: aquele rodapé (ping, "jogando agora", "voz
          conectada", microfone/fone/config) cobre a LARGURA TOTAL dessa
          coluna, por baixo da barra de servidores E da lista de canais
          juntas, não só embaixo da lista de canais sozinha. Por isso o
          ServerBar mora AQUI dentro (não mais lá fora, ao lado) — só
          assim o rodapé consegue ficar largo o bastante pra cobrir os
          dois ao mesmo tempo. */}
      <div
        className={
          isElectronApp
            ? 'static flex flex-col'
            : `fixed inset-y-0 left-0 z-40 flex flex-col transition-transform duration-200 lg:static lg:translate-none lg:z-auto ${
                drawerOpen ? 'translate-none' : '-translate-x-full'
              }`
        }
      >
        <div className="flex flex-1 min-h-0">
          <ServerBar
            activeServerId={server.id}
            unreadServerIds={unreadServerIds}
            onSelectServer={onSelectServer}
            onSelectHome={onSelectHome}
          />
          <ChannelSidebar
            server={server}
            activeChannelId={dmConversation ? null : (activeChannel?.id ?? null)}
            unreadChannelIds={unreadChannelIds}
            onSelectChannel={onSelectChannel}
            onServerDeleted={onServerGone}
            onServerLeft={onServerGone}
          />
        </div>
        <UserPanel />
      </div>

      {dmConversation ? (
        <DMChatArea key={dmConversation.id} conversationId={dmConversation.id} otherProfile={dmConversation.otherProfile} />
      ) : (
      <ActiveServerBody
        server={server}
        activeChannel={activeChannel}
        pendingChannelId={pendingChannelId}
        onSelectChannel={onSelectChannel}
        onViewProfile={onViewProfile}
        onMessageUser={onMessageUser}
        onToggleMembers={toggleMembers}
        membersOpen={desktopMembersOpen}
      />
      )}

      <MemberList
        serverId={server.id}
        onViewProfile={onViewProfile}
        onMessageUser={onMessageUser}
        mobileOpen={mobileMembersOpen}
        desktopOpen={desktopMembersOpen && !dmConversation}
        onCloseMobile={() => setMobileMembersOpen(false)}
      />
    </ChannelsProvider>
  )
}

function MainLayoutInner() {
  useGamePresence()
  const { profile: ownProfile } = useAuth()
  const voice = useVoiceCore()
  const { servers, loading: loadingServers } = useServers()
  const location = useLocation()
  const navigate = useNavigate()
  // Guarda só o ID e deriva o servidor da lista atual: antes era uma cópia
  // do objeto, então renomear/trocar ícone do servidor não aparecia até
  // selecionar de novo, e ser removido/expulso de um servidor deixava a
  // tela dele aberta com tudo falhando.
  const [activeServerId, setActiveServerId] = useState<string | null>(null)
  const activeServer = useMemo(() => servers.find((s) => s.id === activeServerId) ?? null, [servers, activeServerId])
  const setActiveServer = useCallback((server: Server | null) => setActiveServerId(server?.id ?? null), [])
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null)
  // Marca "assim que o canal-alvo do convite for selecionado, entra na
  // call sozinho" — só quando o convite trouxe um canal (ver
  // InviteMessageCard.tsx/InviteRedirect.tsx). Ref (não state) porque é
  // só um flag de "ainda não consumido", não precisa re-renderizar nada
  // sozinho, e não pode disparar de novo depois de usado uma vez (por
  // isso não reaproveita pendingChannelId, que fica setado no state
  // "pra sempre" depois de um convite).
  const pendingAutoJoinVoiceRef = useRef(false)
  const [viewingProfile, setViewingProfile] = useState<Profile | null>(null)
  const onboarding = useOnboarding(ownProfile?.id)
  const [showEditProfile, setShowEditProfile] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  // O drawer "mobile" (ServerBar virando um overlay fixed por cima de
  // tudo, escondido/mostrado com um botão de hambúrguer) usa o
  // breakpoint `lg:` do Tailwind (1024px) pra saber quando NÃO é mais
  // "mobile". Mas a janela do app desktop pode ficar bem mais estreita
  // que isso (minWidth: 900 no electron/main.cjs) — nesse meio-termo
  // (900px–1023px), o Tailwind ainda achava que era "mobile" e deixava
  // o ServerBar com `position: fixed` flutuando por cima (z-40) do
  // resto do layout, inclusive cobrindo a PARTE DE BAIXO da barra
  // lateral de canais (ping, card de jogo, "Voz conectada", UserPanel)
  // que fica logo depois dele no fluxo normal. Dentro do Electron a
  // janela nunca é "mobile" de verdade (sempre tem pelo menos 900px de
  // largura) — então aqui o app desktop sempre usa o layout estático
  // normal, e o comportamento de gaveta/hambúrguer fica só pro site.
  const isElectronApp = Boolean(window.electronAPI?.isElectron)
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)

  // Baixa em segundo plano (em idle, um por vez) o código de todos os
  // modais/painéis sob demanda — sem isso o PRIMEIRO clique em
  // "Configurações", "Pesquisar", "Criar servidor" etc. esperava o arquivo
  // do modal ser baixado/interpretado antes de qualquer coisa aparecer.
  useEffect(() => {
    const cancel = preloadLazyChunks()
    // Também adianta o WASM do redutor de ruído usado ao entrar em call.
    const t = window.setTimeout(preloadNoiseSuppression, 3000)
    return () => {
      cancel()
      clearTimeout(t)
    }
  }, [])

  // Servidor aberto sumiu da lista (excluído, expulso, saiu por outro
  // dispositivo): volta pra tela inicial em vez de ficar numa tela quebrada.
  useEffect(() => {
    if (!activeServerId || loadingServers) return
    if (!servers.some((s) => s.id === activeServerId)) {
      setActiveServerId(null)
      setActiveChannel(null)
    }
  }, [activeServerId, servers, loadingServers])

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        // Ctrl+K de novo fecha (antes só abria)
        setShowQuickSwitcher((v) => !v)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        setShowShortcuts((v) => !v)
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  // Quem vem de um link de convite (/convite/CODIGO) chega aqui com o
  // servidor (e opcionalmente o canal) que acabou de entrar guardado no
  // state da navegação — a gente seleciona automaticamente assim que a
  // lista de servidores carregar esse novo servidor.
  useEffect(() => {
    const state = location.state as
      | { joinedServerId?: string; joinedChannelId?: string | null; autoJoinVoice?: boolean }
      | null
    if (!state?.joinedServerId || loadingServers) return
    const server = servers.find((s) => s.id === state.joinedServerId)
    if (!server) return

    setActiveServer(server)
    setPendingChannelId(state.joinedChannelId ?? null)
    pendingAutoJoinVoiceRef.current = Boolean(state.autoJoinVoice && state.joinedChannelId)
    navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, servers, loadingServers])

  // Assim que o canal-alvo do convite (pendingChannelId) vira de fato o
  // canal ativo — o que acontece em ActiveServerBody, mais abaixo, ao
  // carregar a lista de canais do servidor — entra na call sozinho, SE
  // for mesmo um canal de voz (convite de canal de TEXTO só navega até
  // lá, nunca tenta conectar nada — daí o `activeChannel.type ===
  // 'voice'`). Dispara só uma vez por convite: a ref vira `false` assim
  // que usada, então trocar de canal manualmente depois não entra em
  // call de novo sozinho.
  useEffect(() => {
    if (!pendingAutoJoinVoiceRef.current) return
    if (!activeChannel || !activeServer) return
    if (activeChannel.id !== pendingChannelId || activeChannel.type !== 'voice') return
    pendingAutoJoinVoiceRef.current = false
    voice.join(activeChannel.id, activeServer.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel?.id])

  // estado da "home" (quando nenhum servidor está selecionado)
  const [homeView, setHomeView] = useState<'friends' | 'conversation' | 'group'>('friends')
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const { conversations, openConversationWith } = useConversations()

  // Dentro de um servidor, a conversa privada abre no lugar do chat (a
  // lateral do servidor continua); clicar num canal volta pro canal.
  const [serverDmId, setServerDmId] = useState<string | null>(null)
  async function handleMessageUser(userId: string) {
    const { conversation, error } = await openConversationWith(userId)
    // antes um erro aqui era ignorado — o clique em "Mensagem" não fazia nada
    if (error) alert(error)
    else if (conversation) {
      if (activeServer) {
        setServerDmId(conversation.id)
        setMobileSidebarOpen(false)
      } else handleOpenConversation(conversation.id)
    }
  }
  const { groups } = useGroupConversations()
  const unread = useUnreadOverview()

  // Marca como lido ao abrir E sempre que o canal/conversa aberto aparecer
  // como "não lido" de novo (mensagem nova chegando enquanto você está
  // olhando pra ele) — antes a bolinha de não lido aparecia no próprio
  // canal que estava aberto na tela.
  const activeTextChannelId = activeServer && activeChannel?.type === 'text' ? activeChannel.id : null
  const activeTextChannelUnread = activeTextChannelId ? unread.unreadChannelIds.has(activeTextChannelId) : false
  // Último canal/conversa marcado: ao abrir um não lido, o efeito rodava
  // de novo quando o "não lido" virava false (2 gravações por abertura).
  // Agora grava ao ABRIR, e depois só quando voltar a ficar não lido.
  const lastMarkedChannelRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeTextChannelId) {
      lastMarkedChannelRef.current = null
      return
    }
    if (lastMarkedChannelRef.current === activeTextChannelId && !activeTextChannelUnread) return
    lastMarkedChannelRef.current = activeTextChannelId
    void unread.markChannelRead(activeTextChannelId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTextChannelId, activeTextChannelUnread])

  const openConversationId = !activeServer && homeView === 'conversation' ? activeConversationId : null
  const openConversationUnread = openConversationId ? unread.unreadConversationIds.has(openConversationId) : false
  const lastMarkedConversationRef = useRef<string | null>(null)
  useEffect(() => {
    if (!openConversationId) {
      lastMarkedConversationRef.current = null
      return
    }
    if (lastMarkedConversationRef.current === openConversationId && !openConversationUnread) return
    lastMarkedConversationRef.current = openConversationId
    void unread.markConversationRead(openConversationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openConversationId, openConversationUnread])

  function handleServerGone() {
    setActiveServer(null)
    setActiveChannel(null)
  }

  function handleSelectServer(server: Server) {
    setServerDmId(null)
    setActiveServer(server)
    setActiveChannel(null)
    setMobileSidebarOpen(false)
  }

  function handleSelectChannel(channel: Channel, targetServerId?: string) {
    // Chamado com um targetServerId quando o canal vem de um resultado
    // de busca "em todos os servidores" (ver SearchModal.tsx) que
    // aponta pra um servidor diferente do atualmente aberto — troca de
    // servidor primeiro (o que remonta o ChannelsProvider pra ele, via
    // key={server.id} em ActiveServerContent) e deixa o canal-alvo
    // marcado como pendente, do mesmo jeito que o fluxo de convite
    // (pendingChannelId) já fazia.
    if (targetServerId && targetServerId !== activeServer?.id) {
      const target = servers.find((s) => s.id === targetServerId)
      if (target) {
        setActiveServer(target)
        setPendingChannelId(channel.id)
        setMobileSidebarOpen(false)
        return
      }
    }
    setServerDmId(null)
    setActiveChannel(channel)
    setMobileSidebarOpen(false)
  }

  // Nome de onde você está, no centro da barra de título (e no título da janela).
  const placeConversation = activeServer ? null : conversations.find((c) => c.id === activeConversationId)
  const placeGroupName = activeServer || homeView !== 'group' ? null : (groups.find((g) => g.id === activeGroupId)?.name ?? null)
  useEffect(() => {
    if (activeServer) setWindowPlace({ label: activeServer.name, iconUrl: activeServer.icon_url })
    else if (homeView === 'conversation' && placeConversation)
      setWindowPlace({
        label: placeConversation.otherProfile.display_name || placeConversation.otherProfile.username,
        iconUrl: placeConversation.otherProfile.avatar_url,
      })
    else if (homeView === 'group' && placeGroupName) setWindowPlace({ label: placeGroupName })
    else setWindowPlace({ label: 'Início' })
  }, [activeServer, homeView, placeConversation, placeGroupName])
  useEffect(() => () => setWindowPlace(null), [])

  // Cartão de usuário da sala de voz (VoiceMemberCard) pede DM / perfil.
  useEffect(() => {
    function onMessage(e: Event) {
      const userId = (e as CustomEvent<{ userId: string }>).detail?.userId
      if (userId) void handleMessageUser(userId)
    }
    function onProfile(e: Event) {
      const profile = (e as CustomEvent<{ profile: Profile }>).detail?.profile
      if (profile) setViewingProfile(profile)
    }
    window.addEventListener('mv:message-user', onMessage)
    window.addEventListener('mv:view-profile', onProfile)
    return () => {
      window.removeEventListener('mv:message-user', onMessage)
      window.removeEventListener('mv:view-profile', onProfile)
    }
  })

  // "Voz conectada" (UserPanel) clicado: volta pra tela da sala de voz,
  // mesmo navegando por um canal de texto, outro servidor ou DMs.
  useEffect(() => {
    function onOpenVoiceRoom(e: Event) {
      const detail = (e as CustomEvent<{ serverId: string; channelId: string }>).detail
      if (!detail?.serverId || !detail.channelId) return
      const target = servers.find((s) => s.id === detail.serverId)
      if (!target) return
      if (activeServer?.id !== target.id) setActiveServer(target)
      setServerDmId(null)
      setActiveChannel(null)
      setPendingChannelId(detail.channelId)
      setMobileSidebarOpen(false)
    }
    window.addEventListener('mv:open-voice-room', onOpenVoiceRoom)
    return () => window.removeEventListener('mv:open-voice-room', onOpenVoiceRoom)
  }, [servers, activeServer?.id])

  function handleSelectHome() {
    setServerDmId(null)
    setActiveServer(null)
    setActiveChannel(null)
    setHomeView('friends')
    setMobileSidebarOpen(false)
  }

  function handleOpenConversation(conversationId: string) {
    setActiveServer(null)
    setHomeView('conversation')
    setActiveConversationId(conversationId)
    setMobileSidebarOpen(false)
  }

  function handleOpenGroup(groupId: string) {
    setActiveServer(null)
    setHomeView('group')
    setActiveGroupId(groupId)
    setMobileSidebarOpen(false)
  }

  const activeConversation = conversations.find((c) => c.id === activeConversationId)
  const activeGroup = groups.find((g) => g.id === activeGroupId)

  // Antes esses dois eram recriados a cada render do layout (qualquer
  // tecla, qualquer mudança de estado), refazendo o merge de todos os
  // perfis e forçando re-render do overlay de chamada.
  const callProfilesById = useMemo(
    () => ({
      ...Object.fromEntries(conversations.map((c) => [c.otherProfile.id, c.otherProfile])),
      ...Object.fromEntries(groups.flatMap((g) => g.members.map((m) => [m.id, m]))),
    }),
    [conversations, groups]
  )
  const switcherConversations = useMemo(
    () => conversations.map((c) => ({ id: c.id, otherProfile: c.otherProfile })),
    [conversations]
  )

  return (
    <div className="h-full w-full flex overflow-hidden bg-mv-canvas relative">
      {/* Botão de menu — só aparece em telas pequenas (nunca no app
          desktop, que não tem esse "modo mobile" — ver isElectronApp). */}
      {!isElectronApp && (
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="lg:hidden fixed top-2.5 left-2.5 z-30 w-9 h-9 rounded-[10px] glass text-mv-text hover:text-white flex items-center justify-center shadow-[0_8px_20px_-8px_rgb(0_0_0/0.7)] active:scale-95 transition"
          aria-label="Abrir menu"
          title="Abrir menu"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M4 6h16a1 1 0 1 0 0-2H4a1 1 0 1 0 0 2zm16 5H4a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2zm0 7H4a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2z" />
          </svg>
        </button>
      )}

      {/* Overlay escuro atrás do drawer, só em mobile */}
      {!isElectronApp && mobileSidebarOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/70 z-30 animate-fade-in" onClick={() => setMobileSidebarOpen(false)} />
      )}

      {activeServer ? (
        <ActiveServerContent
          server={activeServer}
          activeChannel={activeChannel}
          pendingChannelId={pendingChannelId}
          unreadChannelIds={unread.unreadChannelIds}
          drawerOpen={mobileSidebarOpen}
          isElectronApp={isElectronApp}
          unreadServerIds={unread.unreadServerIds}
          onSelectServer={handleSelectServer}
          onSelectHome={handleSelectHome}
          onSelectChannel={handleSelectChannel}
          onServerGone={handleServerGone}
          onViewProfile={setViewingProfile}
          onMessageUser={handleMessageUser}
          dmConversation={serverDmId ? (conversations.find((c) => c.id === serverDmId) ?? null) : null}
        />
      ) : (
        <>
          {/* Mesma ideia da coluna esquerda de ActiveServerContent: barra
              de servidores + lista de conversas empilhada em cima do
              rodapé (UserPanel) compartilhado, cobrindo a largura total
              dos dois juntos — não só embaixo da lista de conversas. */}
          <div
            className={
              isElectronApp
                ? 'static flex flex-col'
                : `fixed inset-y-0 left-0 z-40 flex flex-col transition-transform duration-200 lg:static lg:translate-none lg:z-auto ${
                    mobileSidebarOpen ? 'translate-none' : '-translate-x-full'
                  }`
            }
          >
            <div className="flex flex-1 min-h-0">
              <ServerBar
                activeServerId={null}
                unreadServerIds={unread.unreadServerIds}
                onSelectServer={handleSelectServer}
                onSelectHome={handleSelectHome}
              />

              {!loadingServers && (
                <HomeSidebar
                  view={homeView}
                  activeConversationId={activeConversationId}
                  activeGroupId={activeGroupId}
                  unreadConversationIds={unread.unreadConversationIds}
                  onSelectGroup={handleOpenGroup}
                  onSelectFriends={() => {
                    setHomeView('friends')
                    setMobileSidebarOpen(false)
                  }}
                  onSelectConversation={(id) => {
                    setHomeView('conversation')
                    setActiveConversationId(id)
                    setMobileSidebarOpen(false)
                  }}
                />
              )}
            </div>
            <UserPanel />
          </div>

          {loadingServers ? (
            <div className="flex-1 flex items-center justify-center bg-mv-main border-t border-l border-[var(--color-line)] rounded-tl-[var(--radius-panel)]">
              <div role="status" aria-label="Carregando" className="w-7 h-7 border-2 border-mv-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : homeView === 'conversation' && activeConversation ? (
            // key: cada conversa/grupo começa com estado limpo — antes o
            // "respondendo a…" de uma conversa passava pra outra.
            <DMChatArea key={activeConversation.id} conversationId={activeConversation.id} otherProfile={activeConversation.otherProfile} />
          ) : homeView === 'group' && activeGroup ? (
            <GroupChatArea key={activeGroup.id} group={activeGroup} onLeave={handleSelectHome} />
          ) : (
            <FriendsPanel onOpenConversation={handleOpenConversation} />
          )}
        </>
      )}

      {/* Card de perfil fixo do lado direito da tela inicial — mostra o
          perfil de quem faz sentido pra visão atual: a própria pessoa
          nas telas de Amigos/Grupo, ou quem está do outro lado numa
          conversa direta. Só aparece fora de um servidor (lá quem cumpre
          esse papel já é o MemberList). */}
      {!activeServer && !loadingServers && ownProfile && (
        <ProfileSidePanel
          profile={homeView === 'conversation' && activeConversation ? activeConversation.otherProfile : ownProfile}
          isSelf={!(homeView === 'conversation' && activeConversation)}
          onViewFullProfile={() => {
            if (homeView === 'conversation' && activeConversation) setViewingProfile(activeConversation.otherProfile)
            else setShowEditProfile(true)
          }}
        />
      )}

      <Suspense fallback={null}>
      {viewingProfile && (
        <UserProfileModal
          targetProfile={viewingProfile}
          onClose={() => setViewingProfile(null)}
          onOpenConversation={handleOpenConversation}
          serverId={activeServer?.id}
        />
      )}
      {showEditProfile && <EditProfileModal onClose={() => setShowEditProfile(false)} />}
      </Suspense>
      {onboarding.show && <OnboardingModal onDismiss={onboarding.dismiss} />}
      <DMCallOverlay profilesById={callProfilesById} />

      <VoiceCallAudio />
      <GameDetectedToast />
      <VoiceMovedToast />
      <OverlayStateSync />
      <AutoIdleStatus />

      <Suspense fallback={null}>
      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {showQuickSwitcher && (
        <QuickSwitcher
          servers={servers}
          conversations={switcherConversations}
          activeServerId={activeServer?.id ?? null}
          onSelectServer={(server) => {
            handleSelectServer(server)
            setShowQuickSwitcher(false)
          }}
          onSelectChannel={(channel) => {
            handleSelectChannel(channel)
            setShowQuickSwitcher(false)
          }}
          onSelectConversation={(id) => {
            handleSelectHome()
            handleOpenConversation(id)
            setShowQuickSwitcher(false)
          }}
          onClose={() => setShowQuickSwitcher(false)}
        />
      )}
      </Suspense>
    </div>
  )
}

export function MainLayout() {
  return (
    <VoiceProvider>
      <ServersProvider>
        <MainLayoutInner />
      </ServersProvider>
    </VoiceProvider>
  )
}
