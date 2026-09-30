import { SignedAttachment } from '../chat/SignedAttachment'
import { useMemo, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { MessageComposer } from '../chat/MessageComposer'
import { useGroupMessages } from '../../hooks/useGroupMessages'
import { useGroupConversations, type GroupConversationWithMembers } from '../../context/GroupConversationsContext'
import { useAuth } from '../../hooks/useAuth'
import { useVoiceCore } from '../../hooks/useVoice'
import { useChatScroll } from '../../hooks/useChatScroll'
import { useTypingIndicator } from '../../hooks/useTypingIndicator'
import { MessageListSkeleton } from '../chat/MessageListSkeleton'
import { parseMessageContent } from '../../lib/messageFormatting'
import { LinkPreviewCard, extractFirstUrl, isPureMediaMessage } from '../chat/LinkPreviewCard'
import { ConfirmDialog } from '../modals/ConfirmDialog'
import type { GroupMessage } from '../../types/database'
import { useClickOutside } from '../../hooks/useClickOutside'
import { MoreIcon, ReportIcon } from '../ui/icons'
import { lazyComponent } from '../modals/lazyModal'

const ReportModal = lazyComponent(() => import('../modals/ReportModal').then((m) => m.ReportModal))

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
  const { messages, attachments, loading, loadingOlder, hasMore, loadOlder, loadError, sendMessage, deleteMessage } =
    useGroupMessages(group.id)
  const { leaveGroup, deleteGroup } = useGroupConversations()
  const [replyingTo, setReplyingTo] = useState<GroupMessage | null>(null)
  // Confirmações inline (antes eram confirm() nativos)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  // Apagar o grupo inteiro: só quem criou (a RLS confere de novo no banco).
  const [confirmingDeleteGroup, setConfirmingDeleteGroup] = useState(false)
  const [deleteGroupError, setDeleteGroupError] = useState<string | null>(null)
  const isCreator = Boolean(user?.id && group.created_by === user.id)
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null)
  // Celular: "Sair do grupo"/"Apagar grupo" ficam num menu "⋯" (no
  // header de 390px eles não cabiam e "Apagar grupo" saía da tela).
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const actionsMenuRef = useClickOutside<HTMLDivElement>(actionsMenuOpen, () => setActionsMenuOpen(false))
  const voice = useVoiceCore()
  // Grupo não tinha indicador de "digitando…" (DM e canal tinham).
  const { typingUserIds, notifyTyping, stopTyping } = useTypingIndicator(group.id, user?.id)

  const profileById = useMemo(() => Object.fromEntries(group.members.map((m) => [m.id, m])), [group.members])
  const typingNames = typingUserIds
    .map((id) => profileById[id]?.display_name || profileById[id]?.username)
    .filter((name): name is string => Boolean(name))
  const otherMembers = group.members.filter((m) => m.id !== user?.id)
  const title = group.name || otherMembers.map((m) => m.display_name || m.username).join(', ')
  const isThisCall = voice.connectedChannelId === group.id
  const isInAnotherCall = Boolean(voice.connectedChannelId) && !isThisCall

  const lastMessage = messages[messages.length - 1]
  const { containerRef, contentRef, onScroll, showJumpToLatest, scrollToBottom } = useChatScroll({
    viewKey: group.id,
    firstId: messages[0]?.id,
    lastId: lastMessage?.id,
    lastIsOwn: Boolean(lastMessage && lastMessage.author_id === user?.id),
    hasMore,
    loadingOlder,
    onLoadOlder: loadOlder,
  })
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

  async function handleDelete(messageId: string) {
    // antes excluía direto, sem confirmação, e ignorava erro — a
    // confirmação agora é inline na própria mensagem (confirmingDeleteId)
    setConfirmingDeleteId(null)
    const { error } = await deleteMessage(messageId)
    if (error) alert(error)
  }

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

  async function handleLeave() {
    setConfirmingLeave(false)
    const { error } = await leaveGroup(group.id)
    if (error) {
      alert(error)
      return
    }
    onLeave()
  }

  async function handleDeleteGroup() {
    setDeleteGroupError(null)
    if (isThisCall) voice.leave()
    const { error } = await deleteGroup(group.id)
    if (error) {
      setDeleteGroupError(error)
      return
    }
    setConfirmingDeleteGroup(false)
    onLeave()
  }

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-mv-main border-t border-l border-[var(--color-line)]">
      <header className="h-14 px-4 max-lg:pl-14 flex items-center gap-2 border-b border-[var(--color-line)] shrink-0">
        <div className="flex -space-x-2 shrink-0 [&>*]:ring-2 [&>*]:ring-mv-main [&>*]:rounded-full">
          {otherMembers.slice(0, 3).map((m) => (
            <Avatar key={m.id} name={m.username} avatarUrl={m.avatar_url} size={28} />
          ))}
        </div>
        <div className="min-w-0 flex-1 flex flex-col leading-tight ml-1">
          <h2 className="font-display font-semibold text-[15px] text-white truncate">{title}</h2>
          <span className="text-[11px] text-mv-muted truncate">{group.members.length} membros</span>
        </div>
        {isThisCall ? (
          <button
            onClick={() => voice.leave()}
            className="btn-danger h-9 px-3.5 text-sm flex items-center gap-1.5 shrink-0"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M20 15.5c-1.2 0-2.5-.2-3.6-.6-.4-.1-.8 0-1.1.3l-2.2 2.2c-2.8-1.4-5.2-3.8-6.6-6.6l2.2-2.2c.3-.3.4-.7.3-1.1-.4-1.1-.6-2.4-.6-3.6 0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1 0 9.4 7.6 17 17 17 .6 0 1-.4 1-1v-3.5c0-.6-.4-1-1-1z" />
            </svg>
            <span className="max-sm:sr-only">Sair da chamada</span>
          </button>
        ) : (
          <button
            onClick={() => voice.join(group.id, null, { displayName: title })}
            disabled={isInAnotherCall || voice.connecting}
            title={isInAnotherCall ? 'Você já está em outra chamada' : 'Iniciar chamada de voz'}
            className="h-9 px-3.5 rounded-[10px] text-sm font-semibold bg-mv-green/15 text-mv-green border border-mv-green/25 hover:bg-mv-green hover:text-white transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5 shrink-0"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M12 3a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4zm-7 9a1 1 0 0 1 2 0 5 5 0 0 0 10 0 1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V21h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.08A7 7 0 0 1 5 12z" />
            </svg>
            <span className="max-sm:sr-only">Chamada</span>
          </button>
        )}
        {confirmingLeave ? (
          <div className="flex items-center gap-1.5 shrink-0 animate-fade-in" role="group" aria-label="Confirmar saída do grupo">
            <span className="text-xs text-mv-muted hidden md:inline">Você não verá mais as mensagens.</span>
            <button onClick={() => setConfirmingLeave(false)} className="btn-ghost h-9 px-3 text-sm">
              Cancelar
            </button>
            <button onClick={() => void handleLeave()} className="btn-danger h-9 px-3.5 text-sm">
              Sair
            </button>
          </div>
        ) : (
          <>
            <div className="hidden md:flex items-center gap-2 shrink-0">
              <button
                onClick={() => setConfirmingLeave(true)}
                className="h-9 px-3.5 rounded-[10px] text-sm font-medium text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
              >
                Sair do grupo
              </button>
              {isCreator && (
                <button
                  onClick={() => {
                    setDeleteGroupError(null)
                    setConfirmingDeleteGroup(true)
                  }}
                  title="Apagar o grupo para todos os membros"
                  className="btn-danger h-9 px-3.5 text-sm shrink-0"
                >
                  Apagar grupo
                </button>
              )}
            </div>
            <div ref={actionsMenuRef} className="relative md:hidden shrink-0">
              <button
                onClick={() => setActionsMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={actionsMenuOpen}
                aria-label="Mais opções do grupo"
                title="Mais opções"
                className="icon-btn w-9 h-9"
              >
                <MoreIcon className="w-5 h-5" aria-hidden />
              </button>
              {actionsMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-1.5 w-48 surface-elevated rounded-xl p-1 z-30 animate-fade-in"
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      setActionsMenuOpen(false)
                      setConfirmingLeave(true)
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    Sair do grupo
                  </button>
                  {isCreator && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setActionsMenuOpen(false)
                        setDeleteGroupError(null)
                        setConfirmingDeleteGroup(true)
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
                    >
                      Apagar grupo
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </header>

      {confirmingDeleteGroup && (
        <ConfirmDialog
          title="Apagar grupo"
          danger
          confirmLabel="Apagar para todos"
          message={
            <>
              <p>
                Apagar <strong className="text-white font-semibold">{title || 'este grupo'}</strong> para todos os{' '}
                {group.members.length} membros? Todas as mensagens e arquivos serão apagados e isso não pode ser desfeito.
              </p>
              {deleteGroupError && (
                <p role="alert" className="mt-2 text-rose-400 text-[13px]">
                  {deleteGroupError}
                </p>
              )}
            </>
          }
          onConfirm={handleDeleteGroup}
          onCancel={() => setConfirmingDeleteGroup(false)}
        />
      )}

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
          <p className="font-display font-semibold text-white">Não foi possível carregar o grupo</p>
          <p className="text-sm text-mv-muted max-w-sm -mt-1.5 break-words">{loadError}</p>
        </div>
      ) : messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <div className="flex -space-x-3 mb-4 [&>*]:ring-4 [&>*]:ring-mv-main [&>*]:rounded-full">
            {otherMembers.slice(0, 4).map((m) => (
              <Avatar key={m.id} name={m.username} avatarUrl={m.avatar_url} size={56} />
            ))}
          </div>
          <h3 className="font-display text-2xl font-bold text-white">{title}</h3>
          <p className="text-mv-muted mt-1.5 max-w-sm">Este é o início da conversa em grupo.</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 relative flex flex-col">
        <div ref={containerRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-4" style={{ overflowAnchor: 'none' }}>
          <div ref={contentRef}>
          {hasMore && (
            <div className="flex justify-center py-2">
              {loadingOlder ? (
                <div role="status" aria-label="Carregando mensagens anteriores" className="w-5 h-5 border-2 border-mv-accent border-t-transparent rounded-full animate-spin" />
              ) : (
                <button onClick={() => void loadOlder()} className="chip h-7 !px-3 hover:!text-mv-text hover:!bg-white/[0.08] transition-colors">
                  Carregar mensagens anteriores
                </button>
              )}
            </div>
          )}
          {messages.map((message, i) => {
            const showHeader = showHeaders[i]
            const author = profileById[message.author_id]
            const isOwn = message.author_id === user?.id
            const msgAttachments = attachments[message.id] ?? []

            return (
              <div key={message.id} className={`relative px-4 py-0.5 hover:bg-white/[0.025] transition-colors group ${showHeader ? 'mt-3 pt-1.5' : ''}`}>
                <div className="flex gap-4">
                  {showHeader ? (
                    <Avatar name={author?.username ?? '?'} avatarUrl={author?.avatar_url} size={40} />
                  ) : (
                    <div className="w-10 shrink-0 flex items-start justify-center">
                      <span className="invisible group-hover:visible text-[10px] text-mv-muted/80 pt-[5px] tabular-nums">
                        {formatTime(message.created_at)}
                      </span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    {showHeader && (
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="font-semibold text-white text-[15px] leading-5 truncate">
                          {isOwn ? 'Você' : author?.display_name || author?.username || 'Usuário'}
                        </span>
                        <span className="text-[11px] text-mv-muted/80 tabular-nums shrink-0">{formatTime(message.created_at)}</span>
                      </div>
                    )}
                    {message.content && !isPureMediaMessage(message.content) && (
                      <p className="text-[15px] text-mv-text/95 whitespace-pre-wrap break-words leading-[1.4rem]">
                        {parseMessageContent(message.content, [])}
                        {message.edited_at && (
                          <span className="text-[10px] text-mv-muted/80 ml-1">(editado)</span>
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
                            <SignedAttachment key={att.id} bucket="group-attachments" fileUrl={att.file_url}>
                              {(url, onError) => (
                                <a href={url} target="_blank" rel="noreferrer">
                                  <img
                                    src={url}
                                    onError={onError}
                                    alt={att.file_name}
                                    className="rounded-xl max-h-80 object-cover border border-[var(--color-line)] hover:brightness-110 transition"
                                  />
                                </a>
                              )}
                            </SignedAttachment>
                          ) : att.mime_type.startsWith('audio/') ? (
                            <SignedAttachment key={att.id} bucket="group-attachments" fileUrl={att.file_url} autoRenew={false}>
                              {(url, onError) => (
                                <div className="flex items-center gap-2 bg-mv-canvas border border-[var(--color-line)] rounded-xl px-3 py-2.5">
                                  <audio controls src={url} onError={onError} className="h-9 max-w-xs" />
                                </div>
                              )}
                            </SignedAttachment>
                          ) : att.mime_type.startsWith('video/') ? (
                            <SignedAttachment key={att.id} bucket="group-attachments" fileUrl={att.file_url} autoRenew={false}>
                              {(url, onError) => (
                                <video
                                  controls
                                  preload="metadata"
                                  src={url}
                                  onError={onError}
                                  className="rounded-xl max-h-80 max-w-full border border-[var(--color-line)] bg-black"
                                />
                              )}
                            </SignedAttachment>
                          ) : (
                            <SignedAttachment key={att.id} bucket="group-attachments" fileUrl={att.file_url}>
                              {(url) => (
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-3 bg-mv-canvas border border-[var(--color-line)] rounded-xl px-3 py-2.5 hover:border-[var(--color-line-strong)] hover:bg-white/[0.03] transition-colors"
                                >
                                  <span className="w-10 h-10 rounded-lg bg-mv-accent/10 flex items-center justify-center shrink-0">
                                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-mv-accent" aria-hidden="true">
                                      <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5L14 3.5z" />
                                    </svg>
                                  </span>
                                  <span className="text-sm font-medium text-mv-text truncate">{att.file_name}</span>
                                </a>
                              )}
                            </SignedAttachment>
                          )
                        )}
                      </div>
                    )}
                    <div className="hidden group-hover:flex group-focus-within:flex absolute -top-4 right-4 surface-elevated !shadow-[0_8px_24px_-8px_rgb(0_0_0/0.6)] rounded-lg p-0.5 gap-0.5 z-10">
                      <button
                        onClick={() => setReplyingTo(message)}
                        title="Responder"
                        aria-label="Responder"
                        className="icon-btn w-8 h-8"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
                          <path d="M10 8V5l-7 7 7 7v-3.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
                        </svg>
                      </button>
                      {!isOwn && (
                        <button
                          onClick={() => setReportingMessageId(message.id)}
                          title="Denunciar mensagem"
                          aria-label="Denunciar mensagem"
                          className="icon-btn w-8 h-8 hover:!text-rose-400 hover:!bg-rose-500/10"
                        >
                          <ReportIcon className="w-[18px] h-[18px]" aria-hidden />
                        </button>
                      )}
                      {isOwn && (
                        <button
                          onClick={() => setConfirmingDeleteId(message.id)}
                          title="Excluir"
                          aria-label="Excluir mensagem"
                          className="icon-btn w-8 h-8 hover:!text-rose-400 hover:!bg-rose-500/10"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
                            <path d="M9 3a1 1 0 0 0-1 1v1H4a1 1 0 1 0 0 2h1v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7h1a1 1 0 1 0 0-2h-4V4a1 1 0 0 0-1-1H9zm1 6a1 1 0 1 1 2 0v8a1 1 0 1 1-2 0V9zm5-1a1 1 0 0 0-1 1v8a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1z" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {confirmingDeleteId === message.id && (
                      <div role="alertdialog" aria-label="Confirmar exclusão" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 animate-fade-in">
                        <span className="text-sm text-mv-text flex-1 min-w-[10rem]">Excluir esta mensagem?</span>
                        <button onClick={() => setConfirmingDeleteId(null)} className="btn-ghost h-8 px-3 text-sm">
                          Cancelar
                        </button>
                        <button autoFocus onClick={() => void handleDelete(message.id)} className="btn-danger h-8 px-3 text-sm">
                          Excluir
                        </button>
                      </div>
                    )}
                  </div>
                </div>
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
        <div className="h-6 px-5 flex items-center gap-2 text-xs text-mv-muted" aria-live="polite">
          {typingNames.length > 0 && (
            <>
              <span className="flex items-center gap-[3px] px-2 py-1 rounded-full bg-white/[0.05] border border-[var(--color-line)]">
                <span className="w-1.5 h-1.5 rounded-full bg-mv-muted animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-mv-muted animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-mv-muted animate-bounce" />
              </span>
              <span className="truncate animate-fade-in">
                {typingNames.length === 1 ? (
                  <><strong className="font-semibold text-mv-text">{typingNames[0]}</strong> está digitando…</>
                ) : (
                  `${typingNames.length} pessoas estão digitando…`
                )}
              </span>
            </>
          )}
        </div>
        <MessageComposer
          channelName={title}
          members={group.members}
          draftKey={`group-${group.id}`}
          placeholder={`Conversar em ${title}`}
          replyingTo={replyingTo}
          replyingToAuthor={replyingTo ? profileById[replyingTo.author_id] : undefined}
          onCancelReply={() => setReplyingTo(null)}
          onSend={handleSend}
          onTyping={notifyTyping}
        />
      </div>

      {reportingMessageId &&
        (() => {
          const msg = messages.find((m) => m.id === reportingMessageId)
          const author = msg ? profileById[msg.author_id] : undefined
          return (
            <ReportModal
              targetType="group_message"
              targetLabel={`mensagem de ${author?.display_name || author?.username || 'um membro'} em ${title || 'grupo'}`}
              groupMessageId={reportingMessageId}
              reportedUserId={msg?.author_id}
              onClose={() => setReportingMessageId(null)}
            />
          )
        })()}
    </section>
  )
}
