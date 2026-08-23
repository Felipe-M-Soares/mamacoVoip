import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ServerBar } from '../components/layout/ServerBar'
import { ChannelSidebar } from '../components/layout/ChannelSidebar'
import { ChatArea } from '../components/layout/ChatArea'
import { MemberList } from '../components/layout/MemberList'
import { HomeSidebar } from '../components/layout/HomeSidebar'
import { useGroupConversations } from '../context/GroupConversationsContext'
import { GroupChatArea } from '../components/layout/GroupChatArea'
import { FriendsPanel } from '../components/home/FriendsPanel'
import { DMChatArea } from '../components/layout/DMChatArea'
import { UserProfileModal } from '../components/modals/UserProfileModal'
import { EditProfileModal } from '../components/modals/EditProfileModal'
import { QuickSwitcher } from '../components/modals/QuickSwitcher'
import { KeyboardShortcutsModal } from '../components/modals/KeyboardShortcutsModal'
import { ProfileSidePanel } from '../components/layout/ProfileSidePanel'
import { ServersProvider } from '../context/ServersContext'
import { ChannelsProvider } from '../context/ChannelsContext'
import { VoiceProvider } from '../context/VoiceContext'
import { useAuth } from '../hooks/useAuth'
import { useVoice } from '../hooks/useVoice'
import { useServers } from '../hooks/useServers'
import { useChannels } from '../hooks/useChannels'
import { useConversations } from '../hooks/useConversations'
import { useUnreadOverview } from '../hooks/useUnreadOverview'
import { useGamePresence } from '../hooks/useGamePresence'
import { GameDetectedToast } from '../components/ui/GameDetectedToast'
import { OverlayStateSync } from '../components/layout/OverlayStateSync'
import { AutoIdleStatus } from '../components/layout/AutoIdleStatus'
import type { Channel, Profile, Server } from '../types/database'

