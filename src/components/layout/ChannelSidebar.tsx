import { useState } from 'react'
import { UserPanel } from './UserPanel'
import { InviteModal } from '../modals/InviteModal'
import { ServerSettingsModal } from '../modals/ServerSettingsModal'
import { LeaveServerModal } from '../modals/LeaveServerModal'
import { CreateChannelModal } from '../modals/CreateChannelModal'
import { CreateCategoryModal } from '../modals/CreateCategoryModal'
import { EditChannelModal } from '../modals/EditChannelModal'
import { useAuth } from '../../hooks/useAuth'
import { useChannels } from '../../hooks/useChannels'
import { useModeration } from '../../hooks/useModeration'
import { RolesManagerModal } from '../modals/RolesManagerModal'
import { ModerationLogModal } from '../modals/ModerationLogModal'
import type { Channel, Server } from '../../types/database'

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

function ChannelRow({
  channel,
  active,
  unread,
  isOwner,
  onSelect,
  onEdit,
  onMoveUp,
  onMoveDown,
}: {
  channel: Channel
  active: boolean
  unread: boolean
  isOwner: boolean
  onSelect: () => void
  onEdit: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  return (
    <div
      className={`group flex items-center gap-1.5 px-2 py-1.5 rounded text-sm font-medium transition-colors cursor-pointer
        ${active ? 'bg-discord-lighter text-white' : unread ? 'text-white' : 'text-discord-text-muted hover:bg-white/5 hover:text-discord-text'}
      `}
      onClick={onSelect}
    >
      <ChannelIcon type={channel.type} />
      <span className="truncate flex-1">{channel.name}</span>
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
  const { categories, channels, moveChannel, moveCategory } = useChannels(server.id)
  const { permissions } = useModeration(server.id)

  const [menuOpen, setMenuOpen] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showLeave, setShowLeave] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState<{ categoryId: string | null } | null>(null)
  const [showCreateCategory, setShowCreateCategory] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [showRoles, setShowRoles] = useState(false)
  const [showModeration, setShowModeration] = useState(false)

  const canManageChannels = isOwner || permissions.manage_channels
  const canManageRoles = isOwner || permissions.manage_roles
  const canViewAuditLog = isOwner || permissions.view_audit_log

  const uncategorized = channels.filter((c) => c.category_id === null).sort((a, b) => a.position - b.position)
  const sortedCategories = [...categories].sort((a, b) => a.position - b.position)

  return (
    <aside className="w-60 bg-discord-sidebar flex flex-col shrink-0">
      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="w-full h-12 px-4 flex items-center justify-between border-b border-black/20 shadow-sm text-white font-semibold text-left hover:bg-white/5 transition-colors"
        >
          <span className="truncate">{server.name}</span>
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
          <div className="space-y-0.5">
            {uncategorized.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                active={activeChannelId === channel.id}
                unread={unreadChannelIds.has(channel.id)}
                isOwner={isOwner}
                onSelect={() => onSelectChannel(channel)}
                onEdit={() => setEditingChannel(channel)}
                onMoveUp={() => moveChannel(channel.id, null, 'up')}
                onMoveDown={() => moveChannel(channel.id, null, 'down')}
              />
            ))}
          </div>
        )}

        {sortedCategories.map((category) => {
          const categoryChannels = channels
            .filter((c) => c.category_id === category.id)
            .sort((a, b) => a.position - b.position)

          return (
            <div key={category.id} className="group/category">
              <div className="px-1 mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-discord-text-muted tracking-wide">
                  {category.name}
                </span>
                {isOwner && (
                  <div className="hidden group-hover/category:flex items-center gap-1">
                    <button
                      title="Mover categoria para cima"
                      onClick={() => moveCategory(category.id, 'up')}
                      className="text-discord-text-muted hover:text-white"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
                        <path d="M12 8l-6 6h12l-6-6z" />
                      </svg>
                    </button>
                    <button
                      title="Mover categoria para baixo"
                      onClick={() => moveCategory(category.id, 'down')}
                      className="text-discord-text-muted hover:text-white"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
                        <path d="M12 16l6-6H6l6 6z" />
                      </svg>
                    </button>
                    <button
                      title="Criar canal nesta categoria"
                      onClick={() => setShowCreateChannel({ categoryId: category.id })}
                      className="text-discord-text-muted hover:text-white"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1z" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
              <div className="space-y-0.5">
                {categoryChannels.map((channel) => (
                  <ChannelRow
                    key={channel.id}
                    channel={channel}
                    active={activeChannelId === channel.id}
                    unread={unreadChannelIds.has(channel.id)}
                    isOwner={isOwner}
                    onSelect={() => onSelectChannel(channel)}
                    onEdit={() => setEditingChannel(channel)}
                    onMoveUp={() => moveChannel(channel.id, category.id, 'up')}
                    onMoveDown={() => moveChannel(channel.id, category.id, 'down')}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <UserPanel />

      {showInvite && <InviteModal serverId={server.id} onClose={() => setShowInvite(false)} />}
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
          serverId={server.id}
          categories={sortedCategories}
          defaultCategoryId={showCreateChannel.categoryId}
          onClose={() => setShowCreateChannel(null)}
        />
      )}
      {showCreateCategory && (
        <CreateCategoryModal serverId={server.id} onClose={() => setShowCreateCategory(false)} />
      )}
      {editingChannel && (
        <EditChannelModal
          serverId={server.id}
          channel={editingChannel}
          onClose={() => setEditingChannel(null)}
        />
      )}
      {showRoles && <RolesManagerModal serverId={server.id} onClose={() => setShowRoles(false)} />}
      {showModeration && <ModerationLogModal serverId={server.id} onClose={() => setShowModeration(false)} />}
    </aside>
  )
}
