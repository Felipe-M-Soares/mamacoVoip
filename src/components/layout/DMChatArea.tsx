import { useCallback, useMemo, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { DMMessageItem } from '../chat/DMMessageItem'
import { MessageComposer } from '../chat/MessageComposer'
import { useDirectMessages } from '../../hooks/useDirectMessages'
import { useAuth } from '../../hooks/useAuth'
import { useFriends } from '../../context/FriendsContext'
import { useTypingIndicator } from '../../hooks/useTypingIndicator'
import { useDMSeenState } from '../../hooks/useDMSeenState'
import { useVoice } from '../../hooks/useVoice'
import { useChatScroll } from '../../hooks/useChatScroll'
import { MessageListSkeleton } from '../chat/MessageListSkeleton'
import type { DMMessage, Profile } from '../../types/database'

const GROUP_WINDOW_MS = 5 * 60 * 1000

export function DMChatArea({ conversationId, otherProfile }: { conversationId: string; otherProfile: Profile }) {
  const { user, profile: myProfile } = useAuth()
  const { messages, attachments, loading, loadingOlder, hasMore, loadOlder, loadError, sendMessage, editMessage, deleteMessage } =
    useDirectMessages(conversationId)
  const { blocked, blockUser, unblockUser } = useFriends()
  const voice = useVoice()
  const isThisCall = voice.connectedChannelId === conversationId
  const isInAnotherCall = Boolean(voice.connectedChannelId) && !isThisCall
  const { typingUserIds, notifyTyping, stopTyping } = useTypingIndicator(conversationId, user?.id)
  const otherLastReadAt = useDMSeenState(conversationId, otherProfile.id)
  const [replyingTo, setReplyingTo] = useState<DMMessage | null>(null)
  // Confirmação de bloqueio inline no header (antes era um confirm() nativo)
  const [confirmingBlock, setConfirmingBlock] = useState(false)

  const isBlocked = blocked.some((b) => b.blocked_id === otherProfile.id)
  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])
  const lastMessage = messages[messages.length - 1]
  const { containerRef, contentRef, onScroll, showJumpToLatest, scrollToBottom } = useChatScroll({
    viewKey: conversationId,
    firstId: messages[0]?.id,
    lastId: lastMessage?.id,
    lastIsOwn: Boolean(lastMessage && lastMessage.author_id === user?.id),
    hasMore,
    loadingOlder,
    onLoadOlder: loadOlder,
  })

  const handleDelete = useCallback(
    async (messageId: string) => {
      const { error } = await deleteMessage(messageId)
      if (error) alert(error)
    },
    [deleteMessage]
  )

  // Agrupamento por autor pré-calculado (antes: vários `new Date()` por
  // mensagem a cada render/tecla digitada).
  const showHeaders = useMemo(() => {
    let prevAuthor = ''
    let prevTime = 0
    return messages.map((m) => {
      const t = new Date(m.created_at).getTime()
      const show = prevAuthor !== m.author_id || t - prevTime > GROUP_WINDOW_MS
      prevAuthor = m.author_id
      prevTime = t
      return show
    })
  }, [messages])

  // Última mensagem MINHA que a outra pessoa já leu — só essa mostra
  // "Visto", igual o Discord/WhatsApp fazem.
  const myLastSeenMessageId = useMemo(() => {
    if (!otherLastReadAt) return undefined
    const readAt = new Date(otherLastReadAt).getTime()
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.author_id === user?.id && new Date(m.created_at).getTime() <= readAt) return m.id
    }
    return undefined
  }, [messages, otherLastReadAt, user?.id])

  // Mesmo bug do ChatArea.tsx: sem o `return`, o MessageComposer nunca
  // recebia o erro de volta e sempre limpava a caixa como se tivesse
  // dado certo, mesmo quando o envio falhava.
  async function handleSend(content: string, files: File[]) {
    const result = await sendMessage(content, replyingTo?.id ?? null, files)
    if (!result.error) {
      setReplyingTo(null)
      stopTyping()
    }
    return result
  }

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-discord-channels border-t border-l border-[var(--color-line)]">
      <header className="h-14 px-4 max-lg:pl-14 flex items-center gap-2 border-b border-[var(--color-line)] shrink-0">
        <Avatar name={otherProfile.username} avatarUrl={otherProfile.avatar_url} status={otherProfile.status} userId={otherProfile.id} size={32} />
        <div className="min-w-0 flex flex-col leading-tight ml-0.5">
          <h2 className="font-display font-semibold text-[15px] text-white truncate">{otherProfile.display_name || otherProfile.username}</h2>
          <span className="text-[11px] text-discord-text-muted truncate">@{otherProfile.username}</span>
        </div>
        <div className="flex-1" />
        {!isBlocked &&
          (isThisCall ? (
            <button
              onClick={() => voice.leave()}
              className="btn-danger h-9 px-3.5 text-sm flex items-center gap-1.5 shrink-0"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M20 15.5c-1.2 0-2.5-.2-3.6-.6-.4-.1-.8 0-1.1.3l-2.2 2.2c-2.8-1.4-5.2-3.8-6.6-6.6l2.2-2.2c.3-.3.4-.7.3-1.1-.4-1.1-.6-2.4-.6-3.6 0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1 0 9.4 7.6 17 17 17 .6 0 1-.4 1-1v-3.5c0-.6-.4-1-1-1z" />
              </svg>
              Sair da chamada
            </button>
          ) : (
            <button
              onClick={() =>
                voice.join(conversationId, null, {
                  displayName: otherProfile.display_name || otherProfile.username,
                })
              }
              disabled={isInAnotherCall || voice.connecting}
              title={isInAnotherCall ? 'Você já está em outra chamada' : 'Iniciar chamada de voz'}
              className="h-9 px-3.5 rounded-[10px] text-sm font-semibold bg-discord-green/15 text-discord-green border border-discord-green/25 hover:bg-discord-green hover:text-white transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5 shrink-0"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M12 3a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4zm-7 9a1 1 0 0 1 2 0 5 5 0 0 0 10 0 1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V21h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.08A7 7 0 0 1 5 12z" />
              </svg>
              Chamada
            </button>
          ))}
        {isBlocked ? (
          <button
            onClick={() => unblockUser(otherProfile.id)}
            className="btn-secondary h-9 px-3.5 text-sm shrink-0"
          >
            Desbloquear
          </button>
        ) : confirmingBlock ? (
          <div className="flex items-center gap-1.5 shrink-0 animate-fade-in" role="group" aria-label="Confirmar bloqueio">
            <span className="text-xs text-discord-text-muted hidden sm:inline">Bloquear?</span>
            <button onClick={() => setConfirmingBlock(false)} className="btn-ghost h-9 px-3 text-sm">
              Cancelar
            </button>
            <button
              onClick={() => {
                setConfirmingBlock(false)
                void blockUser(otherProfile.id)
              }}
              className="btn-danger h-9 px-3.5 text-sm"
            >
              Bloquear
            </button>
          </div>
        ) : (
          <button
            // bloquear era um clique só, sem confirmação — agora confirma inline
            onClick={() => setConfirmingBlock(true)}
            title={`Bloquear ${otherProfile.display_name || otherProfile.username}`}
            className="h-9 px-3.5 rounded-[10px] text-sm font-medium text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
          >
            Bloquear
          </button>
        )}
      </header>

      {loading ? (
        <MessageListSkeleton />
      ) : loadError && messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-3">
          <span className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-7 h-7 text-rose-400" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16.5v.01" />
            </svg>
          </span>
          <p className="font-display font-semibold text-white">Não foi possível carregar a conversa</p>
          <p className="text-sm text-discord-text-muted max-w-sm -mt-1.5 break-words">{loadError}</p>
        </div>
      ) : messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <Avatar
            name={otherProfile.username}
            avatarUrl={otherProfile.avatar_url}
            decorationUrl={otherProfile.avatar_decoration_url}
            size={80}
          />
          <h3 className="font-display text-2xl font-bold text-white mt-4">
            {otherProfile.display_name || otherProfile.username}
          </h3>
          <p className="text-discord-text-muted mt-1.5 max-w-sm">
            Este é o início da sua conversa com {otherProfile.display_name || otherProfile.username}.
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 relative flex flex-col">
          <div ref={containerRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-4" style={{ overflowAnchor: 'none' }}>
            <div ref={contentRef}>
              {hasMore && (
                <div className="flex justify-center py-2">
                  {loadingOlder ? (
                    <div role="status" aria-label="Carregando mensagens anteriores" className="w-5 h-5 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <button onClick={() => void loadOlder()} className="chip h-7 !px-3 hover:!text-discord-text hover:!bg-white/[0.08] transition-colors">
                      Carregar mensagens anteriores
                    </button>
                  )}
                </div>
              )}
              {messages.map((message, i) => {
                const replyToMessage = message.reply_to_id ? messagesById.get(message.reply_to_id) ?? null : null
                const authorFor = (authorId: string) =>
                  authorId === otherProfile.id ? otherProfile : authorId === user?.id ? myProfile ?? undefined : undefined

                return (
                  <div key={message.id}>
                    <DMMessageItem
                      message={message}
                      author={authorFor(message.author_id)}
                      showHeader={showHeaders[i]}
                      isOwn={message.author_id === user?.id}
                      replyToMessage={replyToMessage}
                      // Antes, responder a uma mensagem SUA mostrava "alguém" como autor.
                      replyToAuthor={replyToMessage ? authorFor(replyToMessage.author_id) : undefined}
                      onEdit={editMessage}
                      onDelete={handleDelete}
                      onReply={setReplyingTo}
                      attachments={attachments[message.id]}
                    />
                    {myLastSeenMessageId === message.id && (
                      <p className="px-4 pt-1 text-[11px] text-discord-text-muted text-right flex items-center justify-end gap-1">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-discord-blurple" aria-hidden="true">
                          <path d="m2 12 5 5L18 6M13 16l1 1L22 8" />
                        </svg>
                        Visto por {otherProfile.display_name || otherProfile.username}
                      </p>
                    )}
                  </div>
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
      )}

      <div className="shrink-0">
        <div className="h-6 px-5 flex items-center gap-2 text-xs text-discord-text-muted" aria-live="polite">
          {typingUserIds.length > 0 && (
            <>
              <span className="flex items-center gap-[3px] px-2 py-1 rounded-full bg-white/[0.05] border border-[var(--color-line)]">
                <span className="w-1.5 h-1.5 rounded-full bg-discord-text-muted animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-discord-text-muted animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-discord-text-muted animate-bounce" />
              </span>
              <span className="truncate animate-fade-in">
                <strong className="font-semibold text-discord-text">{otherProfile.display_name || otherProfile.username}</strong> está digitando…
              </span>
            </>
          )}
        </div>
        {isBlocked ? (
          <p className="mx-4 mb-5 text-center text-sm text-discord-text-muted bg-white/[0.03] border border-[var(--color-line)] rounded-2xl py-3.5 px-4">
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
                  : myProfile ?? undefined
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
