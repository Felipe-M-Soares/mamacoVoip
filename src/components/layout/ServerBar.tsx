import { identityGradient } from '../../lib/identityColor'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useServers } from '../../hooks/useServers'
import { useServerOrder } from '../../hooks/useLocalOrganization'
import { ContextMenu, useContextMenuState } from '../ui/ContextMenu'
import { ServerHoverCard } from './ServerHoverCard'
import { supabase } from '../../lib/supabase'
import type { Server, Channel } from '../../types/database'
import { lazyModal } from '../modals/lazyModal'
import { PlusIcon } from '../ui/icons'

// Modais/painéis carregados só quando abertos (fora do pacote inicial).
const CreateOrJoinServerModal = lazyModal(() => import('../modals/CreateOrJoinServerModal').then((m) => m.CreateOrJoinServerModal))
const InviteFriendsModal = lazyModal(() => import('../modals/InviteFriendsModal').then((m) => m.InviteFriendsModal))
const LeaveServerModal = lazyModal(() => import('../modals/LeaveServerModal').then((m) => m.LeaveServerModal))
const ServerSettingsModal = lazyModal(() => import('../modals/ServerSettingsModal').then((m) => m.ServerSettingsModal))
const ReportsPanel = lazyModal(() => import('../modals/ReportsPanel').then((m) => m.ReportsPanel))

function ServerIcon({
  name,
  iconUrl,
  active,
  unread,
  draggable,
  isDragOver,
  onClick,
  onContextMenu,
  onMouseEnter,
  onMouseLeave,
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
  onMouseEnter?: (e: React.MouseEvent) => void
  onMouseLeave?: () => void
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

  // Gradiente de identidade por servidor (ver lib/identityColor) —
  // paleta curada em vez de um hue aleatório 0-360.
  const gradient = identityGradient(name)

  return (
    <div
      className="relative group"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span
        className={`absolute -left-3 top-1/2 -translate-y-1/2 w-1 rounded-r-full transition-all duration-150 ${
          active ? 'h-9 bg-brand-gradient' : unread ? 'h-2 bg-mv-text' : 'h-0 bg-mv-text group-hover:h-4'
        }`}
      />
      <button
        onClick={onClick}
        title={name}
        style={!iconUrl && variant === 'server' ? { background: gradient } : undefined}
        aria-label={name}
        aria-current={active ? 'page' : undefined}
        className={`w-12 h-12 flex items-center justify-center font-display font-semibold text-white text-[15px] transition-all duration-150 overflow-hidden
          ${active ? 'rounded-[16px] ring-2 ring-mv-accent/70 ring-offset-2 ring-offset-mv-canvas' : 'rounded-[18px] hover:rounded-[14px] hover:-translate-y-px'}
          ${variant === 'server' && !iconUrl ? (active ? '' : 'saturate-[.85] hover:saturate-100') : variant === 'add' ? '' : active ? 'bg-mv-raised' : 'bg-mv-raised/70 hover:bg-mv-raised'}
          ${variant === 'add' ? 'text-2xl font-light text-mv-muted border border-dashed border-white/15 hover:border-mv-green hover:text-mv-green hover:bg-mv-green/10' : ''}
          ${isDragOver ? 'ring-2 ring-mv-accent' : ''}
          ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}
        `}
      >
        {iconUrl ? (
          <img src={iconUrl} alt={name} className="w-full h-full object-cover" />
        ) : variant === 'home' ? (
          <img src="/logo-192.png" alt="" className="w-full h-full object-cover" />
        ) : variant === 'add' ? (
          <PlusIcon className="w-6 h-6" strokeWidth={2.25} aria-hidden />
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
  const [showReportsFor, setShowReportsFor] = useState<Server | null>(null)
  const [settingsChannels, setSettingsChannels] = useState<Channel[]>([])

  useEffect(() => {
    if (!showSettingsFor) {
      setSettingsChannels([])
      return
    }
    supabase
      .from('channels')
      .select('*')
      .eq('server_id', showSettingsFor.id)
      .then(({ data }) => setSettingsChannels(data ?? []))
  }, [showSettingsFor])
  const { menuState, openMenu, closeMenu } = useContextMenuState()

  // Card de "quem está online" ao passar o mouse por cima de um
  // servidor — ver ServerHoverCard.tsx. Só mostra depois de um pequeno
  // atraso (300ms) parado em cima do ícone, pra não ficar piscando um
  // card pra cada servidor enquanto o mouse só está passando por cima
  // deles a caminho de outro lugar.
  const [hoverInfo, setHoverInfo] = useState<{ server: Server; rect: DOMRect } | null>(null)
  const hoverTimerRef = useRef<number | null>(null)

  function handleServerMouseEnter(e: React.MouseEvent, server: Server) {
    const rect = e.currentTarget.getBoundingClientRect()
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = window.setTimeout(() => setHoverInfo({ server, rect }), 300)
  }
  function handleServerMouseLeave() {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = null
    setHoverInfo(null)
  }
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
    }
  }, [])

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
    handleServerMouseLeave()
    setContextServer(server)
    openMenu(e)
  }

  return (
    <>
      <nav aria-label="Servidores" className="w-[72px] bg-mv-canvas flex flex-col items-center py-3 gap-2.5 shrink-0 overflow-y-auto overflow-x-hidden [scrollbar-width:none]">
        <ServerIcon name="Início" variant="home" active={activeServerId === null} onClick={onSelectHome} />
        <div className="w-8 h-px bg-white/10 rounded-full my-0.5" />

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
              onMouseEnter={(e) => handleServerMouseEnter(e, server)}
              onMouseLeave={handleServerMouseLeave}
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

      {hoverInfo && !menuState && !draggedId && (
        <ServerHoverCard server={hoverInfo.server} anchorRect={hoverInfo.rect} />
      )}

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
            ...(contextServer.owner_id === user?.id
              ? [
                  {
                    label: 'Denúncias',
                    onClick: () => setShowReportsFor(contextServer),
                  },
                ]
              : []),
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
      {showReportsFor && (
        <ReportsPanel serverId={showReportsFor.id} onClose={() => setShowReportsFor(null)} />
      )}
      {showSettingsFor && (
        <ServerSettingsModal
          server={showSettingsFor}
          isOwner={showSettingsFor.owner_id === user?.id}
          channels={settingsChannels}
          onClose={() => setShowSettingsFor(null)}
          onDeleted={() => setShowSettingsFor(null)}
        />
      )}
    </>
  )
}
