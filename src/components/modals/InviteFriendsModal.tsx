import { useState } from 'react'
import { Modal } from './Modal'
import { Avatar } from '../ui/Avatar'
import { useAuth } from '../../hooks/useAuth'
import { useFriends } from '../../hooks/useFriends'
import { useServers } from '../../hooks/useServers'
import { useConversations } from '../../hooks/useConversations'
import { supabase } from '../../lib/supabase'
import { buildInviteMessage } from '../../lib/inviteMessage'

export function InviteFriendsModal({
  serverId,
  channelId,
  channelName,
  onClose,
}: {
  serverId: string
  channelId?: string
  channelName?: string
  onClose: () => void
}) {
  const { user } = useAuth()
  const { friends } = useFriends()
  const { servers, createInvite } = useServers()
  const { openConversationWith } = useConversations()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSend() {
    if (selected.size === 0 || !user) return
    setError(null)
    setLoading(true)

    const server = servers.find((s) => s.id === serverId)
    const { error: inviteError, invite } = await createInvite(serverId, undefined, 24 * 7)
    if (inviteError || !invite) {
      setError('Não foi possível gerar o convite.')
      setLoading(false)
      return
    }

    const message = buildInviteMessage({
      code: invite.code,
      serverId,
      serverName: server?.name ?? 'um servidor',
      channelId,
      channelName,
    })

    for (const friendId of selected) {
      const { conversation } = await openConversationWith(friendId)
      if (conversation) {
        await supabase
          .from('dm_messages')
          .insert({ conversation_id: conversation.id, author_id: user.id, content: message })
        setSentTo((prev) => new Set(prev).add(friendId))
      }
    }

    setLoading(false)
  }

  return (
    <Modal title="Chamar amigos" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-discord-text-muted">
          {channelName
            ? `Manda um convite direto por DM pra entrar na sala "${channelName}".`
            : 'Manda um convite direto por DM pra entrar neste servidor.'}
        </p>

        {friends.length === 0 ? (
          <p className="text-sm text-discord-text-muted">
            Você ainda não tem amigos adicionados. Adicione alguém na aba Amigos primeiro.
          </p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {friends.map((f) => (
              <label
                key={f.profile.id}
                className="flex items-center gap-3 px-2 py-2 rounded hover:bg-white/5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(f.profile.id)}
                  onChange={() => toggle(f.profile.id)}
                  className="w-4 h-4 accent-discord-blurple"
                />
                <Avatar name={f.profile.username} avatarUrl={f.profile.avatar_url} status={f.profile.status} size={32} />
                <span className="text-sm text-white flex-1 truncate">
                  {f.profile.display_name || f.profile.username}
                </span>
                {sentTo.has(f.profile.id) && <span className="text-xs text-discord-green">Enviado!</span>}
              </label>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        {friends.length > 0 && (
          <button
            onClick={handleSend}
            disabled={loading || selected.size === 0}
            className="w-full py-2.5 rounded btn-primary disabled:opacity-60"
          >
            {loading ? 'Enviando...' : `Chamar${selected.size > 0 ? ` (${selected.size})` : ''}`}
          </button>
        )}
      </div>
    </Modal>
  )
}
