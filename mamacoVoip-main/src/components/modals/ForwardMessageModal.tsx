import { useState } from 'react'
import { Modal } from './Modal'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Channel, Message, Profile } from '../../types/database'

export function ForwardMessageModal({
  message,
  author,
  channels,
  serverId,
  onClose,
}: {
  message: Message
  author: Profile | undefined
  channels: Channel[]
  serverId: string
  onClose: () => void
}) {
  const { user } = useAuth()
  const [sendingTo, setSendingTo] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<Set<string>>(new Set())
  const textChannels = channels.filter((c) => c.type === 'text')

  async function handleForward(channelId: string) {
    if (!user) return
    setSendingTo(channelId)
    const authorName = author?.display_name || author?.username || 'alguém'
    const content = `↪ Encaminhado de **${authorName}**:\n${message.content}`
    await supabase.from('messages').insert({
      channel_id: channelId,
      server_id: serverId,
      author_id: user.id,
      content,
    })
    setSendingTo(null)
    setSentTo((prev) => new Set(prev).add(channelId))
  }

  return (
    <Modal title="Encaminhar mensagem" onClose={onClose}>
      <div className="space-y-1">
        <p className="text-xs text-discord-text-muted mb-3">Escolha o canal (só canais de texto deste servidor).</p>
        {textChannels.length === 0 ? (
          <p className="text-sm text-discord-text-muted">Nenhum canal de texto encontrado.</p>
        ) : (
          textChannels.map((c) => (
            <button
              key={c.id}
              onClick={() => handleForward(c.id)}
              disabled={sendingTo === c.id}
              className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-white/5 text-left disabled:opacity-60"
            >
              <span className="text-sm text-discord-text">#{c.name}</span>
              {sentTo.has(c.id) ? (
                <span className="text-xs text-discord-green">Enviado ✓</span>
              ) : sendingTo === c.id ? (
                <span className="text-xs text-discord-text-muted">Enviando...</span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </Modal>
  )
}
