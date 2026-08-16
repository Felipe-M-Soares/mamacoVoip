import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useServers } from '../../hooks/useServers'
import { useServerOrder } from '../../hooks/useLocalOrganization'
import { CreateOrJoinServerModal } from '../modals/CreateOrJoinServerModal'
import { InviteFriendsModal } from '../modals/InviteFriendsModal'
import { LeaveServerModal } from '../modals/LeaveServerModal'
import { ServerSettingsModal } from '../modals/ServerSettingsModal'
import { ContextMenu, useContextMenuState } from '../ui/ContextMenu'
import type { Server } from '../../types/database'

function ServerIcon({
  name,
  iconUrl,
  active,
  unread,
  draggable,
  isDragOver,
  onClick,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  variant = 'server',
}: {
  name: string
  iconUrl?: string | null
  active?: boolean
  unread?: boolean
  draggable?: boolean
  isDragOver?: boolean
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: () => void
  onDrop?: (e: React.DragEvent) => void
  variant?: 'server' | 'home' | 'add'
}) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div
      className="relative group"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
    >
      <span
        className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 bg-white rounded-r-full transition-all duration-150 ${
          active ? 'h-10' : 'h-0 group-hover:h-5'
        }`}
      />
      {unread && !active && (
        <span className="absolute -left-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full border-2 border-discord-darker" />
      )}
      <button
        onClick={onClick}
        title={name}
        className={`w-12 h-12 flex items-center justify-center font-medium text-white transition-all duration-150 overflow-hidden
          ${active ? 'rounded-2xl bg-discord-blurple brand-glow-sm' : 'rounded-3xl hover:rounded-2xl bg-discord-channels hover:bg-discord-blurple'}
          ${variant === 'add' ? 'text-discord-green hover:text-white' : ''}
          ${isDragOver ? 'ring-2 ring-discord-blurple' : ''}
          ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}
        `}
      >
        {iconUrl ? (
          <img src={iconUrl} alt={name} className="w-full h-full object-cover" />
        ) : variant === 'home' ? (
          <img src="/logo-192.png" alt="Início" className="w-full h-full object-cover" />
        ) : variant === 'add' ? (
          '+'
        ) : (
          initials
        )}
      </button>
    </div>
  )
}

export function ServerBar({
  activeServerId,
  unreadServerIds,
  onSelectServer,
  onSelectHome,
}: {
  activeServerId: string | null
  unreadServerIds: Set<string>
  onSelectServer: (server: Server) => void
  onSelectHome: () => void
}) {
  const { user } = useAuth()
  const { servers, loading } = useServers()
  const { sortByOrder, moveServer } = useServerOrder()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [contextServer, setContextServer] = useState<Server | null>(null)
  const [showInviteFor, setShowInviteFor] = useState<Server | null>(null)
  const [showLeaveFor, setShowLeaveFor] = useState<Server | null>(null)
  const [showSettingsFor, setShowSettingsFor] = useState<Server | null>(null)
  const { menuState, openMenu, closeMenu } = useContextMenuState()

  const orderedServers = sortByOrder(servers)

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    setDragOverId(null)
    const sourceId = e.dataTransfer.getData('text/plain')
    setDraggedId(null)
    if (!sourceId || sourceId === targetId) return
    moveServer(
      sourceId,
      targetId,
      servers.map((s) => s.id)
    )
  }

  function handleServerContextMenu(e: React.MouseEvent, server: Server) {
    setContextServer(server)
    openMenu(e)
  }

  return (
    <>
      <nav className="w-[72px] bg-discord-darker flex flex-col items-center py-3 gap-2 shrink-0 overflow-y-auto">
        <ServerIcon name="Início" variant="home" active={activeServerId === null} onClick={onSelectHome} />
        <div className="w-8 h-px bg-discord-channels rounded-full my-1" />

        {!loading &&
          orderedServers.map((server) => (
            <ServerIcon
              key={server.id}
              name={server.name}
              iconUrl={server.icon_url}
              active={activeServerId === server.id}
              unread={unreadServerIds.has(server.id)}
              draggable
              isDragOver={dragOverId === server.id && draggedId !== server.id}
              onClick={() => onSelectServer(server)}
              onContextMenu={(e) => handleServerContextMenu(e, server)}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', server.id)
                e.dataTransfer.effectAllowed = 'move'
                setDraggedId(server.id)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOverId(server.id)
              }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={(e) => handleDrop(e, server.id)}
            />
          ))}

        <ServerIcon name="Adicionar um servidor" variant="add" onClick={() => setShowCreateModal(true)} />
      </nav>

      {showCreateModal && <CreateOrJoinServerModal onClose={() => setShowCreateModal(false)} />}

      {menuState && contextServer && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          onClose={closeMenu}
          items={[
            {
              label: 'Abrir servidor',
              onClick: () => onSelectServer(contextServer),
            },
            {
              label: 'Convidar amigos',
              onClick: () => setShowInviteFor(contextServer),
            },
            {
              label: 'Configurações do servidor',
              onClick: () => setShowSettingsFor(contextServer),
            },
            contextServer.owner_id === user?.id
              ? {
                  label: 'Excluir servidor',
                  danger: true,
                  divider: true,
                  onClick: () => setShowSettingsFor(contextServer),
                }
              : {
                  label: 'Sair do servidor',
                  danger: true,
                  divider: true,
                  onClick: () => setShowLeaveFor(contextServer),
                },
          ]}
        />
      )}

      {showInviteFor && (
        <InviteFriendsModal serverId={showInviteFor.id} onClose={() => setShowInviteFor(null)} />
      )}
      {showLeaveFor && (
        <LeaveServerModal
          serverId={showLeaveFor.id}
          serverName={showLeaveFor.name}
          onClose={() => setShowLeaveFor(null)}
          onLeft={() => setShowLeaveFor(null)}
        />
      )}
      {showSettingsFor && (
        <ServerSettingsModal
          server={showSettingsFor}
          isOwner={showSettingsFor.owner_id === user?.id}
          onClose={() => setShowSettingsFor(null)}
          onDeleted={() => setShowSettingsFor(null)}
        />
      )}
    </>
  )
}
