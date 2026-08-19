import { useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { useFriends } from '../../context/FriendsContext'
import { useConversations } from '../../hooks/useConversations'
import type { ProfileStatus } from '../../types/database'

type Tab = 'online' | 'all' | 'pending' | 'blocked'

export function FriendsPanel({ onOpenConversation }: { onOpenConversation: (conversationId: string) => void }) {
  const { friends, incoming, outgoing, blocked, sendRequest, acceptRequest, declineRequest, removeFriend, unblockUser } =
    useFriends()
  const { openConversationWith } = useConversations()
  const [tab, setTab] = useState<Tab>('online')
  const [addUsername, setAddUsername] = useState('')
  const [addNote, setAddNote] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addSuccess, setAddSuccess] = useState<string | null>(null)

  const onlineFriends = friends.filter((f) => f.profile.status !== 'offline')
  const pendingCount = incoming.length + outgoing.length

  async function handleSendRequest() {
    setAddError(null)
    setAddSuccess(null)
    if (addUsername.trim().length === 0) return
    const { error } = await sendRequest(addUsername.trim(), addNote.trim() || undefined)
    if (error) {
      setAddError(error)
      return
    }
    setAddSuccess(`Pedido enviado para ${addUsername.trim()}!`)
    setAddUsername('')
    setAddNote('')
  }

  async function handleMessage(userId: string) {
    const { conversation } = await openConversationWith(userId)
    if (conversation) onOpenConversation(conversation.id)
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'online', label: 'Online' },
    { id: 'all', label: 'Todos' },
    { id: 'pending', label: `Pendentes${pendingCount > 0 ? ` (${pendingCount})` : ''}` },
    { id: 'blocked', label: 'Bloqueados' },
  ]

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-discord-channels">
      <header className="h-12 px-4 flex items-center gap-4 border-b border-black/20 shadow-sm shrink-0">
        <div className="flex items-center gap-2 text-white font-semibold">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-discord-text-muted">
            <path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
          </svg>
          Amigos
        </div>
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-2 py-1 rounded text-sm font-medium transition-colors ${
                tab === t.id ? 'bg-discord-lighter text-white' : 'text-discord-text-muted hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="p-4 border-b border-black/20">
        <p className="text-xs font-bold uppercase text-discord-text-muted mb-2">Adicionar amigo</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={addUsername}
            onChange={(e) => setAddUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendRequest()}
            placeholder="Digite um nome de usuário"
            className="flex-1 px-3 py-2 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple text-sm"
          />
          <button
            onClick={handleSendRequest}
            className="px-4 py-2 rounded btn-primary text-sm shrink-0"
          >
            Enviar pedido
          </button>
        </div>
        <input
          type="text"
          value={addNote}
          onChange={(e) => setAddNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSendRequest()}
          placeholder="Adicionar uma nota (opcional) — ex: 'a gente jogou junto ontem'"
          maxLength={200}
          className="w-full mt-2 px-3 py-2 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple text-xs"
        />
        {addError && <p className="text-sm text-red-400 mt-2">{addError}</p>}
        {addSuccess && <p className="text-sm text-discord-green mt-2">{addSuccess}</p>}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'online' && (
          <FriendGrid friends={onlineFriends} emptyText="Ninguém online agora." onMessage={handleMessage} onRemove={removeFriend} />
        )}
        {tab === 'all' && (
          <FriendGrid friends={friends} emptyText="Você ainda não tem amigos. Adicione alguém acima!" onMessage={handleMessage} onRemove={removeFriend} />
        )}
        {tab === 'pending' && (
          <div className="space-y-4">
            {incoming.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase text-discord-text-muted mb-2">
                  Pedidos recebidos — {incoming.length}
                </p>
                <div className="space-y-1">
                  {incoming.map((req) => (
                    <div key={req.id} className="flex items-center gap-3 px-2 py-2 rounded hover:bg-white/5">
                      <Avatar name={req.profile.username} avatarUrl={req.profile.avatar_url} size={36} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-white truncate block">
                          {req.profile.display_name || req.profile.username}
                        </span>
                        {req.request_note && (
                          <span className="text-xs text-discord-text-muted italic truncate block">
                            "{req.request_note}"
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => acceptRequest(req.id)}
                        className="px-3 py-1 rounded bg-discord-green text-white text-xs font-medium hover:bg-green-600"
                      >
                        Aceitar
                      </button>
                      <button
                        onClick={() => declineRequest(req.id)}
                        className="px-3 py-1 rounded bg-discord-darker text-discord-text text-xs font-medium hover:bg-discord-lighter"
                      >
                        Recusar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {outgoing.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase text-discord-text-muted mb-2">
                  Pedidos enviados — {outgoing.length}
                </p>
                <div className="space-y-1">
                  {outgoing.map((req) => (
                    <div key={req.id} className="flex items-center gap-3 px-2 py-2 rounded hover:bg-white/5">
                      <Avatar name={req.profile.username} avatarUrl={req.profile.avatar_url} size={36} />
                      <span className="flex-1 text-sm text-white truncate">
                        {req.profile.display_name || req.profile.username}
                      </span>
                      <span className="text-xs text-discord-text-muted">Pendente</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {incoming.length === 0 && outgoing.length === 0 && (
              <p className="text-discord-text-muted text-sm">Nenhum pedido pendente.</p>
            )}
          </div>
        )}
        {tab === 'blocked' && (
          <div className="space-y-1">
            {blocked.length === 0 ? (
              <p className="text-discord-text-muted text-sm">Você não bloqueou ninguém.</p>
            ) : (
              blocked.map((b) => (
                <div key={b.blocked_id} className="flex items-center gap-3 px-2 py-2 rounded hover:bg-white/5">
                  <Avatar name={b.profile.username} avatarUrl={b.profile.avatar_url} size={36} />
                  <span className="flex-1 text-sm text-white truncate">
                    {b.profile.display_name || b.profile.username}
                  </span>
                  <button
                    onClick={() => unblockUser(b.blocked_id)}
                    className="px-3 py-1 rounded bg-discord-darker text-discord-text text-xs font-medium hover:bg-discord-lighter"
                  >
                    Desbloquear
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function FriendGrid({
  friends,
  emptyText,
  onMessage,
  onRemove,
}: {
  friends: { profile: { id: string; username: string; display_name: string | null; avatar_url: string | null; status: ProfileStatus; custom_status: string | null } }[]
  emptyText: string
  onMessage: (userId: string) => void
  onRemove: (userId: string) => void
}) {
  if (friends.length === 0) {
    return <p className="text-discord-text-muted text-sm">{emptyText}</p>
  }
  return (
    <div className="space-y-1">
      {friends.map((f) => (
        <div key={f.profile.id} className="flex items-center gap-3 px-2 py-2 rounded hover:bg-white/5 group">
          <Avatar name={f.profile.username} avatarUrl={f.profile.avatar_url} status={f.profile.status} size={36} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white truncate">{f.profile.display_name || f.profile.username}</p>
            <p className="text-xs text-discord-text-muted truncate">
              {f.profile.custom_status || f.profile.status}
            </p>
          </div>
          <button
            onClick={() => onMessage(f.profile.id)}
            title="Enviar mensagem"
            className="opacity-0 group-hover:opacity-100 w-8 h-8 flex items-center justify-center rounded-full bg-discord-darker hover:bg-discord-lighter text-discord-text-muted hover:text-white transition-opacity"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M5.5 4.5c.5-.5 1.2-.8 2-.8h1.4l-.3 15h-1c-.8 0-1.5-.3-2-.8-.6-.5-.9-1.2-.9-2v-9.4c0-.8.3-1.5.8-2zm10 0c.5.5.8 1.2.8 2v9.4c0 .8-.3 1.5-.8 2-.5.5-1.2.8-2 .8h-1l-.3-15h1.4c.8 0 1.5.3 2 .8z" />
            </svg>
          </button>
          <button
            onClick={() => onRemove(f.profile.id)}
            title="Remover amigo"
            className="opacity-0 group-hover:opacity-100 w-8 h-8 flex items-center justify-center rounded-full bg-discord-darker hover:bg-red-600/20 text-discord-text-muted hover:text-red-400 transition-opacity"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
