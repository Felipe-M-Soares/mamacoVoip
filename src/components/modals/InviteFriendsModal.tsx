import { useState } from 'react'
import { Modal } from './Modal'
import { CheckMark, EmptyState } from './settingsUI'
import { Avatar } from '../ui/Avatar'
import { useAuth } from '../../hooks/useAuth'
import { useFriends } from '../../context/FriendsContext'
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
    <Modal
      title="Chamar amigos"
      description={
        channelName
          ? `Manda um convite direto por DM pra entrar na sala "${channelName}".`
          : 'Manda um convite direto por DM pra entrar neste servidor.'
      }
      onClose={onClose}
      footer={
        friends.length > 0 ? (
          <>
            <button onClick={onClose} className="btn-secondary h-9 px-4 text-sm">
              Fechar
            </button>
            <button onClick={handleSend} disabled={loading || selected.size === 0} className="btn-primary h-9 px-4 text-sm">
              {loading ? 'Enviando...' : `Chamar${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4">

        {friends.length === 0 ? (
          <EmptyState
            icon={
              <>
                <circle cx="9" cy="8" r="3.5" />
                <path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" />
              </>
            }
            title="Nenhum amigo ainda"
            hint="Você ainda não tem amigos adicionados. Adicione alguém na aba Amigos primeiro."
          />
        ) : (
          <div className="space-y-0.5 max-h-72 overflow-y-auto -mx-1 px-1">
            {friends.map((f) => (
              <label
                key={f.profile.id}
                className={`flex items-center gap-3 px-2.5 py-2 rounded-[10px] cursor-pointer transition-colors ${
                  selected.has(f.profile.id) ? 'bg-discord-blurple/[0.12]' : 'hover:bg-white/[0.05]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(f.profile.id)}
                  onChange={() => toggle(f.profile.id)}
                  className="sr-only peer"
                />
                <span className="rounded-md peer-focus-visible:ring-2 peer-focus-visible:ring-discord-blurple">
                  <CheckMark checked={selected.has(f.profile.id)} />
                </span>
                <Avatar name={f.profile.username} avatarUrl={f.profile.avatar_url} status={f.profile.status} userId={f.profile.id} size={32} />
                <span className="text-sm text-white flex-1 truncate">
                  {f.profile.display_name || f.profile.username}
                </span>
                {sentTo.has(f.profile.id) && <span className="chip !text-discord-green !border-discord-green/30 !bg-discord-green/10">Enviado</span>}
              </label>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
    </Modal>
  )
}
