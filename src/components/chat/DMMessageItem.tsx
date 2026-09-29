import { safeHttpUrl } from '../../lib/messageFormatting'
import { memo, useMemo, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { InviteMessageCard } from './InviteMessageCard'
import { parseInviteMessage } from '../../lib/inviteMessage'
import { parseMessageContent } from '../../lib/messageFormatting'
import { LinkPreviewCard, extractFirstUrl, isPureMediaMessage } from './LinkPreviewCard'
import type { DMMessage, Profile, DMMessageAttachment } from '../../types/database'

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

// Callbacks recebem a mensagem/id como argumento pra que o DMChatArea
// possa passar funções estáveis e o React.memo (lá embaixo) evite
// re-renderizar todas as mensagens a cada tecla digitada/mensagem nova.
function DMMessageItemImpl({
  message,
  author,
  showHeader,
  isOwn,
  replyToMessage,
  replyToAuthor,
  onEdit,
  onDelete,
  onReply,
  attachments,
}: {
  message: DMMessage
  author: Profile | undefined
  showHeader: boolean
  isOwn: boolean
  replyToMessage: DMMessage | null
  replyToAuthor: Profile | undefined
  onEdit: (messageId: string, content: string) => Promise<{ error: string | null }>
  onDelete: (messageId: string) => void
  onReply: (message: DMMessage) => void
  attachments?: DMMessageAttachment[]
}) {
  const inviteData = useMemo(() => parseInviteMessage(message.content), [message.content])
  const renderedContent = useMemo(() => parseMessageContent(message.content, []), [message.content])
  const firstUrl = useMemo(() => extractFirstUrl(message.content), [message.content])
  const pureMedia = useMemo(() => isPureMediaMessage(message.content), [message.content])
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(message.content)
  const [editError, setEditError] = useState<string | null>(null)
  // Confirmação de exclusão inline (antes era um confirm() nativo)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  function startEditing() {
    // sempre parte do texto atual (antes ficava o de quando montou)
    setEditValue(message.content)
    setEditError(null)
    setEditing(true)
  }

  async function handleSaveEdit() {
    const next = editValue.trim()
    if (next.length === 0) return
    if (next === message.content) {
      setEditing(false)
      return
    }
    const { error } = await onEdit(message.id, next)
    if (error) setEditError(error)
    else setEditing(false)
  }

  return (
    <div className={`group relative px-4 py-0.5 hover:bg-white/[0.025] transition-colors ${showHeader ? 'mt-3 pt-1.5' : ''}`}>
      <div className="hidden group-hover:flex group-focus-within:flex absolute -top-4 right-4 surface-elevated !shadow-[0_8px_24px_-8px_rgb(0_0_0/0.6)] rounded-lg p-0.5 gap-0.5 z-10">
        <button
          title="Responder"
          aria-label="Responder"
          onClick={() => onReply(message)}
          className="icon-btn w-8 h-8"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
            <path d="M10 8V5l-7 7 7 7v-3.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
          </svg>
        </button>
        {isOwn && (
          <>
            <button
              title="Editar"
              aria-label="Editar"
              onClick={startEditing}
              className="icon-btn w-8 h-8"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
                <path d="M16.3 3.3a2.4 2.4 0 0 1 3.4 3.4L8.4 18l-4.6 1.2L5 14.6 16.3 3.3zm-1.4 3.5L6.8 14.9l-.4 1.7 1.7-.4 8.1-8.1-1.3-1.3z" />
              </svg>
            </button>
            <button
              title="Excluir (Shift+clique exclui sem confirmar)"
              aria-label="Excluir mensagem"
              onClick={(e) => {
                // antes excluía direto, sem nenhuma confirmação
                if (e.shiftKey) onDelete(message.id)
                else setConfirmingDelete(true)
              }}
              className="icon-btn w-8 h-8 hover:!text-rose-400 hover:!bg-rose-500/10"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
                <path d="M9 3a1 1 0 0 0-1 1v1H4a1 1 0 1 0 0 2h1v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7h1a1 1 0 1 0 0-2h-4V4a1 1 0 0 0-1-1H9zm1 6a1 1 0 1 1 2 0v8a1 1 0 1 1-2 0V9zm5-1a1 1 0 0 0-1 1v8a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1z" />
              </svg>
            </button>
          </>
        )}
      </div>

      {message.reply_to_id && (
        <div className="relative flex items-center gap-1.5 text-xs text-discord-text-muted ml-14 mb-1">
          <span aria-hidden="true" className="absolute -left-9 top-1/2 w-7 h-2.5 border-l-2 border-t-2 border-[var(--color-line-strong)] rounded-tl-md" />
          {replyToMessage ? (
            <>
              <span className="font-semibold text-discord-text shrink-0">
                {replyToAuthor?.display_name || replyToAuthor?.username || 'alguém'}
              </span>
              <span className="truncate max-w-md opacity-80">{replyToMessage.content}</span>
            </>
          ) : (
            <span className="italic">Mensagem original não encontrada</span>
          )}
        </div>
      )}

      <div className="flex gap-4">
        {showHeader ? (
          <div className="pt-0.5">
            <Avatar
              name={author?.username ?? '?'}
              avatarUrl={author?.avatar_url}
              decorationUrl={author?.avatar_decoration_url}
              size={40}
            />
          </div>
        ) : (
          <div className="w-10 shrink-0 flex items-start justify-center">
            <span className="invisible group-hover:visible text-[10px] text-discord-text-muted/80 pt-[5px] tabular-nums">
              {formatTime(message.created_at)}
            </span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          {showHeader && (
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-semibold text-white text-[15px] leading-5 truncate">
                {author?.display_name || author?.username || 'Usuário'}
              </span>
              <span className="text-[11px] text-discord-text-muted/80 tabular-nums shrink-0">{formatTime(message.created_at)}</span>
            </div>
          )}

          {editing ? (
            <div className="mt-0.5">
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSaveEdit()
                  }
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setEditing(false)
                  }
                }}
                autoFocus
                className="w-full bg-discord-darker text-discord-text text-[15px] px-3 py-2.5 outline-none resize-none"
                rows={2}
              />
              {editError && <p className="text-xs text-rose-400 mt-1">{editError}</p>}
              <p className="text-xs text-discord-text-muted mt-1.5">
                <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-white/[0.06] border border-[var(--color-line)]">esc</kbd> para{' '}
                <button onClick={() => setEditing(false)} className="text-discord-blurple font-medium hover:underline">cancelar</button> ·{' '}
                <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-white/[0.06] border border-[var(--color-line)]">enter</kbd> para{' '}
                <button onClick={handleSaveEdit} className="text-discord-blurple font-medium hover:underline">salvar</button>
              </p>
            </div>
          ) : inviteData ? (
            <div className="mt-1">
              <InviteMessageCard invite={inviteData} />
            </div>
          ) : pureMedia ? null : (
            <p className="text-[15px] text-discord-text/95 whitespace-pre-wrap break-words leading-[1.4rem]">
              {renderedContent}
              {message.edited_at && <span className="text-[10px] text-discord-text-muted/80 ml-1">(editado)</span>}
            </p>
          )}
          {firstUrl ? <LinkPreviewCard url={firstUrl} /> : null}
          {attachments && attachments.length > 0 && (
            <div className="mt-2 flex flex-col gap-2 max-w-md">
              {attachments.map((att) =>
                att.mime_type.startsWith('image/') ? (
                  <a key={att.id} href={safeHttpUrl(att.file_url) ?? undefined} target="_blank" rel="noreferrer">
                    <img
                      src={safeHttpUrl(att.file_url) ?? undefined}
                      alt={att.file_name}
                      className="rounded-xl max-h-80 object-cover border border-[var(--color-line)] hover:brightness-110 transition"
                    />
                  </a>
                ) : att.mime_type.startsWith('audio/') ? (
                  <div key={att.id} className="flex items-center gap-2 bg-discord-darker border border-[var(--color-line)] rounded-xl px-3 py-2.5">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-discord-blurple shrink-0">
                      <path d="M12 3a1 1 0 0 1 1 1v9.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4l3.3 3.3V4a1 1 0 0 1 1-1z" />
                    </svg>
                    <audio controls src={safeHttpUrl(att.file_url) ?? undefined} className="h-9 max-w-xs" />
                  </div>
                ) : (
                  <a
                    key={att.id}
                    href={safeHttpUrl(att.file_url) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 bg-discord-darker border border-[var(--color-line)] rounded-xl px-3 py-2.5 hover:border-[var(--color-line-strong)] hover:bg-white/[0.03] transition-colors"
                  >
                    <span className="w-10 h-10 rounded-lg bg-discord-blurple/10 flex items-center justify-center shrink-0">
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-discord-blurple">
                        <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5L14 3.5z" />
                      </svg>
                    </span>
                    <span className="text-sm font-medium text-discord-text truncate">{att.file_name}</span>
                  </a>
                )
              )}
            </div>
          )}
          {confirmingDelete && (
            <div role="alertdialog" aria-label="Confirmar exclusão" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 animate-fade-in">
              <span className="text-sm text-discord-text flex-1 min-w-[10rem]">Excluir esta mensagem?</span>
              <button onClick={() => setConfirmingDelete(false)} className="btn-ghost h-8 px-3 text-sm">
                Cancelar
              </button>
              <button
                autoFocus
                onClick={() => {
                  setConfirmingDelete(false)
                  onDelete(message.id)
                }}
                className="btn-danger h-8 px-3 text-sm"
              >
                Excluir
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const DMMessageItem = memo(DMMessageItemImpl)
