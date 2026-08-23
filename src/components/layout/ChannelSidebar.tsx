import { Fragment, useEffect, useState } from 'react'
import { ContextMenu, useContextMenuState } from '../ui/ContextMenu'
import { UserPanel } from './UserPanel'
import { InviteModal } from '../modals/InviteModal'
import { InviteFriendsModal } from '../modals/InviteFriendsModal'
import { ServerSettingsModal } from '../modals/ServerSettingsModal'
import { LeaveServerModal } from '../modals/LeaveServerModal'
import { CreateChannelModal } from '../modals/CreateChannelModal'
import { CreateCategoryModal } from '../modals/CreateCategoryModal'
import { EditChannelModal } from '../modals/EditChannelModal'
import { useAuth } from '../../hooks/useAuth'
import { useChannels } from '../../hooks/useChannels'
import { useModeration } from '../../hooks/useModeration'
import { useVoice } from '../../hooks/useVoice'
import { useVoicePresence } from '../../hooks/useVoicePresence'
import { useChannelMutes } from '../../hooks/useChannelMutes'
import { useServerEvents } from '../../hooks/useServerEvents'
import { EventsModal } from '../modals/EventsModal'
import { useServerWelcomeScreen, ServerWelcomeModal } from '../modals/ServerWelcomeModal'
import { ChannelSidebarSkeleton } from './ChannelSidebarSkeleton'
import { usePinnedItems } from '../../hooks/usePinnedItems'
import { useServerMembers } from '../../hooks/useServerMembers'
import { useCollapsedCategories } from '../../hooks/useLocalOrganization'
import { Avatar } from '../ui/Avatar'
import { RolesManagerModal } from '../modals/RolesManagerModal'
import { ModerationLogModal } from '../modals/ModerationLogModal'
import type { Channel, Profile, Server } from '../../types/database'

function CallDurationTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const label = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`

  return <span className="text-[11px] text-discord-green font-mono tabular-nums shrink-0">{label}</span>
}

function VoiceChannelPresence({
  channelId,
  profileById,
  userLimit,
}: {
  channelId: string
  profileById: Record<string, Profile>
  userLimit?: number
}) {
  const { user } = useAuth()
  const voice = useVoice()
  const isConnectedHere = voice.connectedChannelId === channelId || voice.joiningChannelId === channelId

  // Pro canal que você já está conectado de verdade, usa a lista de
  // participantes que já vem da própria conexão — evita se inscrever
  // de novo no mesmo canal Realtime (o que quebrava ao voltar pra uma
  // sala em que você já estava).
  const observedIds = useVoicePresence(channelId, isConnectedHere)
  const userIds = isConnectedHere
    ? [user?.id, ...Object.keys(voice.participants)].filter((id): id is string => Boolean(id))
    : observedIds

  if (userIds.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5 pl-7 pb-1">
      {Boolean(userLimit) && (
        <p className="text-[10px] text-discord-text-muted">
          {userIds.length}/{userLimit} pessoas
        </p>
      )}
      {userIds.map((id) => {
        const p = id === user?.id ? undefined : profileById[id]
        const name = id === user?.id ? 'Você' : p?.display_name || p?.username || '...'
        const isSpeaking = id === user?.id ? voice.speaking : voice.participants[id]?.speaking ?? false
        const isSharingScreen = id === user?.id ? voice.screenSharing : Boolean(voice.participants[id]?.screenStream)
        return (
          <div key={id} className="flex items-center gap-1.5 rounded px-1 py-0.5">
            {/* Só a FOTO pisca ao detectar áudio, não a linha inteira — a
                pessoa reclamou que antes o nome também "acendia" junto,
                o que distraía mais do que ajudava numa lista com vários
                nomes lado a lado. */}
            <div
              className={`relative rounded-full shrink-0 transition-shadow ${
                isSpeaking ? 'ring-2 ring-discord-blurple shadow-[0_0_6px_0] shadow-discord-blurple/60 animate-pulse' : ''
              }`}
            >
              <Avatar name={p?.username ?? name} avatarUrl={p?.avatar_url} size={16} />
            </div>
            <span className="text-[11px] text-discord-text-muted truncate">{name}</span>
            {isSharingScreen && (
              <span title="Compartilhando tela" className="shrink-0">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 text-discord-green">
                  <path d="M4 4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h5l-1 3h8l-1-3h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4zm0 2h16v9H4V6z" />
                </svg>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function VoiceStatusBar({ serverId }: { serverId: string }) {
  const voice = useVoice()
  const { channels } = useChannels()

  if (voice.connectedServerId !== serverId || !voice.connectedChannelId) return null
  const channel = channels.find((c) => c.id === voice.connectedChannelId)

  return (
    <div className="px-3 py-2.5 bg-discord-darker/70 border-t border-black/20 flex items-center gap-2.5 shrink-0">
      <span className="w-2.5 h-2.5 rounded-full bg-discord-green shrink-0 animate-pulse" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-discord-green truncate">Voz conectada</p>
        <p className="text-sm text-discord-text-muted truncate">{channel?.name ?? '...'}</p>
      </div>
      {/* O botão de mutar que ficava aqui foi removido de propósito: virou
          um terceiro controle fazendo a mesma coisa que o ícone de mic ao
          lado do perfil (UserPanel) e o da barra da própria call
          (VoiceChannelView) — três jeitos diferentes de mutar confundiam
          mais do que ajudavam. Os dois que sobraram já leem/escrevem o
          mesmo voice.muted/voice.toggleMute compartilhado, então clicar
          num já atualiza o ícone do outro sozinho. */}
      <button
        onClick={voice.leave}
        title="Desconectar"
        className="w-7 h-7 flex items-center justify-center rounded text-discord-text-muted hover:text-red-400 transition-colors shrink-0"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
          <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
        </svg>
      </button>
    </div>
  )
}

function ChannelIcon({ type, isStage }: { type: 'text' | 'voice'; isStage?: boolean }) {
  if (type === 'voice' && isStage) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 shrink-0 text-yellow-400">
        <path d="M11 2a1 1 0 0 1 1 1v.06a8 8 0 0 1 7 7.94v3a3 3 0 0 1-3 3h-1l-3 4-3-4H8a3 3 0 0 1-3-3v-3a8 8 0 0 1 7-7.94V3a1 1 0 0 1-1-1zm1 5a5 5 0 0 0-5 5v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3a5 5 0 0 0-5-5z" />
      </svg>
    )
  }
  if (type === 'voice') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 shrink-0">
        <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 shrink-0 opacity-70">
      <path d="M9.3 3.1a1 1 0 0 1 1.94.48L10.6 6.5h3.24l.68-2.92a1 1 0 1 1 1.94.48L15.86 6.5h2.14a1 1 0 1 1 0 2h-2.6l-.7 3h2.3a1 1 0 1 1 0 2h-2.77l-.72 3.1a1 1 0 1 1-1.94-.48l.6-2.62H9.13l-.72 3.1a1 1 0 1 1-1.94-.48l.6-2.62H4.9a1 1 0 1 1 0-2h2.64l.7-3H6a1 1 0 1 1 0-2h2.6l.7-3zm.84 5.4-.7 3h3.24l.7-3z" />
    </svg>
  )
}

function InlineEditableLabel({
  value,
  onSave,
  editable,
  className,
}: {
  value: string
  onSave: (value: string) => void
  editable: boolean
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  function startEdit(e: React.MouseEvent) {
    if (!editable) return
    e.stopPropagation()
    setDraft(value)
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const cleaned = draft.trim()
    if (cleaned && cleaned !== value) onSave(cleaned)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        className={`bg-discord-darker text-discord-text rounded px-1 outline-none ring-1 ring-discord-blurple ${className ?? ''}`}
      />
    )
  }

  return (
    <span onDoubleClick={startEdit} title={editable ? 'Clique duas vezes para renomear' : undefined} className={className}>
      {value}
    </span>
  )
}

function ChannelRow({
  channel,
  active,
  unread,
  muted,
  pinned,
  isOwner,
  isDragOver,
  onSelect,
  onEdit,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onRename,
  onContextMenu,
}: {
  channel: Channel
  active: boolean
  unread: boolean
  muted: boolean
  pinned: boolean
  isOwner: boolean
  isDragOver: boolean
  onSelect: () => void
  onEdit: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onRename: (name: string) => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const voice = useVoice()
  return (
    <div
      draggable={isOwner}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      className={`group flex items-center gap-1.5 px-2 py-1.5 rounded text-sm font-medium transition-colors ${isOwner ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
        ${active ? 'bg-discord-lighter text-white' : unread ? 'text-white' : 'text-discord-text-muted hover:bg-white/5 hover:text-discord-text'}
        ${isDragOver ? 'ring-2 ring-discord-blurple' : ''}
      `}
      onClick={onSelect}
    >
      <ChannelIcon type={channel.type} isStage={channel.is_stage} />
      {pinned && (
        <span title="Canal fixado" className="shrink-0 text-yellow-400">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
            <path d="M16 3l5 5-3.5 3.5L19 14l-1.4 1.4-3.5-2.5L10.5 16.5 9 15l3.6-3.6L10 8.9 13.5 5.4 16 3z" />
          </svg>
        </span>
      )}
      {channel.is_spoiler && (
        <span title="Canal spoiler" className="shrink-0">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 text-yellow-400">
            <path d="M12 2a5 5 0 0 0-5 5v3H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-1V7a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3z" />
          </svg>
        </span>
      )}
      {channel.is_restricted && (
        <span title="Canal restrito — só cargos específicos veem" className="shrink-0">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 text-discord-text-muted">
            <path d="M12 2a5 5 0 0 0-5 5v3H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-1V7a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3zm0 9a1.5 1.5 0 0 0-1 2.6V17a1 1 0 0 0 2 0v-1.4A1.5 1.5 0 0 0 12 13z" />
          </svg>
        </span>
      )}
      <InlineEditableLabel
        value={channel.name}
        editable={isOwner}
        onSave={onRename}
        className="truncate flex-1 text-sm"
      />
      {unread && !active && !muted && <span className="w-2 h-2 rounded-full bg-white shrink-0" />}
      {channel.type === 'voice' && voice.connectedChannelId === channel.id && voice.connectedAt && (
        <CallDurationTimer startedAt={voice.connectedAt} />
      )}
      {muted && (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-discord-text-muted shrink-0">
          <path d="M16.5 12A4.5 4.5 0 0 0 14 8v1.2l2.4 2.4c.06-.2.1-.4.1-.6zm2.5 0c0 .94-.2 1.83-.55 2.64l1.51 1.51A8.94 8.94 0 0 0 21 12h-2zM4.27 3L3 4.27l6 6V12a4.5 4.5 0 0 0 6.16 4.18l1.6 1.6a6.5 6.5 0 0 1-9.26-5.87v-.36l-.01.01L3 8.27V12a9 9 0 0 0 8 8.94V22h2v-1.06a8.93 8.93 0 0 0 3.36-1.09L19.73 22 21 20.73 4.27 3z" />
        </svg>
      )}

      {isOwner && (
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <button
            title="Mover para cima"
            onClick={(e) => {
              e.stopPropagation()
              onMoveUp()
            }}
            className="w-5 h-5 flex items-center justify-center hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M12 8l-6 6h12l-6-6z" />
            </svg>
          </button>
          <button
            title="Mover para baixo"
            onClick={(e) => {
              e.stopPropagation()
              onMoveDown()
            }}
            className="w-5 h-5 flex items-center justify-center hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M12 16l6-6H6l6 6z" />
            </svg>
          </button>
          <button
            title="Editar canal"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            className="w-5 h-5 flex items-center justify-center hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M19.4 13a7.4 7.4 0 0 0 .1-1 7.4 7.4 0 0 0-.1-1l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.6 7.6 0 0 0-1.7-1l-.4-2.5a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1a.5.5 0 0 0-.6.2L2.6 8.8a.5.5 0 0 0 .1.6l2 1.6a7.4 7.4 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.3a.5.5 0 0 0 .6.2l2.4-1c.5.4 1.1.8 1.7 1l.4 2.5a.5.5 0 0 0 .5.4h3.8a.5.5 0 0 0 .5-.4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1a.5.5 0 0 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6l-2-1.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

export function ChannelSidebar({
  server,
  activeChannelId,
  unreadChannelIds,
  onSelectChannel,
  onServerDeleted,
  onServerLeft,
}: {
  server: Server
  activeChannelId: string | null
  unreadChannelIds: Set<string>
  onSelectChannel: (channel: Channel) => void
  onServerDeleted: () => void
  onServerLeft: () => void
}) {
  const { user } = useAuth()
  const isOwner = server.owner_id === user?.id
  const {
    categories,
    channels,
    loading: loadingChannels,
    loadError: channelsLoadError,
    refresh,
    moveChannel,
    moveChannelToCategory,
    moveCategory,
    updateCategory,
    updateChannel,
    deleteChannel,
  } = useChannels()
  const { permissions } = useModeration(server.id)
  const { members } = useServerMembers(server.id)
  const { mutedChannelIds, getLevel, setNotificationLevel } = useChannelMutes()
  const { events } = useServerEvents(server.id)
  const [showEvents, setShowEvents] = useState(false)
  const { show: showWelcome, dismiss: dismissWelcome } = useServerWelcomeScreen(server, user?.id)
  const { pinnedIds, toggle: togglePinChannel } = usePinnedItems()
  const upcomingEventsCount = events.filter((e) => new Date(e.starts_at).getTime() >= Date.now()).length
  const profileById = Object.fromEntries(members.map((m) => [m.user_id, m.profile]))
  const { collapsed: collapsedCategories, toggle: toggleCategoryCollapse } = useCollapsedCategories()

  const [menuOpen, setMenuOpen] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showInviteFriends, setShowInviteFriends] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showLeave, setShowLeave] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState<{ categoryId: string | null } | null>(null)
  const [showCreateCategory, setShowCreateCategory] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [draggedChannelId, setDraggedChannelId] = useState<string | null>(null)
  const [contextChannel, setContextChannel] = useState<Channel | null>(null)
  const { menuState, openMenu, closeMenu } = useContextMenuState()

  function handleChannelContextMenu(e: React.MouseEvent, channel: Channel) {
    setContextChannel(channel)
    openMenu(e)
  }
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null)

  function handleDragStart(e: React.DragEvent, channelId: string) {
    e.dataTransfer.setData('text/plain', channelId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggedChannelId(channelId)
  }

  function handleDragOverChannel(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    setDragOverTarget(targetId)
  }

  function handleDragOverCategory(e: React.DragEvent, categoryKey: string) {
    e.preventDefault()
    setDragOverTarget(categoryKey)
  }

  async function handleDropOnChannel(e: React.DragEvent, targetChannel: Channel) {
    e.preventDefault()
    const draggedId = e.dataTransfer.getData('text/plain')
    setDragOverTarget(null)
    setDraggedChannelId(null)
    if (!draggedId || draggedId === targetChannel.id) return
    await moveChannelToCategory(draggedId, targetChannel.category_id, targetChannel.id)
  }

  async function handleDropOnCategory(e: React.DragEvent, categoryId: string | null) {
    e.preventDefault()
    const draggedId = e.dataTransfer.getData('text/plain')
    setDragOverTarget(null)
    setDraggedChannelId(null)
    if (!draggedId) return
    await moveChannelToCategory(draggedId, categoryId)
  }
  const [showRoles, setShowRoles] = useState(false)
  const [showModeration, setShowModeration] = useState(false)

  const canManageChannels = isOwner || permissions.manage_channels
  const canManageRoles = isOwner || permissions.manage_roles
  const canViewAuditLog = isOwner || permissions.view_audit_log

  const uncategorized = channels.filter((c) => c.category_id === null).sort((a, b) => a.position - b.position)
  const sortedCategories = [...categories].sort((a, b) => a.position - b.position)

  return (
    <aside className="w-60 bg-discord-sidebar flex flex-col shrink-0">
      {server.banner_url && (
        <div className="h-20 w-full overflow-hidden shrink-0 border-b border-discord-blurple/30">
          <img src={server.banner_url} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="w-full h-12 px-4 flex items-center justify-between border-b border-black/20 shadow-sm text-white font-semibold text-left hover:bg-white/5 transition-colors"
        >
          <span className="truncate font-display tracking-wide">{server.name}</span>
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
            <path d="M12 16a1 1 0 0 1-.7-.3l-6-6a1 1 0 1 1 1.4-1.4L12 13.6l5.3-5.3a1 1 0 0 1 1.4 1.4l-6 6a1 1 0 0 1-.7.3z" />
          </svg>
        </button>

        {menuOpen && (
          <div className="absolute top-full left-2 right-2 mt-1 bg-discord-darker rounded-md shadow-xl border border-black/40 py-1.5 z-20">
            <button
              onClick={() => {
                setShowInvite(true)
                setMenuOpen(false)
              }}
              className="w-full text-left px-3 py-2 text-sm text-discord-blurple hover:bg-white/5 transition-colors"
            >
              Convidar pessoas
            </button>
            <button
              onClick={() => {
                setShowInviteFriends(true)
                setMenuOpen(false)
              }}
              className="w-full text-left px-3 py-2 text-sm text-discord-blurple hover:bg-white/5 transition-colors"
            >
              Chamar amigos
            </button>
            {canManageChannels && (
              <>
                <button
                  onClick={() => {
                    setShowCreateChannel({ categoryId: null })
                    setMenuOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-discord-text hover:bg-white/5 transition-colors"
                >
                  Criar canal
                </button>
                <button
                  onClick={() => {
                    setShowCreateCategory(true)
                    setMenuOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-discord-text hover:bg-white/5 transition-colors"
                >
                  Criar categoria
                </button>
              </>
            )}
            {canManageRoles && (
              <button
                onClick={() => {
                  setShowRoles(true)
                  setMenuOpen(false)
                }}
                className="w-full text-left px-3 py-2 text-sm text-discord-text hover:bg-white/5 transition-colors"
              >
                Cargos
              </button>
            )}
            {canViewAuditLog && (
              <button
                onClick={() => {
                  setShowModeration(true)
                  setMenuOpen(false)
                }}
                className="w-full text-left px-3 py-2 text-sm text-discord-text hover:bg-white/5 transition-colors"
              >
                Moderação
              </button>
            )}
            <button
              onClick={() => {
                setShowSettings(true)
                setMenuOpen(false)
              }}
              className="w-full text-left px-3 py-2 text-sm text-discord-text hover:bg-white/5 transition-colors"
            >
              Configurações do servidor
            </button>
            <div className="h-px bg-white/10 my-1.5" />
            {!isOwner && (
              <button
                onClick={() => {
                  setShowLeave(true)
                  setMenuOpen(false)
                }}
                className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Sair do servidor
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {loadingChannels ? (
          <ChannelSidebarSkeleton />
        ) : channelsLoadError ? (
          <div className="px-2 py-3 space-y-2">
            <p className="text-sm text-red-400">Não foi possível carregar os canais.</p>
            <p className="text-xs text-discord-text-muted break-words">{channelsLoadError}</p>
            <button
              onClick={() => refresh()}
              className="text-xs font-medium text-discord-blurple hover:underline"
            >
              Tentar de novo
            </button>
          </div>
        ) : (
          <>
        <button
          onClick={() => setShowEvents(true)}
          className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm font-medium text-discord-text-muted hover:bg-white/5 hover:text-discord-text transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 shrink-0">
            <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1zM4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9H4zm3 3h4v4H7v-4z" />
          </svg>
          Eventos
          {upcomingEventsCount > 0 && (
            <span className="ml-auto bg-discord-blurple text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {upcomingEventsCount}
            </span>
          )}
        </button>

        {uncategorized.length > 0 && (
          <div
            className={`space-y-0.5 rounded ${dragOverTarget === 'uncategorized' ? 'bg-white/5' : ''}`}
            onDragOver={(e) => handleDragOverCategory(e, 'uncategorized')}
            onDrop={(e) => handleDropOnCategory(e, null)}
          >
            {uncategorized.map((channel) => (
              <Fragment key={channel.id}>
                <ChannelRow
                  channel={channel}
                  active={activeChannelId === channel.id}
                  unread={unreadChannelIds.has(channel.id)}
                  muted={mutedChannelIds.has(channel.id)}
                  pinned={pinnedIds.has(channel.id)}
                  isOwner={isOwner}
                  isDragOver={dragOverTarget === channel.id && draggedChannelId !== channel.id}
                  onSelect={() => onSelectChannel(channel)}
                  onEdit={() => setEditingChannel(channel)}
                  onMoveUp={() => moveChannel(channel.id, null, 'up')}
                  onMoveDown={() => moveChannel(channel.id, null, 'down')}
                  onDragStart={(e) => handleDragStart(e, channel.id)}
                  onDragOver={(e) => handleDragOverChannel(e, channel.id)}
                  onDragLeave={() => setDragOverTarget(null)}
                  onDrop={(e) => handleDropOnChannel(e, channel)}
                  onRename={(name) => updateChannel(channel.id, { name: name.toLowerCase().replace(/\s+/g, "-") })}
                  onContextMenu={(e) => handleChannelContextMenu(e, channel)}
                />
                {channel.type === 'voice' && (
                  <VoiceChannelPresence channelId={channel.id} profileById={profileById} userLimit={channel.user_limit} />
                )}
              </Fragment>
            ))}
          </div>
        )}

        {uncategorized.length > 0 && sortedCategories.length > 0 && (
          <div className="h-px bg-white/10 mx-1" />
        )}

        {sortedCategories.map((category) => {
          const categoryChannels = channels
            .filter((c) => c.category_id === category.id)
            .sort((a, b) => a.position - b.position)

          return (
            <div
              key={category.id}
              className={`group/category rounded transition-colors ${
                dragOverTarget === category.id ? 'bg-white/5 ring-1 ring-dashed ring-discord-blurple/50' : ''
              }`}
              onDragOver={(e) => handleDragOverCategory(e, category.id)}
              onDragLeave={() => setDragOverTarget(null)}
              onDrop={(e) => handleDropOnCategory(e, category.id)}
            >
              <div
                className="px-1 mb-1 flex items-center justify-between rounded cursor-pointer select-none"
                onClick={() => toggleCategoryCollapse(category.id)}
              >
                <div className="flex items-center gap-1 min-w-0">
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className={`w-3 h-3 shrink-0 text-discord-text-muted transition-transform ${
                      collapsedCategories.has(category.id) ? '-rotate-90' : ''
                    }`}
                  >
                    <path d="M12 16a1 1 0 0 1-.7-.3l-6-6a1 1 0 1 1 1.4-1.4L12 13.6l5.3-5.3a1 1 0 0 1 1.4 1.4l-6 6a1 1 0 0 1-.7.3z" />
                  </svg>
                  <InlineEditableLabel
                    value={category.name}
                    editable={isOwner}
                    onSave={(name) => updateCategory(category.id, name.toUpperCase())}
                    className="text-xs font-semibold text-discord-text-muted tracking-wide truncate"
                  />
                </div>
                {isOwner && (
                  <div className="hidden group-hover/category:flex items-center gap-1 shrink-0">
                    <button
                      title="Mover categoria para cima"
                      onClick={(e) => {
                        e.stopPropagation()
                        moveCategory(category.id, 'up')
                      }}
                      className="text-discord-text-muted hover:text-white"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
                        <path d="M12 8l-6 6h12l-6-6z" />
                      </svg>
                    </button>
                    <button
                      title="Mover categoria para baixo"
                      onClick={(e) => {
                        e.stopPropagation()
                        moveCategory(category.id, 'down')
                      }}
                      className="text-discord-text-muted hover:text-white"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
                        <path d="M12 16l6-6H6l6 6z" />
                      </svg>
                    </button>
                    <button
                      title="Criar canal nesta categoria"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowCreateChannel({ categoryId: category.id })
                      }}
                      className="text-discord-text-muted hover:text-white"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1z" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
              {!collapsedCategories.has(category.id) && (
                <div className="space-y-0.5">
                  {categoryChannels.map((channel) => (
                    <Fragment key={channel.id}>
                      <ChannelRow
                        channel={channel}
                        active={activeChannelId === channel.id}
                        unread={unreadChannelIds.has(channel.id)}
                        muted={mutedChannelIds.has(channel.id)}
                        pinned={pinnedIds.has(channel.id)}
                        isOwner={isOwner}
                        isDragOver={dragOverTarget === channel.id && draggedChannelId !== channel.id}
                        onSelect={() => onSelectChannel(channel)}
                        onEdit={() => setEditingChannel(channel)}
                        onMoveUp={() => moveChannel(channel.id, category.id, 'up')}
                        onMoveDown={() => moveChannel(channel.id, category.id, 'down')}
                        onDragStart={(e) => handleDragStart(e, channel.id)}
                        onDragOver={(e) => handleDragOverChannel(e, channel.id)}
                        onDragLeave={() => setDragOverTarget(null)}
                        onDrop={(e) => handleDropOnChannel(e, channel)}
                        onRename={(name) => updateChannel(channel.id, { name: name.toLowerCase().replace(/\s+/g, '-') })}
                        onContextMenu={(e) => handleChannelContextMenu(e, channel)}
                      />
                      {channel.type === 'voice' && (
                        <VoiceChannelPresence channelId={channel.id} profileById={profileById} userLimit={channel.user_limit} />
                      )}
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        </>
        )}
      </div>

      <VoiceStatusBar serverId={server.id} />
      <UserPanel />

      {showInvite && <InviteModal serverId={server.id} onClose={() => setShowInvite(false)} />}
      {showInviteFriends && (
        <InviteFriendsModal serverId={server.id} onClose={() => setShowInviteFriends(false)} />
      )}
      {showSettings && (
        <ServerSettingsModal
          server={server}
          isOwner={isOwner}
          channels={channels}
          onClose={() => setShowSettings(false)}
          onDeleted={() => {
            setShowSettings(false)
            onServerDeleted()
          }}
        />
      )}
      {showLeave && (
        <LeaveServerModal
          serverId={server.id}
          serverName={server.name}
          onClose={() => setShowLeave(false)}
          onLeft={() => {
            setShowLeave(false)
            onServerLeft()
          }}
        />
      )}
      {showCreateChannel && (
        <CreateChannelModal
          categories={sortedCategories}
          defaultCategoryId={showCreateChannel.categoryId}
          onClose={() => setShowCreateChannel(null)}
        />
      )}
      {showCreateCategory && (
        <CreateCategoryModal onClose={() => setShowCreateCategory(false)} />
      )}
      {editingChannel && (
        <EditChannelModal
          channel={editingChannel}
          serverId={server.id}
          onClose={() => setEditingChannel(null)}
        />
      )}
      {showRoles && <RolesManagerModal serverId={server.id} onClose={() => setShowRoles(false)} />}
      {showModeration && <ModerationLogModal serverId={server.id} onClose={() => setShowModeration(false)} />}

      {menuState && contextChannel && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          onClose={closeMenu}
          items={[
            { label: 'Abrir canal', onClick: () => onSelectChannel(contextChannel) },
            {
              label: pinnedIds.has(contextChannel.id) ? 'Desafixar canal' : 'Fixar canal',
              onClick: () => togglePinChannel(contextChannel.id),
            },
            {
              label: 'Copiar nome do canal',
              onClick: () => navigator.clipboard.writeText(contextChannel.name),
            },
            {
              label:
                getLevel(contextChannel.id) === 'all'
                  ? 'Notificar: só menções'
                  : getLevel(contextChannel.id) === 'mentions'
                    ? 'Silenciar totalmente'
                    : 'Reativar notificações',
              onClick: () => {
                const current = getLevel(contextChannel.id)
                const next = current === 'all' ? 'mentions' : current === 'mentions' ? 'muted' : 'all'
                setNotificationLevel(contextChannel.id, next)
              },
            },
            ...(isOwner
              ? [
                  { label: 'Editar canal', onClick: () => setEditingChannel(contextChannel) },
                  {
                    label: 'Mover para cima',
                    onClick: () => moveChannel(contextChannel.id, contextChannel.category_id, 'up'),
                  },
                  {
                    label: 'Mover para baixo',
                    onClick: () => moveChannel(contextChannel.id, contextChannel.category_id, 'down'),
                  },
                  ...(sortedCategories.length > 0
                    ? [
                        ...sortedCategories
                          .filter((cat) => cat.id !== contextChannel.category_id)
                          .map((cat) => ({
                            label: `Mover para "${cat.name}"`,
                            divider: cat.id === sortedCategories.filter((c) => c.id !== contextChannel.category_id)[0]?.id,
                            onClick: () => moveChannelToCategory(contextChannel.id, cat.id),
                          })),
                        ...(contextChannel.category_id !== null
                          ? [
                              {
                                label: 'Remover da categoria',
                                onClick: () => moveChannelToCategory(contextChannel.id, null),
                              },
                            ]
                          : []),
                      ]
                    : []),
                  {
                    label: 'Excluir canal',
                    danger: true,
                    divider: true,
                    onClick: () => {
                      if (confirm(`Excluir o canal "${contextChannel.name}"? Essa ação não pode ser desfeita.`)) {
                        deleteChannel(contextChannel.id)
                      }
                    },
                  },
                ]
              : []),
          ]}
        />
      )}

      {showWelcome && <ServerWelcomeModal server={server} onDismiss={dismissWelcome} />}

      {showEvents && (
        <EventsModal
          serverId={server.id}
          channels={channels}
          canCreate={isOwner || permissions.manage_channels}
          membersById={profileById}
          onClose={() => setShowEvents(false)}
        />
      )}
    </aside>
  )
}
