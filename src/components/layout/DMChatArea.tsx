import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { DMMessageItem } from '../chat/DMMessageItem'
import { MessageComposer } from '../chat/MessageComposer'
import { useDirectMessages } from '../../hooks/useDirectMessages'
import { useAuth } from '../../hooks/useAuth'
import { useFriends } from '../../context/FriendsContext'
import { useTypingIndicator } from '../../hooks/useTypingIndicator'
import { useDMSeenState } from '../../hooks/useDMSeenState'
import type { DMMessage, Profile } from '../../types/database'

const GROUP_WINDOW_MS = 5 * 60 * 1000

export function DMChatArea({ conversationId, otherProfile }: { conversationId: string; otherProfile: Profile }) {
  const { user, profile: myProfile } = useAuth()
  const { messages, attachments, sendMessage, editMessage, deleteMessage } = useDirectMessages(conversationId)
  const { blocked, blockUser, unblockUser } = useFriends()
  const { typingUserIds, notifyTyping } = useTypingIndicator(conversationId, user?.id)
  const otherLastReadAt = useDMSeenState(conversationId, otherProfile.id)
  const [replyingTo, setReplyingTo] = useState<DMMessage | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const isBlocked = blocked.some((b) => b.blocked_id === otherProfile.id)
  const messagesById = Object.fromEntries(messages.map((m) => [m.id, m]))

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function handleSend(content: string, files: File[]) {
    await sendMessage(content, replyingTo?.id ?? null, files)
    setReplyingTo(null)
  }

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-discord-channels">
      <header className="h-12 px-4 flex items-center gap-2 border-b border-black/20 shadow-sm shrink-0">
        <Avatar name={otherProfile.username} avatarUrl={otherProfile.avatar_url} status={otherProfile.status} userId={otherProfile.id} size={24} />
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
          {(() => {
            // Última mensagem MINHA que a outra pessoa já leu — só essa
            // mostra "Visto", igual o Discord/WhatsApp fazem (não fica
            // repetindo em toda mensagem antiga)
            const myLastSeenMessage = otherLastReadAt
              ? [...messages]
                  .reverse()
                  .find((m) => m.author_id === user?.id && new Date(m.created_at) <= new Date(otherLastReadAt))
              : undefined

            return messages.map((message, i) => {
              const prev = messages[i - 1]
              const showHeader =
                !prev ||
                prev.author_id !== message.author_id ||
                new Date(message.created_at).getTime() - new Date(prev.created_at).getTime() > GROUP_WINDOW_MS
              const replyToMessage = message.reply_to_id ? messagesById[message.reply_to_id] ?? null : null
              const author = message.author_id === user?.id ? myProfile ?? undefined : otherProfile

              return (
                <div key={message.id}>
                  <DMMessageItem
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
                    attachments={attachments[message.id] ?? []}
                  />
                  {myLastSeenMessage?.id === message.id && (
                    <p className="px-4 pt-0.5 text-[10px] text-discord-text-muted text-right">
                      Visto por {otherProfile.display_name || otherProfile.username}
                    </p>
                  )}
                </div>
              )
            })
          })()}
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
          <MessageComposer
            channelName={otherProfile.display_name || otherProfile.username}
            members={[]}
            draftKey={`dm-${conversationId}`}
            placeholder={`Conversar com ${otherProfile.display_name || otherProfile.username}`}
            replyingTo={replyingTo}
            replyingToAuthor={
              replyingTo
                ? replyingTo.author_id === otherProfile.id
                  ? otherProfile
                  : undefined
                : undefined
            }
            onCancelReply={() => setReplyingTo(null)}
            onSend={handleSend}
            onTyping={notifyTyping}
          />
        )}
      </div>
    </section>
  )
}
