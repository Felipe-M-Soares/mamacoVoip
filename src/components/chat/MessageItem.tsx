import { SignedAttachment } from './SignedAttachment'
import { memo, useMemo, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { ContextMenu, useContextMenuState } from '../ui/ContextMenu'
import { parseMessageContent } from '../../lib/messageFormatting'
import { describeMessageContent, parseStickerId } from '../../lib/stickers'
import { welcomeMessageParts } from '../../lib/welcomeMessages'
import { LinkPreviewCard, extractFirstUrl, isPureMediaMessage } from './LinkPreviewCard'
import type { Message, MessageAttachment, MessageReaction, Profile, ServerEmoji, Thread, Role } from '../../types/database'
import { AddReactionIcon, ArrowRightIcon, DownloadIcon, EditIcon, FileIcon, PinIcon, ReplyIcon, ThreadIcon, TrashIcon } from '../ui/icons'
import { copyText } from '../../lib/copyText'
import { ChatImage, ChatVideo } from './ChatMedia'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉']

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatFullDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Todas as callbacks recebem o id/mensagem como argumento (em vez de o
// MessageList criar uma arrow function nova por mensagem a cada render) —
// assim o React.memo lá embaixo consegue pular o re-render de TODAS as
// mensagens que não mudaram quando chega uma mensagem nova, alguém
// reage, digita, etc. Antes, cada evento desses re-renderizava (e
// re-parseava o markdown de) todas as mensagens da tela.
function MessageItemImpl({
  message,
  author,
  authorRoleColor,
  showHeader,
  isOwn,
  canModerate,
  replyToMessage,
  replyToAuthor,
  attachments,
  reactions,
  currentUserId,
  members,
  emojis,
  roles,
  onEdit,
  onDelete,
  onReply,
  onToggleReaction,
  onViewProfile,
  onPin,
  onUnpin,
  thread,
  replyCount,
  onCreateThread,
  onOpenThread,
  onJumpToMessage,
  isHighlighted,
  onForward,
  selectionMode,
  selected,
  onToggleSelect,
  onReport,
}: {
  message: Message
  author: Profile | undefined
  authorRoleColor?: string
  showHeader: boolean
  isOwn: boolean
  canModerate: boolean
  replyToMessage: Message | null
  replyToAuthor: Profile | undefined
  attachments: MessageAttachment[]
  reactions: MessageReaction[]
  currentUserId: string | undefined
  members: Profile[]
  emojis: ServerEmoji[]
  roles: Role[]
  onEdit: (messageId: string, content: string) => Promise<{ error: string | null }>
  onDelete: (messageId: string) => void
  onReply: (message: Message) => void
  onToggleReaction: (messageId: string, emoji: string) => void
  onViewProfile: (profile: Profile) => void
  onPin?: (messageId: string) => void
  onUnpin?: (messageId: string) => void
  thread?: Thread
  replyCount?: number
  onCreateThread?: (messageId: string) => void
  onOpenThread?: (thread: Thread) => void
  onJumpToMessage?: (messageId: string) => void
  isHighlighted?: boolean
  onForward?: (messageId: string) => void
  selectionMode?: boolean
  selected?: boolean
  onToggleSelect?: (messageId: string) => void
  onReport?: (messageId: string) => void
  }) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(message.content)
  const [editError, setEditError] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [showReactionPicker, setShowReactionPicker] = useState(false)
  // Confirmação de exclusão inline (antes era um confirm() nativo)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const { menuState, openMenu, closeMenu } = useContextMenuState()
  const { menuState: userMenuState, openMenu: openUserMenu, closeMenu: closeUserMenu } = useContextMenuState()

  // Sempre começa a edição a partir do texto ATUAL — antes o campo
  // guardava o conteúdo de quando a mensagem foi montada, então editar de
  // novo (ou depois de uma edição vinda de outro dispositivo) mostrava o
  // texto velho.
  function startEditing() {
    setEditValue(message.content)
    setEditError(null)
    setEditing(true)
  }

  async function handleSaveEdit() {
    const next = editValue.trim()
    if (next.length === 0 || savingEdit) return
    if (next === message.content) {
      setEditing(false)
      return
    }
    setSavingEdit(true)
    const { error } = await onEdit(message.id, next)
    setSavingEdit(false)
    // Antes um erro aqui era engolido: a caixa ficava aberta sem nenhuma
    // explicação.
    if (error) setEditError(error)
    else setEditing(false)
  }

  function handleDelete(e?: { shiftKey?: boolean }) {
    // Shift+clique pula a confirmação (igual a apps de chat populares) — antes o botão
    // da barra de ferramentas excluía direto, sem confirmar nada, enquanto
    // o menu de contexto pedia confirmação.
    if (e?.shiftKey) onDelete(message.id)
    else setConfirmingDelete(true)
  }

  // agrupa reações por emoji
  const reactionGroups = useMemo(
    () =>
      reactions.reduce<Record<string, MessageReaction[]>>((acc, r) => {
        ;(acc[r.emoji] ??= []).push(r)
        return acc
      }, {}),
    [reactions]
  )
  // Figurinha não tem texto pra editar — o botão de editar some nela.
  const isSticker = useMemo(() => parseStickerId(message.content) !== null, [message.content])
  const renderedContent = useMemo(
    () => parseMessageContent(message.content, members, emojis, roles),
    [message.content, members, emojis, roles]
  )
  const firstUrl = useMemo(() => extractFirstUrl(message.content), [message.content])
  const pureMedia = useMemo(() => isPureMediaMessage(message.content), [message.content])
  // Só visual: destaca a mensagem quando ela menciona você (ou @everyone/@here)
  const mentionsMe = useMemo(() => {
    if (!currentUserId || message.author_id === currentUserId) return false
    const me = members.find((m) => m.id === currentUserId)
    const words = [...message.content.matchAll(/@(everyone|here|[a-zA-Z0-9_.]+)/g)].map((m) => m[1].toLowerCase())
    return words.some((w) => w === 'everyone' || w === 'here' || (me && w === me.username.toLowerCase()))
  }, [message.content, message.author_id, members, currentUserId])

  if (message.system_event === 'member_join') {
    const welcome = welcomeMessageParts(message.id)
    const authorReactions = reactions.filter((r) => r.user_id === currentUserId && r.emoji === '👋')
    return (
      <div className="mx-2 px-2 py-1.5 flex items-center gap-3 group rounded-lg hover:bg-white/[0.025] transition-colors">
        <span className="w-10 flex justify-center shrink-0">
          <span className="w-7 h-7 rounded-full bg-mv-green/10 border border-mv-green/20 flex items-center justify-center">
            <ArrowRightIcon className="w-4 h-4 text-mv-green" aria-hidden />
          </span>
        </span>
        <p className="text-sm text-mv-muted min-w-0 truncate">
          {welcome.before}
          <button onClick={() => author && onViewProfile(author)} className="font-semibold text-mv-text hover:underline">
            {author?.display_name || author?.username || 'Alguém'}
          </button>
          {welcome.after}
        </p>
        <span className="text-[11px] text-mv-muted/80 shrink-0 tabular-nums">{formatTime(message.created_at)}</span>
        {currentUserId && currentUserId !== message.author_id && (
          <button
            onClick={() => onToggleReaction(message.id, '👋')}
            className={`ml-auto text-xs font-medium h-7 px-3 rounded-full border shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all ${
              authorReactions.length > 0
                ? 'bg-mv-accent/15 border-mv-accent/50 text-mv-text opacity-100'
                : 'bg-white/[0.03] border-[var(--color-line-strong)] text-mv-muted hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            👋 Acenar
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      className={`group relative px-4 py-0.5 transition-colors animate-fade-slide-in ${showHeader ? 'mt-3 pt-1.5' : ''} ${
        mentionsMe
          ? 'bg-mv-accent/[0.07] hover:bg-mv-accent/[0.1] shadow-[inset_2px_0_0_0_var(--color-mv-accent)]'
          : 'hover:bg-white/[0.025]'
      }`}
      onMouseLeave={() => setShowReactionPicker(false)}
      onContextMenu={openMenu}
    >
      {/* barra de ferramentas no hover */}
      <div className="hidden group-hover:flex group-focus-within:flex absolute -top-4 right-4 surface-elevated !shadow-[0_8px_24px_-8px_rgb(0_0_0/0.6)] rounded-lg p-0.5 gap-0.5 z-10">
        <button
          title="Reagir"
          aria-label="Reagir"
          onClick={() => setShowReactionPicker((v) => !v)}
          className="icon-btn w-8 h-8"
        >
          <AddReactionIcon className="w-[18px] h-[18px]" aria-hidden />
        </button>
        <button
          title="Responder"
          aria-label="Responder"
          onClick={() => onReply(message)}
          className="icon-btn w-8 h-8"
        >
          <ReplyIcon className="w-[18px] h-[18px]" aria-hidden />
        </button>
        {isOwn && !isSticker && (
          <button
            title="Editar"
            aria-label="Editar"
            onClick={startEditing}
            className="icon-btn w-8 h-8"
          >
            <EditIcon className="w-[18px] h-[18px]" aria-hidden />
          </button>
        )}
        {(isOwn || canModerate) && (
          <button
            title="Excluir (Shift+clique exclui sem confirmar)"
            aria-label="Excluir mensagem"
            onClick={(e) => handleDelete(e)}
            className="icon-btn w-8 h-8 hover:!text-rose-400 hover:!bg-rose-500/10"
          >
            <TrashIcon className="w-[18px] h-[18px]" aria-hidden />
          </button>
        )}
      </div>

      {showReactionPicker && (
        <div className="absolute -top-14 right-4 surface-elevated rounded-xl p-1.5 flex gap-0.5 z-20 max-w-xs flex-wrap animate-pop-in">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                onToggleReaction(message.id, emoji)
                setShowReactionPicker(false)
              }}
              aria-label={`Reagir com ${emoji}`}
              className="w-8 h-8 rounded-lg text-lg flex items-center justify-center hover:bg-white/[0.08] hover:scale-110 transition-transform"
            >
              {emoji}
            </button>
          ))}
          {emojis.length > 0 && <div className="w-px bg-[var(--color-line-strong)] mx-1 my-1" />}
          {emojis.slice(0, 12).map((e) => (
            <button
              key={e.id}
              onClick={() => {
                onToggleReaction(message.id, `:${e.name}:`)
                setShowReactionPicker(false)
              }}
              title={`:${e.name}:`}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/[0.08] hover:scale-110 transition-transform"
            >
              <img src={e.image_url} alt={e.name} className="w-5 h-5 object-contain" />
            </button>
          ))}
        </div>
      )}

      {/* preview da mensagem respondida */}
      {message.reply_to_id && (
        <button
          onClick={() => replyToMessage && onJumpToMessage?.(replyToMessage.id)}
          className="relative flex items-center gap-1.5 text-xs text-mv-muted ml-14 mb-1 hover:text-mv-text text-left max-w-full"
        >
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
        </button>
      )}

      <div
        id={`message-${message.id}`}
        onClick={selectionMode && onToggleSelect ? () => onToggleSelect(message.id) : undefined}
        className={`flex gap-4 ${selectionMode ? 'cursor-pointer' : ''} ${
          isHighlighted
            ? 'bg-amber-400/10 ring-1 ring-amber-400/30 -mx-2 px-2 rounded-lg transition-colors'
            : selected
              ? 'bg-mv-accent/10 ring-1 ring-mv-accent/30 -mx-2 px-2 rounded-lg'
              : ''
        }`}
      >
        {selectionMode && (
          <div className="pt-2 shrink-0">
            <input type="checkbox" checked={Boolean(selected)} readOnly aria-label="Selecionar mensagem" className="w-4 h-4 accent-mv-accent" />
          </div>
        )}
        {showHeader ? (
          <div className="pt-0.5">
            <button
              onClick={() => author && onViewProfile(author)}
              onContextMenu={openUserMenu}
              aria-label={`Ver perfil de ${author?.display_name || author?.username || 'usuário'}`}
              className="block rounded-full transition-transform hover:scale-[1.04] active:scale-95"
            >
              <Avatar
                name={author?.username ?? '?'}
                avatarUrl={author?.avatar_url}
                decorationUrl={author?.avatar_decoration_url}
                size={40}
              />
            </button>
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
              <button
                onClick={() => author && onViewProfile(author)}
                onContextMenu={openUserMenu}
                style={authorRoleColor ? { color: authorRoleColor } : undefined}
                className={`font-semibold text-[15px] leading-5 hover:underline truncate ${authorRoleColor ? '' : 'text-white'}`}
              >
                {author?.display_name || author?.username || 'Usuário'}
              </button>
              <span
                className="text-[11px] text-mv-muted/80 tabular-nums shrink-0"
                title={formatFullDate(message.created_at)}
              >
                {formatTime(message.created_at)}
              </span>
              {message.pinned_at && (
                <span className="chip !py-0 !text-[10px] !text-mv-accent !bg-mv-accent/10 !border-mv-accent/20 shrink-0">
                  <PinIcon className="w-3 h-3" aria-hidden />
                  Fixada
                </span>
              )}
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
                    // não deixa o Esc "vazar" e fechar painel/modal em volta
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
          ) : pureMedia ? null : (
            <p className="text-[15px] text-mv-text/95 whitespace-pre-wrap break-words leading-[1.4rem]">
              {renderedContent}
              {message.edited_at && (
                <span className="text-[10px] text-mv-muted/80 ml-1" title={formatFullDate(message.edited_at)}>(editado)</span>
              )}
            </p>
          )}
          {firstUrl ? <LinkPreviewCard url={firstUrl} /> : null}
          {thread && (
            <button
              onClick={() => onOpenThread?.(thread)}
              className="mt-1.5 inline-flex items-center gap-2 h-8 px-3 rounded-lg text-xs font-medium bg-white/[0.04] border border-[var(--color-line)] text-mv-text hover:bg-white/[0.07] transition-colors"
            >
              <ThreadIcon className="w-3.5 h-3.5 text-mv-accent" aria-hidden />
              {replyCount} {replyCount === 1 ? 'resposta' : 'respostas'} — {thread.name}
            </button>
          )}

          {attachments.length > 0 && (
            <div className="mt-2 flex flex-col gap-2 max-w-md">
              {attachments.map((att) =>
                att.mime_type.startsWith('image/') ? (
                  <SignedAttachment key={att.id} bucket="attachments" fileUrl={att.file_url}>
                    {(url, onError) => (
                      <ChatImage url={url} name={att.file_name} onError={onError} />
                    )}
                  </SignedAttachment>
                ) : att.mime_type.startsWith('audio/') ? (
                  <SignedAttachment key={att.id} bucket="attachments" fileUrl={att.file_url} autoRenew={false}>
                    {(url, onError) => (
                      <div className="flex items-center gap-2 bg-mv-canvas border border-[var(--color-line)] rounded-xl px-3 py-2.5">
                        <DownloadIcon className="w-5 h-5 text-mv-accent shrink-0" aria-hidden />
                        <audio controls src={url} onError={onError} className="h-9 max-w-xs" />
                      </div>
                    )}
                  </SignedAttachment>
                ) : att.mime_type.startsWith('video/') ? (
                  <SignedAttachment key={att.id} bucket="attachments" fileUrl={att.file_url} autoRenew={false}>
                    {(url, onError) => (
                      <ChatVideo url={url} name={att.file_name} onError={onError} />
                    )}
                  </SignedAttachment>
                ) : (
                  <SignedAttachment key={att.id} bucket="attachments" fileUrl={att.file_url}>
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
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-mv-text truncate">{att.file_name}</p>
                          <p className="text-xs text-mv-muted">{formatFileSize(att.file_size)}</p>
                        </div>
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

          {Object.keys(reactionGroups).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {Object.entries(reactionGroups).map(([emoji, group]) => {
                const reactedByMe = group.some((r) => r.user_id === currentUserId)
                return (
                  <button
                    key={emoji}
                    onClick={() => onToggleReaction(message.id, emoji)}
                    aria-pressed={reactedByMe}
                    aria-label={`${emoji} ${group.length}`}
                    className={`flex items-center gap-1.5 h-7 px-2 rounded-full text-xs font-semibold border tabular-nums transition-all active:scale-95 ${
                      reactedByMe
                        ? 'bg-mv-accent/15 border-mv-accent/60 text-mv-text'
                        : 'bg-white/[0.04] border-[var(--color-line)] text-mv-muted hover:border-[var(--color-line-strong)] hover:bg-white/[0.07] hover:text-mv-text'
                    }`}
                  >
                    {(() => {
                      const customMatch = emoji.match(/^:([a-z0-9_]+):$/)
                      const customEmoji = customMatch ? emojis.find((e) => e.name === customMatch[1]) : undefined
                      return customEmoji ? (
                        <img src={customEmoji.image_url} alt={emoji} title={emoji} className="w-4 h-4 object-contain" />
                      ) : (
                        <span className="text-sm">{emoji}</span>
                      )
                    })()}
                    <span>{group.length}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {menuState && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          onClose={closeMenu}
          items={[
            { label: 'Responder', onClick: () => onReply(message) },
            { label: 'Copiar texto', onClick: () => copyText(message.content) },
            {
              label: 'Copiar link da mensagem',
              onClick: () => copyText(`mamacos://message/${message.channel_id}/${message.id}`),
            },
            { label: 'Adicionar reação', onClick: () => setShowReactionPicker(true) },
            ...(onForward ? [{ label: 'Encaminhar', onClick: () => onForward(message.id) }] : []),
            ...(!thread && onCreateThread ? [{ label: 'Criar thread', onClick: () => onCreateThread(message.id) }] : []),
            ...(canModerate && (onPin || onUnpin)
              ? [
                  message.pinned_at
                    ? { label: 'Desafixar mensagem', onClick: () => onUnpin?.(message.id) }
                    : { label: 'Fixar mensagem', onClick: () => onPin?.(message.id) },
                ]
              : []),
            ...(isOwn && !isSticker ? [{ label: 'Editar', onClick: startEditing }] : []),
            ...(!isOwn && onReport ? [{ label: 'Denunciar mensagem', onClick: () => onReport(message.id) }] : []),
            ...(isOwn || canModerate
              ? [
                  {
                    label: 'Excluir',
                    danger: true,
                    divider: true,
                    onClick: () => handleDelete(),
                  },
                ]
              : []),
          ]}
        />
      )}

      {userMenuState && author && (
        <ContextMenu
          x={userMenuState.x}
          y={userMenuState.y}
          onClose={closeUserMenu}
          items={[
            { label: 'Ver perfil', onClick: () => onViewProfile(author) },
            { label: 'Copiar nome de usuário', onClick: () => copyText(author.username) },
          ]}
        />
      )}
    </div>
  )
}

export const MessageItem = memo(MessageItemImpl)
