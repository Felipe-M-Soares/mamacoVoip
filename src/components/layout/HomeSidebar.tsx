import { useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { UserPanel } from './UserPanel'
import { useConversations } from '../../hooks/useConversations'
import { useGroupConversations } from '../../hooks/useGroupConversations'
import { usePinnedItems } from '../../hooks/usePinnedItems'
import { CreateGroupModal } from '../modals/CreateGroupModal'
import { useAuth } from '../../hooks/useAuth'

export function HomeSidebar({
  view,
  activeConversationId,
  activeGroupId,
  unreadConversationIds,
  onSelectFriends,
  onSelectConversation,
  onSelectGroup,
}: {
  view: 'friends' | 'conversation' | 'group'
  activeConversationId: string | null
  activeGroupId: string | null
  unreadConversationIds: Set<string>
  onSelectFriends: () => void
  onSelectConversation: (conversationId: string) => void
  onSelectGroup: (groupId: string) => void
}) {
  const { user } = useAuth()
  const { conversations, loading } = useConversations()
  const { groups } = useGroupConversations()
  const { pinnedIds, toggle: togglePin } = usePinnedItems()
  const [showCreateGroup, setShowCreateGroup] = useState(false)

  return (
    <aside className="w-60 bg-discord-sidebar flex flex-col shrink-0">
      <div className="h-12 px-4 flex items-center gap-2 border-b border-black/20 shadow-sm shrink-0">
        <img src="/logo-192.png" alt="Mamacos Voip" className="w-6 h-6 rounded-full object-cover shrink-0" />
        <span className="font-display text-white font-bold tracking-wide truncate">Mamacos Voip</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <button
          onClick={onSelectFriends}
          className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm font-medium transition-colors ${
            view === 'friends' ? 'bg-discord-lighter text-white' : 'text-discord-text-muted hover:bg-white/5 hover:text-discord-text'
          }`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 shrink-0">
            <path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
          </svg>
          Amigos
        </button>

        <div className="px-2 mt-4 mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-discord-text-muted tracking-wide">MENSAGENS DIRETAS</span>
        </div>

        {(() => {
          const pinnedConversations = conversations.filter((c) => pinnedIds.has(c.id))
          const pinnedGroups = groups.filter((g) => pinnedIds.has(g.id))
          if (pinnedConversations.length === 0 && pinnedGroups.length === 0) return null
          return (
            <div className="mb-3">
              <p className="px-2 mb-1 text-[10px] font-semibold text-discord-text-muted tracking-wide">FIXADOS</p>
              <div className="space-y-0.5">
                {pinnedConversations.map((c) => (
                  <button
                    key={`pinned-conv-${c.id}`}
                    onClick={() => onSelectConversation(c.id)}
                    className={`group w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors ${
                      view === 'conversation' && activeConversationId === c.id
                        ? 'bg-discord-lighter text-white'
                        : 'text-discord-text-muted hover:bg-white/5 hover:text-discord-text'
                    }`}
                  >
                    <Avatar name={c.otherProfile.username} avatarUrl={c.otherProfile.avatar_url} status={c.otherProfile.status} size={28} />
                    <span className="truncate font-medium flex-1 text-left">
                      {c.otherProfile.display_name || c.otherProfile.username}
                    </span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        togglePin(c.id)
                      }}
                      title="Desafixar"
                      className="opacity-0 group-hover:opacity-100 text-yellow-400"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M16 3l5 5-3.5 3.5L19 14l-1.4 1.4-3.5-2.5L10.5 16.5 9 15l3.6-3.6L10 8.9 13.5 5.4 16 3z" />
                      </svg>
                    </span>
                  </button>
                ))}
                {pinnedGroups.map((g) => {
                  const others = g.members.filter((m) => m.id !== user?.id)
                  const title = g.name || others.map((m) => m.display_name || m.username).join(', ')
                  return (
                    <button
                      key={`pinned-group-${g.id}`}
                      onClick={() => onSelectGroup(g.id)}
                      className={`group w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors ${
                        view === 'group' && activeGroupId === g.id
                          ? 'bg-discord-lighter text-white'
                          : 'text-discord-text-muted hover:bg-white/5 hover:text-discord-text'
                      }`}
                    >
                      <div className="flex -space-x-2 shrink-0">
                        {others.slice(0, 2).map((m) => (
                          <Avatar key={m.id} name={m.username} avatarUrl={m.avatar_url} size={28} />
                        ))}
                      </div>
                      <span className="truncate font-medium text-left flex-1">{title}</span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation()
                          togglePin(g.id)
                        }}
                        title="Desafixar"
                        className="opacity-0 group-hover:opacity-100 text-yellow-400 shrink-0"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                          <path d="M16 3l5 5-3.5 3.5L19 14l-1.4 1.4-3.5-2.5L10.5 16.5 9 15l3.6-3.6L10 8.9 13.5 5.4 16 3z" />
                        </svg>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {loading ? (
          <div className="flex justify-center pt-4">
            <div className="w-4 h-4 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
          </div>
        ) : conversations.filter((c) => !pinnedIds.has(c.id)).length === 0 ? (
          <p className="px-2 text-xs text-discord-text-muted">Nenhuma conversa ainda.</p>
        ) : (
          <div className="space-y-0.5">
            {conversations.filter((c) => !pinnedIds.has(c.id)).map((c) => (
              <button
                key={c.id}
                onClick={() => onSelectConversation(c.id)}
                className={`group w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors ${
                  view === 'conversation' && activeConversationId === c.id
                    ? 'bg-discord-lighter text-white'
                    : 'text-discord-text-muted hover:bg-white/5 hover:text-discord-text'
                }`}
              >
                <Avatar
                  name={c.otherProfile.username}
                  avatarUrl={c.otherProfile.avatar_url}
                  status={c.otherProfile.status}
                  size={32}
                />
                <div className="min-w-0 text-left flex-1">
                  <p className="truncate font-medium">{c.otherProfile.display_name || c.otherProfile.username}</p>
                  {c.lastMessage && (
                    <p className="truncate text-xs text-discord-text-muted">{c.lastMessage.content}</p>
                  )}
                </div>
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePin(c.id)
                  }}
                  title={pinnedIds.has(c.id) ? 'Desafixar' : 'Fixar no topo'}
                  className={`shrink-0 ${pinnedIds.has(c.id) ? 'text-yellow-400' : 'opacity-0 group-hover:opacity-100 text-discord-text-muted hover:text-white'}`}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                    <path d="M16 3l5 5-3.5 3.5L19 14l-1.4 1.4-3.5-2.5L10.5 16.5 9 15l3.6-3.6L10 8.9 13.5 5.4 16 3z" />
                  </svg>
                </span>
                {unreadConversationIds.has(c.id) && <span className="w-2 h-2 rounded-full bg-white shrink-0" />}
              </button>
            ))}
          </div>
        )}

        <div className="px-2 mt-4 mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-discord-text-muted tracking-wide">GRUPOS</span>
          <button
            onClick={() => setShowCreateGroup(true)}
            title="Criar grupo"
            className="text-discord-text-muted hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M12 2a1 1 0 0 1 1 1v8h8a1 1 0 1 1 0 2h-8v8a1 1 0 1 1-2 0v-8H3a1 1 0 1 1 0-2h8V3a1 1 0 0 1 1-1z" />
            </svg>
          </button>
        </div>

        {groups.filter((g) => !pinnedIds.has(g.id)).length === 0 ? (
          <p className="px-2 text-xs text-discord-text-muted">Nenhum grupo ainda.</p>
        ) : (
          <div className="space-y-0.5">
            {groups.filter((g) => !pinnedIds.has(g.id)).map((g) => {
              const others = g.members.filter((m) => m.id !== user?.id)
              const title = g.name || others.map((m) => m.display_name || m.username).join(', ')
              return (
                <button
                  key={g.id}
                  onClick={() => onSelectGroup(g.id)}
                  className={`group w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors ${
                    view === 'group' && activeGroupId === g.id
                      ? 'bg-discord-lighter text-white'
                      : 'text-discord-text-muted hover:bg-white/5 hover:text-discord-text'
                  }`}
                >
                  <div className="flex -space-x-2 shrink-0">
                    {others.slice(0, 2).map((m) => (
                      <Avatar key={m.id} name={m.username} avatarUrl={m.avatar_url} size={28} />
                    ))}
                  </div>
                  <span className="truncate font-medium text-left flex-1">{title}</span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      togglePin(g.id)
                    }}
                    title="Fixar no topo"
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-discord-text-muted hover:text-white"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M16 3l5 5-3.5 3.5L19 14l-1.4 1.4-3.5-2.5L10.5 16.5 9 15l3.6-3.6L10 8.9 13.5 5.4 16 3z" />
                    </svg>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {showCreateGroup && (
        <CreateGroupModal
          onClose={() => setShowCreateGroup(false)}
          onCreated={(groupId) => {
            setShowCreateGroup(false)
            onSelectGroup(groupId)
          }}
        />
      )}

      <UserPanel />
    </aside>
  )
}
