import { useEffect, useRef } from 'react'
import { MessageItem } from './MessageItem'
import type { Message, MessageAttachment, MessageReaction, Profile } from '../../types/database'

const GROUP_WINDOW_MS = 5 * 60 * 1000

export function MessageList({
  channelName,
  messages,
  attachments,
  reactions,
  profilesById,
  currentUserId,
  isServerOwner,
  members,
  onEdit,
  onDelete,
  onReply,
  onToggleReaction,
  onViewProfile,
}: {
  channelName: string
  messages: Message[]
  attachments: Record<string, MessageAttachment[]>
  reactions: Record<string, MessageReaction[]>
  profilesById: Record<string, Profile>
  currentUserId: string | undefined
  isServerOwner: boolean
  members: Profile[]
  onEdit: (messageId: string, content: string) => Promise<{ error: string | null }>
  onDelete: (messageId: string) => void
  onReply: (message: Message) => void
  onToggleReaction: (messageId: string, emoji: string) => void
  onViewProfile: (profile: Profile) => void
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const messagesById = Object.fromEntries(messages.map((m) => [m.id, m]))

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-4 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 500px 300px at 50% 35%, color-mix(in srgb, var(--color-discord-blurple) 10%, transparent), transparent 70%)',
          }}
        />
        <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-discord-blurple to-discord-darker flex items-center justify-center mb-5 brand-glow-sm">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 text-white">
            <path d="M5.5 4.5c.5-.5 1.2-.8 2-.8h1.4l-.3 15h-1c-.8 0-1.5-.3-2-.8-.6-.5-.9-1.2-.9-2v-9.4c0-.8.3-1.5.8-2zm10 0c.5.5.8 1.2.8 2v9.4c0 .8-.3 1.5-.8 2-.5.5-1.2.8-2 .8h-1l-.3-15h1.4c.8 0 1.5.3 2 .8z" />
          </svg>
        </div>
        <h3 className="relative font-display text-2xl font-bold text-white tracking-wide">
          Bem-vindo a #{channelName}!
        </h3>
        <p className="relative text-discord-text-muted mt-1.5 max-w-sm">
          Este é o começo do canal #{channelName}. Manda a primeira mensagem pra começar a conversa.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto py-4">
      {messages.map((message, i) => {
        const prev = messages[i - 1]
        const showHeader =
          !prev ||
          prev.author_id !== message.author_id ||
          new Date(message.created_at).getTime() - new Date(prev.created_at).getTime() > GROUP_WINDOW_MS

        const replyToMessage = message.reply_to_id ? messagesById[message.reply_to_id] ?? null : null

        return (
          <MessageItem
            key={message.id}
            message={message}
            author={profilesById[message.author_id]}
            showHeader={showHeader}
            isOwn={message.author_id === currentUserId}
            canModerate={isServerOwner}
            replyToMessage={replyToMessage}
            replyToAuthor={replyToMessage ? profilesById[replyToMessage.author_id] : undefined}
            attachments={attachments[message.id] ?? []}
            reactions={reactions[message.id] ?? []}
            currentUserId={currentUserId}
            members={members}
            onEdit={(content) => onEdit(message.id, content)}
            onDelete={() => onDelete(message.id)}
            onReply={() => onReply(message)}
            onToggleReaction={(emoji) => onToggleReaction(message.id, emoji)}
            onViewProfile={onViewProfile}
          />
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
