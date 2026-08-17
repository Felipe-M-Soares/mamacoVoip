import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ServerBar } from '../components/layout/ServerBar'
import { ChannelSidebar } from '../components/layout/ChannelSidebar'
import { ChatArea } from '../components/layout/ChatArea'
import { MemberList } from '../components/layout/MemberList'
import { HomeSidebar } from '../components/layout/HomeSidebar'
import { FriendsPanel } from '../components/home/FriendsPanel'
import { DMChatArea } from '../components/layout/DMChatArea'
import { UserProfileModal } from '../components/modals/UserProfileModal'
import { ServersProvider } from '../context/ServersContext'
import { ChannelsProvider } from '../context/ChannelsContext'
import { VoiceProvider } from '../context/VoiceContext'
import { useServers } from '../hooks/useServers'
import { useChannels } from '../hooks/useChannels'
import { useConversations } from '../hooks/useConversations'
import { useUnreadOverview } from '../hooks/useUnreadOverview'
import { useGamePresence } from '../hooks/useGamePresence'
import { GameDetectedToast } from '../components/ui/GameDetectedToast'
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
  onToggleMembers,
}: {
  server: Server
  activeChannel: Channel | null
  pendingChannelId?: string | null
  onSelectChannel: (channel: Channel) => void
  onViewProfile: (profile: Profile) => void
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
      <VoiceChannelView channel={activeChannel} serverId={server.id} />
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
}: {
  server: Server
  activeChannel: Channel | null
  pendingChannelId?: string | null
  unreadChannelIds: Set<string>
  drawerOpen: boolean
  onSelectChannel: (channel: Channel) => void
  onServerGone: () => void
  onViewProfile: (profile: Profile) => void
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
        onToggleMembers={() => setMobileMembersOpen((v) => !v)}
      />

      <MemberList
        serverId={server.id}
        onViewProfile={onViewProfile}
        mobileOpen={mobileMembersOpen}
        onCloseMobile={() => setMobileMembersOpen(false)}
      />
    </ChannelsProvider>
  )
}

function MainLayoutInner() {
  useGamePresence()
  const { servers, loading: loadingServers } = useServers()
  const location = useLocation()
  const navigate = useNavigate()
  const [activeServer, setActiveServer] = useState<Server | null>(null)
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null)
  const [viewingProfile, setViewingProfile] = useState<Profile | null>(null)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // Quem vem de um link de convite (/convite/CODIGO) chega aqui com o
  // servidor (e opcionalmente o canal) que acabou de entrar guardado no
  // state da navegação — a gente seleciona automaticamente assim que a
  // lista de servidores carregar esse novo servidor.
  useEffect(() => {
    const state = location.state as { joinedServerId?: string; joinedChannelId?: string | null } | null
    if (!state?.joinedServerId || loadingServers) return
    const server = servers.find((s) => s.id === state.joinedServerId)
    if (!server) return

    setActiveServer(server)
    setPendingChannelId(state.joinedChannelId ?? null)
    navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, servers, loadingServers])

  // estado da "home" (quando nenhum servidor está selecionado)
  const [homeView, setHomeView] = useState<'friends' | 'conversation'>('friends')
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const { conversations } = useConversations()
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

  const activeConversation = conversations.find((c) => c.id === activeConversationId)

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-discord-dark relative">
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
            unreadConversationIds={unread.unreadConversationIds}
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
        />
      ) : loadingServers ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
        </div>
      ) : homeView === 'conversation' && activeConversation ? (
        <DMChatArea conversationId={activeConversation.id} otherProfile={activeConversation.otherProfile} />
      ) : (
        <FriendsPanel onOpenConversation={handleOpenConversation} />
      )}

      {viewingProfile && (
        <UserProfileModal
          targetProfile={viewingProfile}
          onClose={() => setViewingProfile(null)}
          onOpenConversation={handleOpenConversation}
        />
      )}

      <GameDetectedToast />
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
