import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { DMMessageItem } from '../chat/DMMessageItem'
import { useDirectMessages } from '../../hooks/useDirectMessages'
import { useAuth } from '../../hooks/useAuth'
import { useFriends } from '../../hooks/useFriends'
import { useTypingIndicator } from '../../hooks/useTypingIndicator'
import { getDraft, setDraft } from '../../lib/messageDrafts'
import type { DMMessage, Profile } from '../../types/database'

const GROUP_WINDOW_MS = 5 * 60 * 1000
const MAX_LENGTH = 4000

export function DMChatArea({ conversationId, otherProfile }: { conversationId: string; otherProfile: Profile }) {
  const { user } = useAuth()
  const { messages, sendMessage, editMessage, deleteMessage } = useDirectMessages(conversationId)
  const { blocked, blockUser, unblockUser } = useFriends()
  const { typingUserIds, notifyTyping } = useTypingIndicator(conversationId, user?.id)
  const [replyingTo, setReplyingTo] = useState<DMMessage | null>(null)
  const [value, setValue] = useState(() => getDraft(`dm-${conversationId}`))

  useEffect(() => {
    setValue(getDraft(`dm-${conversationId}`))
  }, [conversationId])

  useEffect(() => {
    setDraft(`dm-${conversationId}`, value)
  }, [conversationId, value])
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isBlocked = blocked.some((b) => b.blocked_id === otherProfile.id)
  const messagesById = Object.fromEntries(messages.map((m) => [m.id, m]))

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function handleSend() {
    const trimmed = value.trim()
    if (trimmed.length === 0 || trimmed.length > MAX_LENGTH) return
    setSending(true)
    await sendMessage(trimmed, replyingTo?.id ?? null)
    setSending(false)
    setValue('')
    setReplyingTo(null)
  }

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-discord-channels">
      <header className="h-12 px-4 flex items-center gap-2 border-b border-black/20 shadow-sm shrink-0">
        <Avatar name={otherProfile.username} avatarUrl={otherProfile.avatar_url} status={otherProfile.status} size={24} />
        <h2 className="font-semibold text-white">{otherProfile.display_name || otherProfile.username}</h2>
        <div className="flex-1" />
        {isBlocked ? (
          <button
            onClick={() => unblockUser(otherProfile.id)}
            className="text-xs px-3 py-1 rounded bg-discord-darker text-discord-text hover:bg-discord-lighter transition-colors"
          >
            Desbloquear
          </button>
        ) : (
          <button
            onClick={() => blockUser(otherProfile.id)}
            className="text-xs px-3 py-1 rounded border border-red-600 text-red-500 hover:bg-red-600/10 transition-colors"
          >
            Bloquear
          </button>
        )}
      </header>

      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <Avatar name={otherProfile.username} avatarUrl={otherProfile.avatar_url} size={64} />
          <h3 className="text-xl font-bold text-white mt-3">
            {otherProfile.display_name || otherProfile.username}
          </h3>
          <p className="text-discord-text-muted mt-1 max-w-sm">
            Este é o início da sua conversa com {otherProfile.display_name || otherProfile.username}.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-4">
          {messages.map((message, i) => {
            const prev = messages[i - 1]
            const showHeader =
              !prev ||
              prev.author_id !== message.author_id ||
              new Date(message.created_at).getTime() - new Date(prev.created_at).getTime() > GROUP_WINDOW_MS
            const replyToMessage = message.reply_to_id ? messagesById[message.reply_to_id] ?? null : null
            const author = message.author_id === user?.id ? undefined : otherProfile

            return (
              <DMMessageItem
                key={message.id}
                message={message}
                author={message.author_id === otherProfile.id ? otherProfile : author}
                showHeader={showHeader}
                isOwn={message.author_id === user?.id}
                replyToMessage={replyToMessage}
                replyToAuthor={
                  replyToMessage
                    ? replyToMessage.author_id === otherProfile.id
                      ? otherProfile
                      : undefined
                    : undefined
                }
                onEdit={(content) => editMessage(message.id, content)}
                onDelete={() => deleteMessage(message.id)}
                onReply={() => setReplyingTo(message)}
              />
            )
          })}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="px-4 pb-6 shrink-0">
        {typingUserIds.length > 0 && (
          <p className="text-xs text-discord-text-muted mb-1 flex items-center gap-2">
            <span className="flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-discord-text-muted animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1 h-1 rounded-full bg-discord-text-muted animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1 h-1 rounded-full bg-discord-text-muted animate-bounce" />
            </span>
            {otherProfile.display_name || otherProfile.username} está digitando...
          </p>
        )}
        {isBlocked ? (
          <p className="text-center text-sm text-discord-text-muted bg-discord-lighter rounded-lg py-3">
            Você bloqueou {otherProfile.display_name || otherProfile.username}. Desbloqueie para enviar mensagens.
          </p>
        ) : (
          <>
            {replyingTo && (
              <div className="flex items-center justify-between bg-discord-lighter/60 rounded-t-lg px-3 py-1.5 text-xs">
                <span className="text-discord-text-muted">
                  Respondendo a{' '}
                  <span className="text-white font-medium">
                    {replyingTo.author_id === user?.id ? 'você mesmo' : otherProfile.display_name || otherProfile.username}
                  </span>
                </span>
                <button onClick={() => setReplyingTo(null)} className="text-discord-text-muted hover:text-white">
                  ×
                </button>
              </div>
            )}
            <div
              className={`bg-discord-lighter px-4 py-2.5 flex items-end gap-3 ${replyingTo ? 'rounded-b-lg' : 'rounded-lg'}`}
            >
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value)
                  if (e.target.value.length > 0) notifyTyping()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder={`Conversar com ${otherProfile.display_name || otherProfile.username}`}
                rows={1}
                maxLength={MAX_LENGTH}
                className="flex-1 bg-transparent outline-none text-discord-text placeholder:text-discord-text-muted resize-none py-1 max-h-48"
                onInput={(e) => {
                  const el = e.currentTarget
                  el.style.height = 'auto'
                  el.style.height = `${Math.min(el.scrollHeight, 192)}px`
                }}
              />
              <button
                onClick={handleSend}
                disabled={sending || value.trim().length === 0}
                className="text-discord-text-muted hover:text-discord-blurple shrink-0 pb-1 disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path d="M3.4 20.6l17.5-8.2a1 1 0 0 0 0-1.8L3.4 2.4a1 1 0 0 0-1.4 1.1L4.5 12l-2.5 8.5a1 1 0 0 0 1.4 1.1z" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
