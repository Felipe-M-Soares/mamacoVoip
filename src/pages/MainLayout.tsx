import { Suspense, useCallback, useEffect, useMemo, useRef, useState, lazy } from 'react'
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
import { useOnboarding } from '../components/modals/OnboardingModal'
import { GuidedTour, TourOffer } from '../components/GuidedTour'
import { DMCallOverlay } from '../components/layout/DMCallOverlay'
import { VoiceCallAudio } from '../components/layout/VoiceCallAudio'
import { ProfileSidePanel } from '../components/layout/ProfileSidePanel'
import { ServersProvider } from '../context/ServersContext'
import { consumePendingPushTarget, initPushNotifications, type PushTarget } from '../lib/pushNotifications'
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
import { MessageAlerts } from '../components/ui/MessageAlerts'
import { OverlayStateSync } from '../components/layout/OverlayStateSync'
import { AutoIdleStatus } from '../components/layout/AutoIdleStatus'
import type { Channel, Profile, Server } from '../types/database'
import { setWindowPlace, setWindowUnreadCount } from '../lib/windowTitle'
import { MediaViewer } from '../components/ui/MediaViewer'
import { KeybindsRunner } from '../components/KeybindsRunner'
import { useAppUsageHeartbeat } from '../hooks/useAppUsage'
import { canUseOffice3d } from '../lib/platform'
const Office3DView = lazy(() => import('../office3d/Office3DView').then((m) => ({ default: m.Office3DView })))

const VoiceChannelView = lazyComponent(() =>
  import('../components/layout/VoiceChannelView').then((m) => m.VoiceChannelView)
)
const UserProfileModal = lazyComponent(() => import('../components/modals/UserProfileModal').then((m) => m.UserProfileModal))
const EditProfileModal = lazyComponent(() => import('../components/modals/EditProfileModal').then((m) => m.EditProfileModal))
const QuickSwitcher = lazyComponent(() => import('../components/modals/QuickSwitcher').then((m) => m.QuickSwitcher))
const KeyboardShortcutsModal = lazyComponent(() =>
  import('../components/modals/KeyboardShortcutsModal').then((m) => m.KeyboardShortcutsModal)
)

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

function ActiveServerContent({
  server,
  activeChannel,
  pendingChannelId,
  unreadChannelIds,
  drawerOpen,
  isElectronApp,
  unreadServerIds,
  homeUnreadCount,
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
  dmConversation?: { id: string; otherProfile: Profile } | null
  unreadChannelIds: Set<string>
  drawerOpen: boolean
  isElectronApp: boolean
  unreadServerIds: Set<string>
  homeUnreadCount: number
  onSelectServer: (server: Server) => void
  onSelectHome: () => void
  onSelectChannel: (channel: Channel, serverId?: string) => void
  onServerGone: () => void
  onViewProfile: (profile: Profile) => void
  onMessageUser?: (userId: string) => void
}) {
  const [mobileMembersOpen, setMobileMembersOpen] = useState(false)
  const [office3d, setOffice3d] = useState(false)
  useEffect(() => {
    const open = () => { if (canUseOffice3d()) setOffice3d(true) }
    window.addEventListener('mv:open-3d', open)
    return () => window.removeEventListener('mv:open-3d', open)
  }, [])
  const [desktopMembersOpen, setDesktopMembersOpen] = useState(() => {
    try {
      return localStorage.getItem('mv-members-open') === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    const onToggle = () => toggleMembersRef.current()
    window.addEventListener('mv:toggle-members', onToggle)
    return () => window.removeEventListener('mv:toggle-members', onToggle)
  }, [])
  const toggleMembersRef = useRef(toggleMembers)
  toggleMembersRef.current = toggleMembers
  function toggleMembers() {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setDesktopMembersOpen((v) => {
        try {
          localStorage.setItem('mv-members-open', v ? '0' : '1')
        } catch {
        }
        return !v
      })
    } else setMobileMembersOpen((v) => !v)
  }

  return (
    <ChannelsProvider serverId={server.id} key={server.id}>
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
            homeUnreadCount={homeUnreadCount}
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
      {office3d && canUseOffice3d() && (
        <Suspense fallback={<div className="fixed inset-0 z-[70] bg-[#0c0a10] flex items-center justify-center text-mv-muted text-sm">Montando o escritório…</div>}>
          <Office3DView server={server} unreadChannelIds={unreadChannelIds} onClose={() => setOffice3d(false)} onSelectChannel={(c) => onSelectChannel(c)} />
        </Suspense>
      )}
    </ChannelsProvider>
  )
}

