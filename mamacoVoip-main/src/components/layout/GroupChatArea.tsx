import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { MessageComposer } from '../chat/MessageComposer'
import { useGroupMessages } from '../../hooks/useGroupMessages'
import { useGroupConversations, type GroupConversationWithMembers } from '../../context/GroupConversationsContext'
import { useAuth } from '../../hooks/useAuth'
import { useVoice } from '../../hooks/useVoice'
import { parseMessageContent } from '../../lib/messageFormatting'
import { LinkPreviewCard, extractFirstUrl, isPureMediaMessage } from '../chat/LinkPreviewCard'
import type { GroupMessage } from '../../types/database'

const GROUP_WINDOW_MS = 5 * 60 * 1000

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function GroupChatArea({
  group,
  onLeave,
}: {
  group: GroupConversationWithMembers
  onLeave: () => void
}) {
  const { user } = useAuth()
  const { messages, attachments, sendMessage, deleteMessage } = useGroupMessages(group.id)
  const { leaveGroup } = useGroupConversations()
  const [replyingTo, setReplyingTo] = useState<GroupMessage | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const voice = useVoice()

  const profileById = Object.fromEntries(group.members.map((m) => [m.id, m]))
  const otherMembers = group.members.filter((m) => m.id !== user?.id)
  const title = group.name || otherMembers.map((m) => m.display_name || m.username).join(', ')
  const isThisCall = voice.connectedChannelId === group.id
  const isInAnotherCall = Boolean(voice.connectedChannelId) && !isThisCall

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Mesmo bug do ChatArea.tsx: sem o `return`, o MessageComposer nunca
  // recebia o erro de volta e sempre limpava a caixa como se tivesse
  // dado certo, mesmo quando o envio falhava.
  async function handleSend(content: string, files: File[]) {
    const result = await sendMessage(content, replyingTo?.id ?? null, files)
    setReplyingTo(null)
    return result
  }

  async function handleLeave() {
    if (!confirm('Sair desse grupo? Você não verá mais as mensagens dele.')) return
    await leaveGroup(group.id)
    onLeave()
  }

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-discord-channels">
      <header className="h-12 px-4 flex items-center gap-2 border-b border-black/20 shadow-sm shrink-0">
        <div className="flex -space-x-2">
          {otherMembers.slice(0, 3).map((m) => (
            <Avatar key={m.id} name={m.username} avatarUrl={m.avatar_url} size={24} />
          ))}
        </div>
        <h2 className="font-semibold text-white truncate">{title}</h2>
        <span className="text-xs text-discord-text-muted">{group.members.length} membros</span>
        <div className="flex-1" />
        {isThisCall ? (
          <button
            onClick={() => voice.leave()}
            className="text-xs px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center gap-1.5"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M20 15.5c-1.2 0-2.5-.2-3.6-.6-.4-.1-.8 0-1.1.3l-2.2 2.2c-2.8-1.4-5.2-3.8-6.6-6.6l2.2-2.2c.3-.3.4-.7.3-1.1-.4-1.1-.6-2.4-.6-3.6 0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1 0 9.4 7.6 17 17 17 .6 0 1-.4 1-1v-3.5c0-.6-.4-1-1-1z" />
            </svg>
            Sair da chamada
          </button>
        ) : (
          <button
            onClick={() => voice.join(group.id, null, { displayName: title })}
            disabled={isInAnotherCall || voice.connecting}
            title={isInAnotherCall ? 'Você já está em outra chamada' : 'Iniciar chamada de voz'}
            className="text-xs px-3 py-1 rounded bg-discord-green text-white hover:brightness-110 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M12 3a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4zm-7 9a1 1 0 0 1 2 0 5 5 0 0 0 10 0 1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V21h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.08A7 7 0 0 1 5 12z" />
            </svg>
            Chamada
          </button>
        )}
        <button
          onClick={handleLeave}
          className="text-xs px-3 py-1 rounded border border-red-600 text-red-500 hover:bg-red-600/10 transition-colors"
        >
          Sair do grupo
        </button>
      </header>

      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <div className="flex -space-x-3 mb-3">
            {otherMembers.slice(0, 4).map((m) => (
              <Avatar key={m.id} name={m.username} avatarUrl={m.avatar_url} size={56} />
            ))}
          </div>
          <h3 className="text-xl font-bold text-white">{title}</h3>
          <p className="text-discord-text-muted mt-1 max-w-sm">Este é o início da conversa em grupo.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-4">
          {messages.map((message, i) => {
            const prev = messages[i - 1]
            const showHeader =
              !prev ||
              prev.author_id !== message.author_id ||
              new Date(message.created_at).getTime() - new Date(prev.created_at).getTime() > GROUP_WINDOW_MS
            const author = profileById[message.author_id]
            const isOwn = message.author_id === user?.id
            const msgAttachments = attachments[message.id] ?? []

            return (
              <div key={message.id} className="px-4 py-0.5 hover:bg-white/[0.02] group">
                <div className="flex gap-4">
                  {showHeader ? (
                    <Avatar name={author?.username ?? '?'} avatarUrl={author?.avatar_url} size={40} />
                  ) : (
                    <div className="w-10 shrink-0 flex items-start justify-center">
                      <span className="hidden group-hover:inline text-[10px] text-discord-text-muted pt-1">
                        {formatTime(message.created_at)}
                      </span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    {showHeader && (
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-white text-sm">
                          {isOwn ? 'Você' : author?.display_name || author?.username || 'Usuário'}
                        </span>
                        <span className="text-xs text-discord-text-muted">{formatTime(message.created_at)}</span>
                      </div>
                    )}
                    {message.content && !isPureMediaMessage(message.content) && (
                      <p className="text-sm text-discord-text whitespace-pre-wrap break-words leading-relaxed">
                        {parseMessageContent(message.content, [])}
                        {message.edited_at && (
                          <span className="text-[10px] text-discord-text-muted ml-1">(editado)</span>
                        )}
                      </p>
                    )}
                    {(() => {
                      const url = extractFirstUrl(message.content)
                      return url ? <LinkPreviewCard url={url} /> : null
                    })()}
                    {msgAttachments.length > 0 && (
                      <div className="mt-2 flex flex-col gap-2 max-w-md">
                        {msgAttachments.map((att) =>
                          att.mime_type.startsWith('image/') ? (
                            <a key={att.id} href={att.file_url} target="_blank" rel="noreferrer">
                              <img
                                src={att.file_url}
                                alt={att.file_name}
                                className="rounded-lg max-h-80 object-cover border border-black/20"
                              />
                            </a>
                          ) : att.mime_type.startsWith('audio/') ? (
                            <div key={att.id} className="flex items-center gap-2 bg-discord-darker rounded-lg px-3 py-2.5">
                              <audio controls src={att.file_url} className="h-9 max-w-xs" />
                            </div>
                          ) : (
                            <a
                              key={att.id}
                              href={att.file_url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-3 bg-discord-darker rounded-lg px-3 py-2.5 hover:bg-discord-lighter transition-colors"
                            >
                              <span className="text-sm text-discord-text truncate">{att.file_name}</span>
                            </a>
                          )
                        )}
                      </div>
                    )}
                    <div className="hidden group-hover:flex gap-2 mt-0.5">
                      <button
                        onClick={() => setReplyingTo(message)}
                        className="text-[10px] text-discord-text-muted hover:text-discord-text"
                      >
                        Responder
                      </button>
                      {isOwn && (
                        <button
                          onClick={() => deleteMessage(message.id)}
                          className="text-[10px] text-discord-text-muted hover:text-red-400"
                        >
                          Excluir
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="px-4 pb-6 shrink-0">
        <MessageComposer
          channelName={title}
          members={group.members}
          draftKey={`group-${group.id}`}
          placeholder={`Conversar em ${title}`}
          replyingTo={replyingTo}
          replyingToAuthor={replyingTo ? profileById[replyingTo.author_id] : undefined}
          onCancelReply={() => setReplyingTo(null)}
          onSend={handleSend}
        />
      </div>
    </section>
  )
}
