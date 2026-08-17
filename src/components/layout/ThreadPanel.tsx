import { useState } from 'react'
import { MessageList } from '../chat/MessageList'
import { MessageComposer } from '../chat/MessageComposer'
import { useMessages } from '../../hooks/useMessages'
import { useAuth } from '../../hooks/useAuth'
import { useTypingIndicator } from '../../hooks/useTypingIndicator'
import type { Thread, Profile, ServerEmoji, Message } from '../../types/database'

export function ThreadPanel({
  thread,
  serverId,
  isServerOwner,
  memberProfiles,
  profilesById,
  emojis,
  onViewProfile,
  onClose,
}: {
  thread: Thread
  serverId: string
  isServerOwner: boolean
  memberProfiles: Profile[]
  profilesById: Record<string, Profile>
  emojis: ServerEmoji[]
  onViewProfile: (profile: Profile) => void
  onClose: () => void
}) {
  const { user } = useAuth()
  const { messages, attachments, reactions, sendMessage, editMessage, deleteMessage, toggleReaction } = useMessages(
    thread.channel_id,
    serverId,
    thread.id
  )
  const { typingUserIds, notifyTyping } = useTypingIndicator(thread.id, user?.id)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)

  const typingNames = typingUserIds
    .map((id) => profilesById[id]?.display_name || profilesById[id]?.username)
    .filter((name): name is string => Boolean(name))

  async function handleSend(content: string, files: File[]) {
    await sendMessage(content, replyingTo?.id ?? null, files)
    setReplyingTo(null)
  }

  return (
    <div className="fixed inset-y-0 right-0 z-[300] w-full max-w-md bg-discord-channels border-l border-black/30 flex flex-col shadow-2xl">
      <div className="h-12 px-4 flex items-center justify-between border-b border-black/20 shrink-0">
        <div className="min-w-0 flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-discord-text-muted shrink-0">
            <path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V6a1 1 0 0 1 1-1z" />
          </svg>
          <h2 className="font-display font-semibold text-white tracking-wide truncate">{thread.name}</h2>
        </div>
        <button onClick={onClose} className="text-discord-text-muted hover:text-white shrink-0">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
          </svg>
        </button>
      </div>

      <MessageList
        channelName={thread.name}
        messages={messages}
        attachments={attachments}
        reactions={reactions}
        profilesById={profilesById}
        currentUserId={user?.id}
        isServerOwner={isServerOwner}
        members={memberProfiles}
        emojis={emojis}
        onEdit={editMessage}
        onDelete={deleteMessage}
        onReply={setReplyingTo}
        onToggleReaction={toggleReaction}
        onViewProfile={onViewProfile}
      />

      {typingNames.length > 0 && (
        <div className="px-4 pb-1 flex items-center gap-2 text-xs text-discord-text-muted shrink-0">
          <span className="flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-discord-text-muted animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1 h-1 rounded-full bg-discord-text-muted animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1 h-1 rounded-full bg-discord-text-muted animate-bounce" />
          </span>
          <span className="truncate">
            {typingNames.length === 1 ? `${typingNames[0]} está digitando...` : `${typingNames.length} pessoas estão digitando...`}
          </span>
        </div>
      )}

      <MessageComposer
        channelName={thread.name}
        members={memberProfiles}
        emojis={emojis}
        draftKey={`thread-${thread.id}`}
        replyingTo={replyingTo}
        replyingToAuthor={replyingTo ? profilesById[replyingTo.author_id] : undefined}
        onCancelReply={() => setReplyingTo(null)}
        onSend={handleSend}
        onTyping={notifyTyping}
      />
    </div>
  )
}