const VoiceChannelView = lazy(() =>
  import('../components/layout/VoiceChannelView').then((m) => ({ default: m.VoiceChannelView }))
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
}: {
  server: Server
  activeChannel: Channel | null
  pendingChannelId?: string | null
  onSelectChannel: (channel: Channel) => void
  onViewProfile: (profile: Profile) => void
  onMessageUser?: (userId: string) => void
  onToggleMembers: () => void
}) {
  const { channels, loading: loadingChannels } = useChannels()

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

  if (!activeChannel) {
    return (
      <div className="flex-1 flex items-center justify-center text-discord-text-muted">
        {loadingChannels ? '' : 'Este servidor ainda não tem canais.'}
      </div>
    )
  }

  return activeChannel.type === 'voice' ? (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <VoiceChannelView channel={activeChannel} serverId={server.id} onViewProfile={onViewProfile} onMessageUser={onMessageUser} />
    </Suspense>
  ) : (
    <ChatArea
      channel={activeChannel}
      server={server}
      onViewProfile={onViewProfile}
      onJumpToChannel={onSelectChannel}
      onToggleMembers={onToggleMembers}
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
  onSelectChannel,
  onServerGone,
  onViewProfile,
  onMessageUser,
}: {
  server: Server
  activeChannel: Channel | null
  pendingChannelId?: string | null
  unreadChannelIds: Set<string>
  drawerOpen: boolean
  onSelectChannel: (channel: Channel) => void
  onServerGone: () => void
  onViewProfile: (profile: Profile) => void
  onMessageUser?: (userId: string) => void
}) {
  const [mobileMembersOpen, setMobileMembersOpen] = useState(false)

  return (
    <ChannelsProvider serverId={server.id} key={server.id}>
      <div
        className={`fixed inset-y-0 left-[72px] z-40 flex transition-transform duration-200 lg:static lg:translate-x-0 lg:z-auto lg:left-0 ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <ChannelSidebar
          server={server}
          activeChannelId={activeChannel?.id ?? null}
          unreadChannelIds={unreadChannelIds}
          onSelectChannel={onSelectChannel}
          onServerDeleted={onServerGone}
          onServerLeft={onServerGone}
        />
      </div>

      <ActiveServerBody
        server={server}
        activeChannel={activeChannel}
        pendingChannelId={pendingChannelId}
        onSelectChannel={onSelectChannel}
        onViewProfile={onViewProfile}
        onMessageUser={onMessageUser}
        onToggleMembers={() => setMobileMembersOpen((v) => !v)}
      />

      <MemberList
        serverId={server.id}
        onViewProfile={onViewProfile}
        onMessageUser={onMessageUser}
        mobileOpen={mobileMembersOpen}
        onCloseMobile={() => setMobileMembersOpen(false)}
      />
    </ChannelsProvider>
  )
}

function MainLayoutInner() {
  useGamePresence()
  const { profile: ownProfile } = useAuth()
  const voice = useVoice()
  const { servers, loading: loadingServers } = useServers()
  const location = useLocation()
  const navigate = useNavigate()
  const [activeServer, setActiveServer] = useState<Server | null>(null)
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
  const [showEditProfile, setShowEditProfile] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowQuickSwitcher(true)
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

  async function handleMessageUser(userId: string) {
    const { conversation, error } = await openConversationWith(userId)
    if (!error && conversation) handleOpenConversation(conversation.id)
  }
  const { groups } = useGroupConversations()
  const unread = useUnreadOverview()

  useEffect(() => {
    if (activeChannel && activeChannel.type === 'text') unread.markChannelRead(activeChannel.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel?.id])

  useEffect(() => {
    if (homeView === 'conversation' && activeConversationId) unread.markConversationRead(activeConversationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeView, activeConversationId])

  function handleServerGone() {
    setActiveServer(null)
    setActiveChannel(null)
  }

  function handleSelectServer(server: Server) {
    setActiveServer(server)
    setActiveChannel(null)
    setMobileSidebarOpen(false)
  }

  function handleSelectChannel(channel: Channel) {
    setActiveChannel(channel)
    setMobileSidebarOpen(false)
  }

  function handleSelectHome() {
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

  return (
    <div className="h-full w-full flex overflow-hidden bg-discord-dark relative">
      {/* Botão de menu — só aparece em telas pequenas */}
      <button
        onClick={() => setMobileSidebarOpen(true)}
        className="lg:hidden fixed top-2 left-2 z-30 w-9 h-9 rounded-md bg-discord-darker/90 backdrop-blur text-white flex items-center justify-center shadow-lg"
        aria-label="Abrir menu"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
          <path d="M4 6h16a1 1 0 1 0 0-2H4a1 1 0 1 0 0 2zm16 5H4a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2zm0 7H4a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2z" />
        </svg>
      </button>

      {/* Overlay escuro atrás do drawer, só em mobile */}
      {mobileSidebarOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/60 z-30" onClick={() => setMobileSidebarOpen(false)} />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-40 flex transition-transform duration-200 lg:static lg:translate-x-0 lg:z-auto ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <ServerBar
          activeServerId={activeServer?.id ?? null}
          unreadServerIds={unread.unreadServerIds}
          onSelectServer={handleSelectServer}
          onSelectHome={handleSelectHome}
        />

        {!activeServer && !loadingServers && (
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

      {activeServer ? (
        <ActiveServerContent
          server={activeServer}
          activeChannel={activeChannel}
          pendingChannelId={pendingChannelId}
          unreadChannelIds={unread.unreadChannelIds}
          drawerOpen={mobileSidebarOpen}
          onSelectChannel={handleSelectChannel}
          onServerGone={handleServerGone}
          onViewProfile={setViewingProfile}
          onMessageUser={handleMessageUser}
        />
      ) : loadingServers ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
        </div>
      ) : homeView === 'conversation' && activeConversation ? (
        <DMChatArea conversationId={activeConversation.id} otherProfile={activeConversation.otherProfile} />
      ) : homeView === 'group' && activeGroup ? (
        <GroupChatArea group={activeGroup} onLeave={handleSelectHome} />
      ) : (
        <FriendsPanel onOpenConversation={handleOpenConversation} />
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

      {viewingProfile && (
        <UserProfileModal
          targetProfile={viewingProfile}
          onClose={() => setViewingProfile(null)}
          onOpenConversation={handleOpenConversation}
        />
      )}
      {showEditProfile && <EditProfileModal onClose={() => setShowEditProfile(false)} />}

      <GameDetectedToast />
      <OverlayStateSync />
      <AutoIdleStatus />

      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {showQuickSwitcher && (
        <QuickSwitcher
          servers={servers}
          conversations={conversations.map((c) => ({ id: c.id, otherProfile: c.otherProfile }))}
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
