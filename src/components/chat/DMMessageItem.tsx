import { SignedAttachment } from './SignedAttachment'
import { memo, useMemo, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { InviteMessageCard } from './InviteMessageCard'
import { parseInviteMessage } from '../../lib/inviteMessage'
import { parseMessageContent } from '../../lib/messageFormatting'
import { describeMessageContent, parseStickerId } from '../../lib/stickers'
import { LinkPreviewCard, extractFirstUrl, isPureMediaMessage } from './LinkPreviewCard'
import type { DMMessage, Profile, DMMessageAttachment } from '../../types/database'
import { DownloadIcon, EditIcon, FileIcon, ReplyIcon, ReportIcon, TrashIcon } from '../ui/icons'
import { ChatImage, ChatVideo } from './ChatMedia'

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
  onReport,
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
  // Denunciar (só em mensagem de outra pessoa) — ver ReportModal.
  onReport?: (messageId: string) => void
  attachments?: DMMessageAttachment[]
}) {
  const inviteData = useMemo(() => parseInviteMessage(message.content), [message.content])
  // Figurinha não tem texto pra editar — o botão de editar some nela.
  const isSticker = useMemo(() => parseStickerId(message.content) !== null, [message.content])
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
          <ReplyIcon className="w-[18px] h-[18px]" aria-hidden />
        </button>
        {!isOwn && onReport && (
          <button
            title="Denunciar mensagem"
            aria-label="Denunciar mensagem"
            onClick={() => onReport(message.id)}
            className="icon-btn w-8 h-8 hover:!text-rose-400 hover:!bg-rose-500/10"
          >
            <ReportIcon className="w-[18px] h-[18px]" aria-hidden />
          </button>
        )}
        {isOwn && (
          <>
            {!isSticker && (
              <button
                title="Editar"
                aria-label="Editar"
                onClick={startEditing}
                className="icon-btn w-8 h-8"
              >
                <EditIcon className="w-[18px] h-[18px]" aria-hidden />
              </button>
            )}
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
              <TrashIcon className="w-[18px] h-[18px]" aria-hidden />
            </button>
          </>
        )}
      </div>

      {message.reply_to_id && (
        <div className="relative flex items-center gap-1.5 text-xs text-mv-muted ml-14 mb-1">
          <span aria-hidden="true" className="absolute -left-9 top-1/2 w-7 h-2.5 border-l-2 border-t-2 border-[var(--color-line-strong)] rounded-tl-md" />
          {replyToMessage ? (
            <>
              <span className="font-semibold text-mv-text shrink-0">
                {replyToAuthor?.display_name || replyToAuthor?.username || 'alguém'}
              </span>
              <span className="truncate max-w-md opacity-80">{describeMessageContent(replyToMessage.content)}</span>
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
            <span className="invisible group-hover:visible text-[10px] text-mv-muted/80 pt-[5px] tabular-nums">
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
              <span className="text-[11px] text-mv-muted/80 tabular-nums shrink-0">{formatTime(message.created_at)}</span>
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
                className="w-full bg-mv-canvas text-mv-text text-[15px] px-3 py-2.5 outline-none resize-none"
                rows={2}
              />
              {editError && <p className="text-xs text-rose-400 mt-1">{editError}</p>}
              <p className="text-xs text-mv-muted mt-1.5">
                <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-white/[0.06] border border-[var(--color-line)]">esc</kbd> para{' '}
                <button onClick={() => setEditing(false)} className="text-mv-accent font-medium hover:underline">cancelar</button> ·{' '}
                <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-white/[0.06] border border-[var(--color-line)]">enter</kbd> para{' '}
                <button onClick={handleSaveEdit} className="text-mv-accent font-medium hover:underline">salvar</button>
              </p>
            </div>
          ) : inviteData ? (
            <div className="mt-1">
              <InviteMessageCard invite={inviteData} />
            </div>
          ) : pureMedia ? null : (
            <p className="text-[15px] text-mv-text/95 whitespace-pre-wrap break-words leading-[1.4rem]">
              {renderedContent}
              {message.edited_at && <span className="text-[10px] text-mv-muted/80 ml-1">(editado)</span>}
            </p>
          )}
          {firstUrl ? <LinkPreviewCard url={firstUrl} /> : null}
          {attachments && attachments.length > 0 && (
            <div className="mt-2 flex flex-col gap-2 max-w-md">
              {attachments.map((att) =>
                att.mime_type.startsWith('image/') ? (
                  <SignedAttachment key={att.id} bucket="dm-attachments" fileUrl={att.file_url}>
                    {(url, onError) => (
                      <ChatImage url={url} name={att.file_name} onError={onError} />
                    )}
                  </SignedAttachment>
                ) : att.mime_type.startsWith('audio/') ? (
                  <SignedAttachment key={att.id} bucket="dm-attachments" fileUrl={att.file_url} autoRenew={false}>
                    {(url, onError) => (
                      <div className="flex items-center gap-2 bg-mv-canvas border border-[var(--color-line)] rounded-xl px-3 py-2.5">
                        <DownloadIcon className="w-5 h-5 text-mv-accent shrink-0" aria-hidden />
                        <audio controls src={url} onError={onError} className="h-9 max-w-xs" />
                      </div>
                    )}
                  </SignedAttachment>
                ) : att.mime_type.startsWith('video/') ? (
                  <SignedAttachment key={att.id} bucket="dm-attachments" fileUrl={att.file_url} autoRenew={false}>
                    {(url, onError) => (
                      <ChatVideo url={url} name={att.file_name} onError={onError} />
                    )}
                  </SignedAttachment>
                ) : (
                  <SignedAttachment key={att.id} bucket="dm-attachments" fileUrl={att.file_url}>
                    {(url) => (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 bg-mv-canvas border border-[var(--color-line)] rounded-xl px-3 py-2.5 hover:border-[var(--color-line-strong)] hover:bg-white/[0.03] transition-colors"
                      >
                        <span className="w-10 h-10 rounded-lg bg-mv-accent/10 flex items-center justify-center shrink-0">
                          <FileIcon className="w-5 h-5 text-mv-accent" aria-hidden />
                        </span>
                        <span className="text-sm font-medium text-mv-text truncate">{att.file_name}</span>
                      </a>
                    )}
                  </SignedAttachment>
                )
              )}
            </div>
          )}
          {confirmingDelete && (
            <div role="alertdialog" aria-label="Confirmar exclusão" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 animate-fade-in">
              <span className="text-sm text-mv-text flex-1 min-w-[10rem]">Excluir esta mensagem?</span>
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
