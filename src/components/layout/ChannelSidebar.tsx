import { Fragment, useState } from 'react'
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
import { useServerMembers } from '../../hooks/useServerMembers'
import { useCollapsedCategories } from '../../hooks/useLocalOrganization'
import { Avatar } from '../ui/Avatar'
import { RolesManagerModal } from '../modals/RolesManagerModal'
import { ModerationLogModal } from '../modals/ModerationLogModal'
import type { Channel, Profile, Server } from '../../types/database'

function VoiceChannelPresence({ channelId, profileById }: { channelId: string; profileById: Record<string, Profile> }) {
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
    <div className="flex items-center gap-1 pl-7 pb-1 flex-wrap">
      {userIds.map((id) => {
        const p = id === user?.id ? undefined : profileById[id]
        const name = id === user?.id ? 'Você' : p?.display_name || p?.username || '...'
        return (
          <div key={id} className="flex items-center gap-1 bg-discord-darker/60 rounded-full pl-0.5 pr-2 py-0.5">
            <Avatar name={p?.username ?? name} avatarUrl={p?.avatar_url} size={16} />
            <span className="text-[10px] text-discord-text-muted truncate max-w-[70px]">{name}</span>
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
    <div className="px-2 py-2 bg-discord-darker/70 border-t border-black/20 flex items-center gap-2 shrink-0">
      <span className="w-2 h-2 rounded-full bg-discord-green shrink-0 animate-pulse" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-discord-green truncate">Voz conectada</p>
        <p className="text-xs text-discord-text-muted truncate">{channel?.name ?? '...'}</p>
      </div>
      <button
        onClick={voice.toggleMute}
        title={voice.muted ? 'Ativar microfone' : 'Mutar microfone'}
        className={`w-7 h-7 flex items-center justify-center rounded shrink-0 transition-colors ${
          voice.muted ? 'text-red-400 hover:text-red-300' : 'text-discord-text-muted hover:text-white'
        }`}
      >
        {voice.muted ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-8.6 3.5L18 5A1 1 0 1 0 16.6 3.6L3.6 16.6A1 1 0 1 0 5 18l2-2A7 7 0 0 0 19 11zM12 15a3 3 0 0 0 3-3l-5.7 5.7A3 3 0 0 0 12 15zM9 6a3 3 0 0 1 6 0v3.5l2-2V6a5 5 0 0 0-9.9-1L9 6.6V6z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zM19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11z" />
          </svg>
        )}
      </button>
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

function ChannelIcon({ type }: { type: 'text' | 'voice' }) {
  if (type === 'voice') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 shrink-0">
        <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 shrink-0 opacity-70">
      <path d="M5.5 4.5c.5-.5 1.2-.8 2-.8h1.4l-.3 15h-1c-.8 0-1.5-.3-2-.8-.6-.5-.9-1.2-.9-2v-9.4c0-.8.3-1.5.8-2zm10 0c.5.5.8 1.2.8 2v9.4c0 .8-.3 1.5-.8 2-.5.5-1.2.8-2 .8h-1l-.3-15h1.4c.8 0 1.5.3 2 .8z" />
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
      <ChannelIcon type={channel.type} />
      <InlineEditableLabel
        value={channel.name}
        editable={isOwner}
        onSave={onRename}
        className="truncate flex-1 text-sm"
      />
      {unread && !active && <span className="w-2 h-2 rounded-full bg-white shrink-0" />}

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
    moveChannel,
    moveChannelToCategory,
    moveCategory,
    updateCategory,
    updateChannel,
    deleteChannel,
  } = useChannels()
  const { permissions } = useModeration(server.id)
  const { members } = useServerMembers(server.id)
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
          <div className="absolute top-full left-2 right-2 mt-1 bg-[#111214] rounded-md shadow-xl border border-black/40 py-1.5 z-20">
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
                  <VoiceChannelPresence channelId={channel.id} profileById={profileById} />
                )}
              </Fragment>
            ))}
          </div>
        )}

        {sortedCategories.map((category) => {
          const categoryChannels = channels
            .filter((c) => c.category_id === category.id)
            .sort((a, b) => a.position - b.position)

          return (
            <div key={category.id} className="group/category">
              <div
                className={`px-1 mb-1 flex items-center justify-between rounded cursor-pointer select-none ${dragOverTarget === category.id ? 'bg-white/5' : ''}`}
                onDragOver={(e) => handleDragOverCategory(e, category.id)}
                onDrop={(e) => handleDropOnCategory(e, category.id)}
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
                        <VoiceChannelPresence channelId={channel.id} profileById={profileById} />
                      )}
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          )
        })}
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
              label: 'Copiar nome do canal',
              onClick: () => navigator.clipboard.writeText(contextChannel.name),
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
    </aside>
  )
}
