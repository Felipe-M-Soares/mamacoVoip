import { useState } from 'react'
import { Modal } from './Modal'
import { Avatar } from '../ui/Avatar'
import { useAuth } from '../../hooks/useAuth'
import { useFriends } from '../../hooks/useFriends'
import { useConversations } from '../../hooks/useConversations'
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
        {targetProfile.custom_status && (
          <p className="text-sm text-discord-text mt-2">{targetProfile.custom_status}</p>
        )}

        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

        {!isSelf && (
          <div className="w-full space-y-2 mt-5">
            {!isBlocked && (
              <button
                onClick={handleMessage}
                disabled={loading}
                className="w-full py-2.5 rounded bg-discord-blurple text-white font-medium hover:bg-indigo-600 transition-colors disabled:opacity-60"
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