function MainLayoutInner() {
  useGamePresence()
  const { profile: ownProfile } = useAuth()
  const voice = useVoiceCore()
  useAppUsageHeartbeat(ownProfile?.id, !!voice.connectedChannelId)
  const { servers, loading: loadingServers } = useServers()
  const location = useLocation()
  const navigate = useNavigate()
  const [activeServerId, setActiveServerId] = useState<string | null>(null)
  const activeServer = useMemo(() => servers.find((s) => s.id === activeServerId) ?? null, [servers, activeServerId])
  const setActiveServer = useCallback((server: Server | null) => setActiveServerId(server?.id ?? null), [])
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null)
  const pendingAutoJoinVoiceRef = useRef(false)
  const [viewingProfile, setViewingProfile] = useState<Profile | null>(null)
  const onboarding = useOnboarding(ownProfile?.id)
  const [tourOpen, setTourOpen] = useState(false)
  useEffect(() => {
    const start = () => setTourOpen(true)
    window.addEventListener('mv:start-tour', start)
    return () => window.removeEventListener('mv:start-tour', start)
  }, [])
  const [showEditProfile, setShowEditProfile] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  useEffect(() => {
    const onDrawer = (e: Event) => setMobileSidebarOpen(Boolean((e as CustomEvent<{ open: boolean }>).detail?.open))
    window.addEventListener('mv:mobile-drawer', onDrawer)
    return () => window.removeEventListener('mv:mobile-drawer', onDrawer)
  }, [])
  const isElectronApp = Boolean(window.electronAPI?.isElectron)
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)

  useEffect(() => {
    const cancel = preloadLazyChunks()
    const t = window.setTimeout(preloadNoiseSuppression, 3000)
    return () => {
      cancel()
      clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    if (!activeServerId || loadingServers) return
    if (!servers.some((s) => s.id === activeServerId)) {
      setActiveServerId(null)
      setActiveChannel(null)
    }
  }, [activeServerId, servers, loadingServers])

  useEffect(() => {
    const toggleSwitcher = () => setShowQuickSwitcher((v) => !v)
    const toggleShortcuts = () => setShowShortcuts((v) => !v)
    window.addEventListener('mv:quick-switcher', toggleSwitcher)
    window.addEventListener('mv:show-shortcuts', toggleShortcuts)
    return () => {
      window.removeEventListener('mv:quick-switcher', toggleSwitcher)
      window.removeEventListener('mv:show-shortcuts', toggleShortcuts)
    }
  }, [])

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

  useEffect(() => {
    if (!pendingAutoJoinVoiceRef.current) return
    if (!activeChannel || !activeServer) return
    if (activeChannel.id !== pendingChannelId || activeChannel.type !== 'voice') return
    pendingAutoJoinVoiceRef.current = false
    voice.join(activeChannel.id, activeServer.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel?.id])

  const [homeView, setHomeView] = useState<'friends' | 'conversation' | 'group'>('friends')
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const { conversations, openConversationWith } = useConversations()

  const [serverDmId, setServerDmId] = useState<string | null>(null)
  async function handleMessageUser(userId: string) {
    const { conversation, error } = await openConversationWith(userId)
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
  const markChannelReadRef = useRef(unread.markChannelRead)
  markChannelReadRef.current = unread.markChannelRead
  useEffect(() => {
    const onRead = (e: Event) => {
      const id = (e as CustomEvent<{ channelId?: string }>).detail?.channelId
      if (id) void markChannelReadRef.current(id)
    }
    window.addEventListener('mv:mark-channel-read', onRead)
    return () => window.removeEventListener('mv:mark-channel-read', onRead)
  }, [])

  const activeTextChannelId = activeServer && activeChannel?.type === 'text' ? activeChannel.id : null
  const activeTextChannelUnread = activeTextChannelId ? unread.unreadChannelIds.has(activeTextChannelId) : false
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

  const openConversationId = activeServer ? serverDmId : homeView === 'conversation' ? activeConversationId : null
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

  const [unreadGroupIds, setUnreadGroupIds] = useState<Set<string>>(() => new Set())
  const openGroupId = !activeServer && homeView === 'group' ? activeGroupId : null
  useEffect(() => {
    if (!openGroupId) return
    setUnreadGroupIds((prev) => {
      if (!prev.has(openGroupId)) return prev
      const next = new Set(prev)
      next.delete(openGroupId)
      return next
    })
  }, [openGroupId])
  const handleIncomingUnread = useCallback(
    (kind: 'dm' | 'group', id: string) => {
      if (kind === 'dm') unread.markConversationUnread(id)
      else setUnreadGroupIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unread.markConversationUnread]
  )
  const homeUnreadCount = unread.unreadConversationIds.size + unreadGroupIds.size
  useEffect(() => setWindowUnreadCount(homeUnreadCount), [homeUnreadCount])
  useEffect(() => () => setWindowUnreadCount(0), [])

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

  useEffect(() => {
    void initPushNotifications()
  }, [])
  useEffect(() => {
    function open(t: PushTarget) {
      if (t.kind === 'dm') handleOpenConversation(t.id)
      else if (t.kind === 'group') handleOpenGroup(t.id)
      else {
        const target = servers.find((s) => s.id === t.serverId)
        if (!target) return
        if (activeServer?.id !== target.id) setActiveServer(target)
        setServerDmId(null)
        setActiveChannel(null)
        setPendingChannelId(t.id)
        setMobileSidebarOpen(false)
      }
    }
    function onTarget(e: Event) {
      const t = (e as CustomEvent<PushTarget>).detail
      if (t) {
        consumePendingPushTarget()
        open(t)
      }
    }
    const early = servers.length > 0 ? consumePendingPushTarget() : null
    if (early) open(early)
    window.addEventListener('mv:open-target', onTarget)
    return () => window.removeEventListener('mv:open-target', onTarget)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {!isElectronApp && mobileSidebarOpen && (
        <div data-overlay-open className="lg:hidden fixed inset-0 bg-black/70 z-30 animate-fade-in" onClick={() => setMobileSidebarOpen(false)} />
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
          homeUnreadCount={homeUnreadCount}
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
                homeUnreadCount={homeUnreadCount}
                onSelectServer={handleSelectServer}
                onSelectHome={handleSelectHome}
              />

              {!loadingServers && (
                <HomeSidebar
                  view={homeView}
                  activeConversationId={activeConversationId}
                  activeGroupId={activeGroupId}
                  unreadConversationIds={unread.unreadConversationIds}
                  unreadGroupIds={unreadGroupIds}
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
            <DMChatArea key={activeConversation.id} conversationId={activeConversation.id} otherProfile={activeConversation.otherProfile} />
          ) : homeView === 'group' && activeGroup ? (
            <GroupChatArea key={activeGroup.id} group={activeGroup} onLeave={handleSelectHome} />
          ) : (
            <FriendsPanel onOpenConversation={handleOpenConversation} />
          )}
        </>
      )}

      {!activeServer && !loadingServers && ownProfile && homeView === 'conversation' && activeConversation && (
        <ProfileSidePanel
          profile={activeConversation.otherProfile}
          isSelf={false}
          onViewFullProfile={() => setViewingProfile(activeConversation.otherProfile)}
        />
      )}

      <Suspense fallback={null}>
      <MediaViewer />
      <KeybindsRunner />
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
      {onboarding.show && !tourOpen && (
        <TourOffer
          onStart={() => {
            onboarding.dismiss()
            setTourOpen(true)
          }}
          onDismiss={onboarding.dismiss}
        />
      )}
      {tourOpen && <GuidedTour onClose={() => setTourOpen(false)} />}
      <DMCallOverlay profilesById={callProfilesById} />

      <VoiceCallAudio />
      <GameDetectedToast />
      <VoiceMovedToast />
      <MessageAlerts viewingTargetId={openConversationId ?? openGroupId} onUnread={handleIncomingUnread} />
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
