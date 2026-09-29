import { useEffect, useRef, useState } from 'react'
import { MessageList } from '../chat/MessageList'
import { MessageComposer } from '../chat/MessageComposer'
import { useMessages } from '../../hooks/useMessages'
import { useAuth } from '../../hooks/useAuth'
import { useTypingIndicator } from '../../hooks/useTypingIndicator'
import { useRoles } from '../../hooks/useRoles'
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
  const { roles, rolesForUser } = useRoles(serverId)
  const { messages, loading, loadingOlder, hasMore, loadOlder, loadError, refresh, attachments, reactions, sendMessage, editMessage, deleteMessage, toggleReaction } = useMessages(
    thread.channel_id,
    serverId,
    thread.id
  )
  const { typingUserIds, notifyTyping, stopTyping } = useTypingIndicator(thread.id, user?.id)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)

  // Esc fecha o painel (a não ser que um modal por cima já tenha tratado
  // o Esc — o Modal.tsx para a propagação).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) onCloseRef.current()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const typingNames = typingUserIds
    .map((id) => profilesById[id]?.display_name || profilesById[id]?.username)
    .filter((name): name is string => Boolean(name))

  // Sem o `return`, o MessageComposer nunca recebia o erro e limpava a
  // caixa como se tivesse dado certo (mesmo bug já corrigido no ChatArea).
  async function handleSend(content: string, files: File[]) {
    const result = await sendMessage(content, replyingTo?.id ?? null, files)
    if (!result.error) {
      setReplyingTo(null)
      stopTyping()
    }
    return result
  }

  return (
    <div role="dialog" aria-label={`Thread ${thread.name}`} className="fixed inset-y-0 right-0 z-[300] w-full max-w-md bg-discord-channels border-l border-[var(--color-line)] flex flex-col shadow-[-24px_0_60px_-12px_rgb(0_0_0/0.6)] animate-fade-slide-in">
      <div className="h-14 px-4 flex items-center justify-between gap-2 border-b border-[var(--color-line)] shrink-0">
        <div className="min-w-0 flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-white/[0.05] border border-[var(--color-line)] flex items-center justify-center shrink-0" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-discord-text-muted">
              <path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V6a1 1 0 0 1 1-1z" />
            </svg>
          </span>
          <div className="min-w-0 leading-tight">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-discord-text-muted">Thread</p>
            <h2 className="font-display font-semibold text-[15px] text-white truncate">{thread.name}</h2>
          </div>
        </div>
        <button onClick={onClose} aria-label="Fechar thread" title="Fechar thread" className="icon-btn w-9 h-9 shrink-0">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
          </svg>
        </button>
      </div>

      <MessageList
        channelName={thread.name}
        viewKey={thread.id}
        messages={messages}
        loading={loading}
        loadingOlder={loadingOlder}
        hasMore={hasMore}
        onLoadOlder={loadOlder}
        loadError={loadError}
        onRetry={refresh}
        attachments={attachments}
        reactions={reactions}
        profilesById={profilesById}
        currentUserId={user?.id}
        isServerOwner={isServerOwner}
        members={memberProfiles}
        emojis={emojis}
        roles={roles}
        rolesForUser={rolesForUser}
        onEdit={editMessage}
        onDelete={deleteMessage}
        onReply={setReplyingTo}
        onToggleReaction={toggleReaction}
        onViewProfile={onViewProfile}
      />

      <div className="h-6 px-5 flex items-center gap-2 text-xs text-discord-text-muted shrink-0" aria-live="polite">
        {typingNames.length > 0 && (
          <>
            <span className="flex items-center gap-[3px] px-2 py-1 rounded-full bg-white/[0.05] border border-[var(--color-line)]">
              <span className="w-1.5 h-1.5 rounded-full bg-discord-text-muted animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-discord-text-muted animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-discord-text-muted animate-bounce" />
            </span>
            <span className="truncate animate-fade-in">
              {typingNames.length === 1 ? (
                <><strong className="font-semibold text-discord-text">{typingNames[0]}</strong> está digitando…</>
              ) : (
                `${typingNames.length} pessoas estão digitando…`
              )}
            </span>
          </>
        )}
      </div>

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
