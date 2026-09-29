import { Fragment, useMemo } from 'react'
import { MessageItem } from './MessageItem'
import { MessageListSkeleton } from './MessageListSkeleton'
import { useChatScroll } from '../../hooks/useChatScroll'
import type { Message, MessageAttachment, MessageReaction, Profile, ServerEmoji, Thread, Role } from '../../types/database'

const GROUP_WINDOW_MS = 5 * 60 * 1000
const DEFAULT_ROLE_COLOR = '#99aab5'
// Referências estáveis pra "sem nada" — um `[]` novo a cada render
// quebraria o React.memo do MessageItem.
const EMPTY_ATTACHMENTS: MessageAttachment[] = []
const EMPTY_REACTIONS: MessageReaction[] = []
const EMPTY_ROLES: Role[] = []

function formatDateSeparator(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Hoje'
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem'
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function DateSeparator({ label }: { label: string }) {
  return (
    <div role="separator" aria-label={label} className="flex items-center gap-3 px-4 my-4">
      <div className="flex-1 h-px bg-[var(--color-line)]" />
      <span className="text-[11px] font-semibold text-discord-text-muted whitespace-nowrap px-3 py-1 rounded-full bg-white/[0.04] border border-[var(--color-line)]">
        {label}
      </span>
      <div className="flex-1 h-px bg-[var(--color-line)]" />
    </div>
  )
}

export function MessageList({
  channelName,
  viewKey,
  messages,
  loading,
  loadingOlder,
  hasMore,
  onLoadOlder,
  loadError,
  onRetry,
  attachments,
  reactions,
  profilesById,
  currentUserId,
  isServerOwner,
  members,
  emojis,
  roles,
  rolesForUser,
  onEdit,
  onDelete,
  onReply,
  onToggleReaction,
  onViewProfile,
  onPin,
  onUnpin,
  threadsByMessageId,
  replyCounts,
  onCreateThread,
  onOpenThread,
  onJumpToMessage,
  highlightedMessageId,
  onForward,
  selectionMode,
  selectedMessageIds,
  onToggleSelect,
  onReport,
}: {
  channelName: string
  /** Identifica o canal/thread exibido — trocar isso reposiciona a rolagem no fim. */
  viewKey?: string
  messages: Message[]
  loading?: boolean
  loadingOlder?: boolean
  hasMore?: boolean
  onLoadOlder?: () => void
  loadError?: string | null
  onRetry?: () => void
  attachments: Record<string, MessageAttachment[]>
  reactions: Record<string, MessageReaction[]>
  profilesById: Record<string, Profile>
  currentUserId: string | undefined
  isServerOwner: boolean
  members: Profile[]
  emojis: ServerEmoji[]
  roles?: Role[]
  rolesForUser?: (userId: string) => Role[]
  onEdit: (messageId: string, content: string) => Promise<{ error: string | null }>
  onDelete: (messageId: string) => void
  onReply: (message: Message) => void
  onToggleReaction: (messageId: string, emoji: string) => void
  onViewProfile: (profile: Profile) => void
  onPin?: (messageId: string) => void
  onUnpin?: (messageId: string) => void
  threadsByMessageId?: Record<string, Thread>
  replyCounts?: Record<string, number>
  onCreateThread?: (messageId: string) => void
  onOpenThread?: (thread: Thread) => void
  onJumpToMessage?: (messageId: string) => void
  highlightedMessageId?: string | null
  onForward?: (messageId: string) => void
  selectionMode?: boolean
  selectedMessageIds?: Set<string>
  onToggleSelect?: (messageId: string) => void
  onReport?: (messageId: string) => void
}) {
  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])
  const lastMessage = messages[messages.length - 1]
  const { containerRef, contentRef, onScroll, showJumpToLatest, scrollToBottom } = useChatScroll({
    viewKey: viewKey ?? channelName,
    firstId: messages[0]?.id,
    lastId: lastMessage?.id,
    lastIsOwn: Boolean(lastMessage && lastMessage.author_id === currentUserId),
    hasMore,
    loadingOlder,
    onLoadOlder,
  })

  // Cor do nome igual o Discord faz — usa o cargo de posição mais alta
  // que tenha uma cor definida (ignora o cinza padrão, que significa "sem
  // cor específica"). Calculado uma vez por autor, não por mensagem.
  const roleColorByAuthor = useMemo(() => {
    const map = new Map<string, string | undefined>()
    if (!rolesForUser) return map
    for (const m of messages) {
      if (!map.has(m.author_id)) map.set(m.author_id, rolesForUser(m.author_id).find((r) => r.color !== DEFAULT_ROLE_COLOR)?.color)
    }
    return map
  }, [messages, rolesForUser])

  // Separadores de data e agrupamento por autor — pré-calculados (antes
  // eram 4 `new Date()` por mensagem a cada render).
  const layout = useMemo(() => {
    let prevDay = ''
    let prevTime = 0
    let prevAuthor = ''
    return messages.map((message) => {
      const d = new Date(message.created_at)
      const day = d.toDateString()
      const time = d.getTime()
      const isNewDay = day !== prevDay
      const showHeader = isNewDay || prevAuthor !== message.author_id || time - prevTime > GROUP_WINDOW_MS
      prevDay = day
      prevTime = time
      prevAuthor = message.author_id
      return { isNewDay, showHeader }
    })
  }, [messages])

  if (loading) {
    return <MessageListSkeleton />
  }

  if (loadError && messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-3">
        <span className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-7 h-7 text-rose-400">
            <path d="M12 8v5M12 16.5v.01" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </span>
        <p className="font-display font-semibold text-white">Não foi possível carregar as mensagens</p>
        <p className="text-sm text-discord-text-muted max-w-sm -mt-1.5 break-words">{loadError}</p>
        {onRetry && (
          <button onClick={onRetry} className="h-10 px-5 btn-primary text-sm">
            Tentar de novo
          </button>
        )}
      </div>
    )
  }

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
        <div className="relative w-20 h-20 rounded-3xl bg-brand-gradient flex items-center justify-center mb-5 shadow-[0_12px_32px_-12px_var(--color-discord-blurple)] ring-1 ring-white/10">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 text-white">
            <path d="M9.3 3.1a1 1 0 0 1 1.94.48L10.6 6.5h3.24l.68-2.92a1 1 0 1 1 1.94.48L15.86 6.5h2.14a1 1 0 1 1 0 2h-2.6l-.7 3h2.3a1 1 0 1 1 0 2h-2.77l-.72 3.1a1 1 0 1 1-1.94-.48l.6-2.62H9.13l-.72 3.1a1 1 0 1 1-1.94-.48l.6-2.62H4.9a1 1 0 1 1 0-2h2.64l.7-3H6a1 1 0 1 1 0-2h2.6l.7-3zm.84 5.4-.7 3h3.24l.7-3z" />
          </svg>
        </div>
        <h3 className="relative font-display text-2xl font-bold text-white">
          Bem-vindo a #{channelName}!
        </h3>
        <p className="relative text-discord-text-muted mt-1.5 max-w-sm">
          Este é o começo do canal #{channelName}. Manda a primeira mensagem pra começar a conversa.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 relative flex flex-col">
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto py-4"
        style={{ overflowAnchor: 'none' }}
      >
        <div ref={contentRef}>
          {hasMore && (
            <div className="flex justify-center py-2">
              {loadingOlder ? (
                <div role="status" aria-label="Carregando mensagens anteriores" className="w-5 h-5 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
              ) : (
                <button onClick={onLoadOlder} className="chip h-7 !px-3 hover:!text-discord-text hover:!bg-white/[0.08] transition-colors">
                  Carregar mensagens anteriores
                </button>
              )}
            </div>
          )}
          {messages.map((message, i) => {
            const { isNewDay, showHeader } = layout[i]
            const replyToMessage = message.reply_to_id ? messagesById.get(message.reply_to_id) ?? null : null
            const thread = threadsByMessageId?.[message.id]

            return (
              <Fragment key={message.id}>
                {isNewDay && <DateSeparator label={formatDateSeparator(message.created_at)} />}
                <MessageItem
                  message={message}
                  author={profilesById[message.author_id]}
                  authorRoleColor={roleColorByAuthor.get(message.author_id)}
                  showHeader={showHeader}
                  isOwn={message.author_id === currentUserId}
                  canModerate={isServerOwner}
                  replyToMessage={replyToMessage}
                  replyToAuthor={replyToMessage ? profilesById[replyToMessage.author_id] : undefined}
                  attachments={attachments[message.id] ?? EMPTY_ATTACHMENTS}
                  reactions={reactions[message.id] ?? EMPTY_REACTIONS}
                  currentUserId={currentUserId}
                  members={members}
                  emojis={emojis}
                  roles={roles ?? EMPTY_ROLES}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onPin={onPin}
                  onUnpin={onUnpin}
                  thread={thread}
                  replyCount={thread ? replyCounts?.[thread.id] ?? 0 : 0}
                  onCreateThread={onCreateThread}
                  onOpenThread={onOpenThread}
                  onJumpToMessage={onJumpToMessage}
                  isHighlighted={highlightedMessageId === message.id}
                  onForward={onForward}
                  selectionMode={selectionMode}
                  selected={selectedMessageIds?.has(message.id)}
                  onToggleSelect={onToggleSelect}
                  onReply={onReply}
                  onToggleReaction={onToggleReaction}
                  onViewProfile={onViewProfile}
                  onReport={onReport}
                />
              </Fragment>
            )
          })}
        </div>
      </div>
      {showJumpToLatest && (
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 h-8 pl-3.5 pr-3 flex items-center gap-1.5 !rounded-full btn-primary text-xs animate-pop-in"
        >
          Novas mensagens
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
            <path d="M12 5v14M6 13l6 6 6-6" />
          </svg>
        </button>
      )}
    </div>
  )
}
