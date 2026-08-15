import { useState } from 'react'
import { useServers } from '../../hooks/useServers'
import { CreateOrJoinServerModal } from '../modals/CreateOrJoinServerModal'
import type { Server } from '../../types/database'

function ServerIcon({
  name,
  iconUrl,
  active,
  unread,
  onClick,
  variant = 'server',
}: {
  name: string
  iconUrl?: string | null
  active?: boolean
  unread?: boolean
  onClick?: () => void
  variant?: 'server' | 'home' | 'add'
}) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="relative group">
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
          ${active ? 'rounded-2xl bg-discord-blurple' : 'rounded-3xl hover:rounded-2xl bg-discord-channels hover:bg-discord-blurple'}
          ${variant === 'add' ? 'text-discord-green hover:text-white' : ''}
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
  const { servers, loading } = useServers()
  const [showCreateModal, setShowCreateModal] = useState(false)

  return (
    <>
      <nav className="w-[72px] bg-discord-darker flex flex-col items-center py-3 gap-2 shrink-0 overflow-y-auto">
        <ServerIcon name="Início" variant="home" active={activeServerId === null} onClick={onSelectHome} />
        <div className="w-8 h-px bg-discord-channels rounded-full my-1" />

        {!loading &&
          servers.map((server) => (
            <ServerIcon
              key={server.id}
              name={server.name}
              iconUrl={server.icon_url}
              active={activeServerId === server.id}
              unread={unreadServerIds.has(server.id)}
              onClick={() => onSelectServer(server)}
            />
          ))}

        <ServerIcon name="Adicionar um servidor" variant="add" onClick={() => setShowCreateModal(true)} />
      </nav>

      {showCreateModal && <CreateOrJoinServerModal onClose={() => setShowCreateModal(false)} />}
    </>
  )
}
