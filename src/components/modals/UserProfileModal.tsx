import { useState } from 'react'
import { Modal } from './Modal'
import { Avatar } from '../ui/Avatar'
import { useAuth } from '../../hooks/useAuth'
import { useFriends } from '../../hooks/useFriends'
import { useConversations } from '../../hooks/useConversations'
import { getUserNote, setUserNote } from '../../lib/pinnedItems'
import type { Profile } from '../../types/database'

export function UserProfileModal({
  targetProfile,
  onClose,
  onOpenConversation,
}: {
  targetProfile: Profile
  onClose: () => void
  onOpenConversation: (conversationId: string) => void
}) {
  const { user } = useAuth()
  const { friends, incoming, outgoing, blocked, sendRequest, acceptRequest, declineRequest, removeFriend, blockUser, unblockUser } =
    useFriends()
  const { openConversationWith } = useConversations()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSelf = targetProfile.id === user?.id
  const friendship = friends.find((f) => f.profile.id === targetProfile.id)
  const incomingRequest = incoming.find((f) => f.profile.id === targetProfile.id)
  const outgoingRequest = outgoing.find((f) => f.profile.id === targetProfile.id)
  const isBlocked = blocked.some((b) => b.profile.id === targetProfile.id)
  const isFriend = Boolean(friendship) && friendship?.status === 'accepted'
  const isRestricted = !isSelf && !isFriend && targetProfile.profile_visibility === 'friends_only'

  async function handleMessage() {
    setLoading(true)
    const { error, conversation } = await openConversationWith(targetProfile.id)
    setLoading(false)
    if (error || !conversation) {
      setError(error ?? 'Não foi possível iniciar a conversa')
      return
    }
    onOpenConversation(conversation.id)
    onClose()
  }

  async function handleAction(action: () => Promise<{ error: string | null }>) {
    setError(null)
    setLoading(true)
    const { error } = await action()
    setLoading(false)
    if (error) setError(error)
  }

  return (
    <Modal title="Perfil" onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        <Avatar
          name={targetProfile.username}
          avatarUrl={targetProfile.avatar_url}
          status={targetProfile.status}
          size={72}
        />
        <h3 className="text-lg font-bold text-white mt-3">
          {targetProfile.display_name || targetProfile.username}
        </h3>
        <p className="text-sm text-discord-text-muted">@{targetProfile.username}</p>
        {isRestricted ? (
          <p className="text-xs text-discord-text-muted mt-2 flex items-center gap-1">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M12 2a5 5 0 0 0-5 5v3H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-1V7a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3z" />
            </svg>
            Este perfil é privado — só amigos veem mais detalhes
          </p>
        ) : (
          <>
            {targetProfile.playing && (
              <p className="text-sm text-discord-text-muted mt-2">🎮 Jogando {targetProfile.playing}</p>
            )}
            {targetProfile.custom_status && (
              <p className="text-sm text-discord-text mt-2">{targetProfile.custom_status}</p>
            )}
          </>
        )}

        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

        {!isSelf && <UserNoteField userId={targetProfile.id} />}

        {!isSelf && (
          <div className="w-full space-y-2 mt-5">
            {!isBlocked && (
              <button
                onClick={handleMessage}
                disabled={loading}
                className="w-full py-2.5 rounded btn-primary disabled:opacity-60"
              >
                Enviar mensagem
              </button>
            )}

            {isBlocked ? (
              <button
                onClick={() => handleAction(() => unblockUser(targetProfile.id))}
                disabled={loading}
                className="w-full py-2.5 rounded border border-discord-text-muted text-discord-text hover:bg-white/5 transition-colors disabled:opacity-60"
              >
                Desbloquear
              </button>
            ) : friendship ? (
              <button
                onClick={() => handleAction(() => removeFriend(targetProfile.id))}
                disabled={loading}
                className="w-full py-2.5 rounded border border-discord-text-muted text-discord-text hover:bg-white/5 transition-colors disabled:opacity-60"
              >
                Remover amigo
              </button>
            ) : incomingRequest ? (
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction(() => acceptRequest(incomingRequest.id))}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded bg-discord-green text-white font-medium hover:bg-green-600 transition-colors disabled:opacity-60"
                >
                  Aceitar
                </button>
                <button
                  onClick={() => handleAction(() => declineRequest(incomingRequest.id))}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded border border-discord-text-muted text-discord-text hover:bg-white/5 transition-colors disabled:opacity-60"
                >
                  Recusar
                </button>
              </div>
            ) : outgoingRequest ? (
              <button disabled className="w-full py-2.5 rounded bg-discord-darker text-discord-text-muted">
                Pedido enviado
              </button>
            ) : (
              <button
                onClick={() => handleAction(() => sendRequest(targetProfile.username))}
                disabled={loading}
                className="w-full py-2.5 rounded border border-discord-blurple text-discord-blurple hover:bg-discord-blurple/10 transition-colors disabled:opacity-60"
              >
                Adicionar amigo
              </button>
            )}

            {!isBlocked && (
              <button
                onClick={() => handleAction(() => blockUser(targetProfile.id))}
                disabled={loading}
                className="w-full py-2.5 rounded border border-red-600 text-red-500 hover:bg-red-600/10 transition-colors disabled:opacity-60"
              >
                Bloquear
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function UserNoteField({ userId }: { userId: string }) {
  const [note, setNote] = useState(() => getUserNote(userId))

  return (
    <div className="mt-3">
      <label className="block text-[10px] font-bold uppercase text-discord-text-muted mb-1">
        Nota — visível apenas para você
      </label>
      <textarea
        value={note}
        onChange={(e) => {
          setNote(e.target.value)
          setUserNote(userId, e.target.value)
        }}
        placeholder="Escreva uma nota..."
        maxLength={256}
        rows={2}
        className="w-full px-2.5 py-1.5 text-xs rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple resize-none"
      />
    </div>
  )
}
