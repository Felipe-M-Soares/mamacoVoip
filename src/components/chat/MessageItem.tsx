import { safeHttpUrl } from '../../lib/messageFormatting'
import { memo, useMemo, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { ContextMenu, useContextMenuState } from '../ui/ContextMenu'
import { parseMessageContent } from '../../lib/messageFormatting'
import { LinkPreviewCard, extractFirstUrl, isPureMediaMessage } from './LinkPreviewCard'
import type { Message, MessageAttachment, MessageReaction, Profile, ServerEmoji, Thread, Role } from '../../types/database'

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
    // Shift+clique pula a confirmação (igual o Discord) — antes o botão
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
    const authorReactions = reactions.filter((r) => r.user_id === currentUserId && r.emoji === '👋')
    return (
      <div className="mx-2 px-2 py-1.5 flex items-center gap-3 group rounded-lg hover:bg-white/[0.025] transition-colors">
        <span className="w-10 flex justify-center shrink-0">
          <span className="w-7 h-7 rounded-full bg-discord-green/10 border border-discord-green/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-discord-green">
              <path d="M12 4l-1.4 1.4L16.2 11H4v2h12.2l-5.6 5.6L12 20l8-8-8-8z" />
            </svg>
          </span>
        </span>
        <p className="text-sm text-discord-text-muted min-w-0 truncate">
          <button onClick={() => author && onViewProfile(author)} className="font-medium text-discord-text hover:underline">
            {author?.display_name || author?.username || 'Alguém'}
          </button>{' '}
          entrou no servidor.
        </p>
        <span className="text-[11px] text-discord-text-muted/80 shrink-0 tabular-nums">{formatTime(message.created_at)}</span>
        {currentUserId && currentUserId !== message.author_id && (
          <button
            onClick={() => onToggleReaction(message.id, '👋')}
            className={`ml-auto text-xs font-medium h-7 px-3 rounded-full border shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all ${
              authorReactions.length > 0
                ? 'bg-discord-blurple/15 border-discord-blurple/50 text-discord-text opacity-100'
                : 'bg-white/[0.03] border-[var(--color-line-strong)] text-discord-text-muted hover:text-white hover:bg-white/[0.06]'
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
          ? 'bg-discord-blurple/[0.07] hover:bg-discord-blurple/[0.1] shadow-[inset_2px_0_0_0_var(--color-discord-blurple)]'
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
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM8.5 10a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm7 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM12 17.5c-2.3 0-4.3-1.3-5.3-3.2a1 1 0 1 1 1.8-.9c.7 1.3 2 2.1 3.5 2.1s2.8-.8 3.5-2.1a1 1 0 1 1 1.8.9c-1 1.9-3 3.2-5.3 3.2z" />
          </svg>
        </button>
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
        )}
        {(isOwn || canModerate) && (
          <button
            title="Excluir (Shift+clique exclui sem confirmar)"
            aria-label="Excluir mensagem"
            onClick={(e) => handleDelete(e)}
            className="icon-btn w-8 h-8 hover:!text-rose-400 hover:!bg-rose-500/10"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
              <path d="M9 3a1 1 0 0 0-1 1v1H4a1 1 0 1 0 0 2h1v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7h1a1 1 0 1 0 0-2h-4V4a1 1 0 0 0-1-1H9zm1 6a1 1 0 1 1 2 0v8a1 1 0 1 1-2 0V9zm5-1a1 1 0 0 0-1 1v8a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1z" />
            </svg>
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
          className="relative flex items-center gap-1.5 text-xs text-discord-text-muted ml-14 mb-1 hover:text-discord-text text-left max-w-full"
        >
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
        </button>
      )}

      <div
        id={`message-${message.id}`}
        onClick={selectionMode && onToggleSelect ? () => onToggleSelect(message.id) : undefined}
        className={`flex gap-4 ${selectionMode ? 'cursor-pointer' : ''} ${
          isHighlighted
            ? 'bg-amber-400/10 ring-1 ring-amber-400/30 -mx-2 px-2 rounded-lg transition-colors'
            : selected
              ? 'bg-discord-blurple/10 ring-1 ring-discord-blurple/30 -mx-2 px-2 rounded-lg'
              : ''
        }`}
      >
        {selectionMode && (
          <div className="pt-2 shrink-0">
            <input type="checkbox" checked={Boolean(selected)} readOnly aria-label="Selecionar mensagem" className="w-4 h-4 accent-discord-blurple" />
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
            <span className="invisible group-hover:visible text-[10px] text-discord-text-muted/80 pt-[5px] tabular-nums">
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
                className="text-[11px] text-discord-text-muted/80 tabular-nums shrink-0"
                title={formatFullDate(message.created_at)}
              >
                {formatTime(message.created_at)}
              </span>
              {message.pinned_at && (
                <span className="chip !py-0 !text-[10px] !text-discord-blurple !bg-discord-blurple/10 !border-discord-blurple/20 shrink-0">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
                    <path d="M16 3l5 5-3.5 3.5L19 14l-1.4 1.4-3.5-2.5L10.5 16.5 9 15l3.6-3.6L10 8.9 13.5 5.4 16 3z" />
                  </svg>
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
          ) : pureMedia ? null : (
            <p className="text-[15px] text-discord-text/95 whitespace-pre-wrap break-words leading-[1.4rem]">
              {renderedContent}
              {message.edited_at && (
                <span className="text-[10px] text-discord-text-muted/80 ml-1" title={formatFullDate(message.edited_at)}>(editado)</span>
              )}
            </p>
          )}
          {firstUrl ? <LinkPreviewCard url={firstUrl} /> : null}
          {thread && (
            <button
              onClick={() => onOpenThread?.(thread)}
              className="mt-1.5 inline-flex items-center gap-2 h-8 px-3 rounded-lg text-xs font-medium bg-white/[0.04] border border-[var(--color-line)] text-discord-text hover:bg-white/[0.07] transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-discord-blurple">
                <path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V6a1 1 0 0 1 1-1z" />
              </svg>
              {replyCount} {replyCount === 1 ? 'resposta' : 'respostas'} — {thread.name}
            </button>
          )}

          {attachments.length > 0 && (
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
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 2.5L18.5 9H14V4.5z" />
                      </svg>
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-discord-text truncate">{att.file_name}</p>
                      <p className="text-xs text-discord-text-muted">{formatFileSize(att.file_size)}</p>
                    </div>
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
                        ? 'bg-discord-blurple/15 border-discord-blurple/60 text-discord-text'
                        : 'bg-white/[0.04] border-[var(--color-line)] text-discord-text-muted hover:border-[var(--color-line-strong)] hover:bg-white/[0.07] hover:text-discord-text'
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
            { label: 'Copiar texto', onClick: () => navigator.clipboard.writeText(message.content) },
            {
              label: 'Copiar link da mensagem',
              onClick: () => navigator.clipboard.writeText(`mamacos://message/${message.channel_id}/${message.id}`),
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
            ...(isOwn ? [{ label: 'Editar', onClick: startEditing }] : []),
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
            { label: 'Copiar nome de usuário', onClick: () => navigator.clipboard.writeText(author.username) },
          ]}
        />
      )}
    </div>
  )
}

export const MessageItem = memo(MessageItemImpl)
