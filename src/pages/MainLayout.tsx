import { lazy, Suspense, useEffect, useState } from 'react'
import { ServerBar } from '../components/layout/ServerBar'
import { ChannelSidebar } from '../components/layout/ChannelSidebar'
import { ChatArea } from '../components/layout/ChatArea'
import { MemberList } from '../components/layout/MemberList'
import { HomeSidebar } from '../components/layout/HomeSidebar'
import { FriendsPanel } from '../components/home/FriendsPanel'
import { DMChatArea } from '../components/layout/DMChatArea'
import { TestBotChatArea } from '../components/layout/TestBotChatArea'
import { UserProfileModal } from '../components/modals/UserProfileModal'
import { ServersProvider } from '../context/ServersContext'
import { useServers } from '../hooks/useServers'
import { useChannels } from '../hooks/useChannels'
import { useConversations } from '../hooks/useConversations'
import { useUnreadOverview } from '../hooks/useUnreadOverview'
import type { Channel, Profile, Server } from '../types/database'

const VoiceChannelView = lazy(() =>
  import('../components/layout/VoiceChannelView').then((m) => ({ default: m.VoiceChannelView }))
)

function MainLayoutInner() {
  const { loading: loadingServers } = useServers()
  const [activeServer, setActiveServer] = useState<Server | null>(null)
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [viewingProfile, setViewingProfile] = useState<Profile | null>(null)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // estado da "home" (quando nenhum servidor está selecionado)
  const [homeView, setHomeView] = useState<'friends' | 'bot' | 'conversation'>('friends')
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const { conversations } = useConversations()
  const unread = useUnreadOverview()

  const { channels, loading: loadingChannels } = useChannels(activeServer?.id ?? null)

  useEffect(() => {
    if (!activeServer) {
      setActiveChannel(null)
      return
    }
    if (loadingChannels) return
    const stillValid = activeChannel && channels.some((c) => c.id === activeChannel.id)
    if (stillValid) return

    const firstText = [...channels].sort((a, b) => a.position - b.position).find((c) => c.type === 'text')
    setActiveChannel(firstText ?? channels[0] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServer?.id, channels, loadingChannels])

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
  }

  function handleSelectServer(server: Server) {
    setActiveServer(server)
    setMobileSidebarOpen(false)
  }

  function handleSelectChannel(channel: Channel) {
    setActiveChannel(channel)
    setMobileSidebarOpen(false)
  }

  function handleSelectHome() {
    setActiveServer(null)
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
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-30"
          onClick={() => setMobileSidebarOpen(false)}
        />
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

        {activeServer ? (
          <ChannelSidebar
            server={activeServer}
            activeChannelId={activeChannel?.id ?? null}
            unreadChannelIds={unread.unreadChannelIds}
            onSelectChannel={handleSelectChannel}
            onServerDeleted={handleServerGone}
            onServerLeft={handleServerGone}
          />
        ) : (
          !loadingServers && (
            <HomeSidebar
              view={homeView}
              activeConversationId={activeConversationId}
              unreadConversationIds={unread.unreadConversationIds}
              onSelectFriends={() => {
                setHomeView('friends')
                setMobileSidebarOpen(false)
              }}
              onSelectBot={() => {
                setHomeView('bot')
                setMobileSidebarOpen(false)
              }}
              onSelectConversation={(id) => {
                setHomeView('conversation')
                setActiveConversationId(id)
                setMobileSidebarOpen(false)
              }}
            />
          )
        )}
      </div>

      {activeServer ? (
        <>
          {activeChannel ? (
            activeChannel.type === 'voice' ? (
              <Suspense
                fallback={
                  <div className="flex-1 flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
                  </div>
                }
              >
                <VoiceChannelView channel={activeChannel} serverId={activeServer.id} />
              </Suspense>
            ) : (
              <ChatArea
                channel={activeChannel}
                server={activeServer}
                onViewProfile={setViewingProfile}
                onJumpToChannel={handleSelectChannel}
              />
            )
          ) : (
            <div className="flex-1 flex items-center justify-center text-discord-text-muted">
              {loadingChannels ? '' : 'Este servidor ainda não tem canais.'}
            </div>
          )}
          <MemberList serverId={activeServer.id} onViewProfile={setViewingProfile} />
        </>
      ) : loadingServers ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
        </div>
      ) : homeView === 'conversation' && activeConversation ? (
        <DMChatArea conversationId={activeConversation.id} otherProfile={activeConversation.otherProfile} />
      ) : homeView === 'bot' ? (
        <TestBotChatArea />
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
    </div>
  )
}

export function MainLayout() {
  return (
    <ServersProvider>
      <MainLayoutInner />
    </ServersProvider>
  )
}
