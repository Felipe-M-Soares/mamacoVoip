import { describeMessageContent, parseStickerId } from '../../lib/stickers'
import { useState } from 'react'
import { Modal } from './Modal'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Channel, Message, Profile } from '../../types/database'
import { EmptyState } from './settingsUI'

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
    // Figurinha: reenvia só o marcador (com o prefixo de texto ela deixaria
    // de ser reconhecida como figurinha e apareceria como "[[sticker:…]]").
    const content = parseStickerId(message.content)
      ? message.content.trim()
      : `↪ Encaminhado de **${authorName}**:\n${message.content}`
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
    <Modal title="Encaminhar mensagem" description="Escolha o canal (só canais de texto deste servidor)." onClose={onClose}>
      <div className="rounded-xl bg-mv-canvas/60 border border-[var(--color-line)] px-3.5 py-2.5 mb-3">
        <p className="text-[12px] text-mv-muted">
          Mensagem de <span className="text-mv-text font-medium">{author?.display_name || author?.username || 'alguém'}</span>
        </p>
        <p className="text-[13.5px] text-mv-text line-clamp-2 mt-0.5">{describeMessageContent(message.content)}</p>
      </div>
      <div className="space-y-0.5">
        {textChannels.length === 0 ? (
          <EmptyState icon={<path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18" />} title="Nenhum canal de texto encontrado" />
        ) : (
          textChannels.map((c) => (
            <button
              key={c.id}
              onClick={() => handleForward(c.id)}
              disabled={sendingTo === c.id}
              className="group w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg hover:bg-white/[0.05] text-left disabled:opacity-60 transition-colors"
            >
              <span className="text-mv-muted text-[17px] leading-none w-4 text-center">#</span>
              <span className="flex-1 text-[14px] text-mv-text truncate">{c.name}</span>
              {sentTo.has(c.id) ? (
                <span className="chip !text-mv-green !border-mv-green/30 !bg-mv-green/10">Enviado</span>
              ) : sendingTo === c.id ? (
                <span className="text-xs text-mv-muted">Enviando...</span>
              ) : (
                <span className="text-[12px] font-medium text-mv-muted opacity-0 group-hover:opacity-100 transition-opacity">
                  Enviar
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </Modal>
  )
}
