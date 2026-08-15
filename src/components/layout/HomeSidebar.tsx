import { Avatar } from '../ui/Avatar'
import { UserPanel } from './UserPanel'
import { useConversations } from '../../hooks/useConversations'

export function HomeSidebar({
  view,
  activeConversationId,
  unreadConversationIds,
  onSelectFriends,
  onSelectConversation,
}: {
  view: 'friends' | 'conversation'
  activeConversationId: string | null
  unreadConversationIds: Set<string>
  onSelectFriends: () => void
  onSelectConversation: (conversationId: string) => void
}) {
  const { conversations, loading } = useConversations()

  return (
    <aside className="w-60 bg-discord-sidebar flex flex-col shrink-0">
      <div className="h-12 px-4 flex items-center gap-2 border-b border-black/20 shadow-sm shrink-0">
        <img src="/logo-192.png" alt="Mamacos Voip" className="w-6 h-6 rounded-full object-cover shrink-0" />
        <span className="text-white font-semibold truncate">Mamacos Voip</span>
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

        <div className="px-2 mt-4 mb-1 text-xs font-semibold text-discord-text-muted tracking-wide">
          MENSAGENS DIRETAS
        </div>

        {loading ? (
          <div className="flex justify-center pt-4">
            <div className="w-4 h-4 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-2 text-xs text-discord-text-muted">Nenhuma conversa ainda.</p>
        ) : (
          <div className="space-y-0.5">
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelectConversation(c.id)}
                className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors ${
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
                {unreadConversationIds.has(c.id) && <span className="w-2 h-2 rounded-full bg-white shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <UserPanel />
    </aside>
  )
}
