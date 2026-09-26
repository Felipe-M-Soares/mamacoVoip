import { useEffect, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import type { Message, Profile } from '../../types/database'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function PinnedMessagesPanel({
  fetchPinnedMessages,
  profilesById,
  canUnpin,
  onUnpin,
  onClose,
}: {
  fetchPinnedMessages: () => Promise<Message[]>
  profilesById: Record<string, Profile>
  canUnpin: boolean
  onUnpin: (messageId: string) => void
  onClose: () => void
}) {
  const [pinned, setPinned] = useState<Message[] | null>(null)

  useEffect(() => {
    fetchPinnedMessages().then(setPinned)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-[300] bg-black/50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-sm h-full bg-discord-channels border-l border-black/30 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-12 px-4 flex items-center justify-between border-b border-black/20 shrink-0">
          <h2 className="font-display font-semibold text-white tracking-wide">Mensagens fixadas</h2>
          <button onClick={onClose} className="text-discord-text-muted hover:text-white">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {pinned === null ? (
            <div className="flex justify-center pt-8">
              <div className="w-6 h-6 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
            </div>
          ) : pinned.length === 0 ? (
            <p className="text-sm text-discord-text-muted text-center pt-8 px-4">
              Nenhuma mensagem fixada ainda. Clique com o botão direito numa mensagem e escolha "Fixar mensagem".
            </p>
          ) : (
            pinned.map((message) => {
              const author = profilesById[message.author_id]
              return (
                <div key={message.id} className="bg-discord-lighter/40 rounded-lg p-3 group">
                  <div className="flex items-center gap-2 mb-1">
                    <Avatar name={author?.username ?? '?'} avatarUrl={author?.avatar_url} size={20} />
                    <span className="text-sm font-medium text-white">
                      {author?.display_name || author?.username || 'Usuário'}
                    </span>
                    <span className="text-[10px] text-discord-text-muted">{formatDate(message.created_at)}</span>
                    {canUnpin && (
                      <button
                        onClick={() => onUnpin(message.id)}
                        className="ml-auto text-[10px] text-discord-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Desafixar
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-discord-text break-words whitespace-pre-wrap">{message.content}</p>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
