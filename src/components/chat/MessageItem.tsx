import { useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { ContextMenu, useContextMenuState } from '../ui/ContextMenu'
import { parseMessageContent } from '../../lib/messageFormatting'
import { LinkPreviewCard, extractFirstUrl } from './LinkPreviewCard'
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

function renderContent(content: string, members: Profile[], emojis: ServerEmoji[], roles: Role[]) {
  return parseMessageContent(content, members, emojis, roles)
}

export function MessageItem({
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
  onEdit: (content: string) => Promise<{ error: string | null }>
  onDelete: () => void
  onReply: () => void
  onToggleReaction: (emoji: string) => void
  onViewProfile: (profile: Profile) => void
  onPin?: () => void
  onUnpin?: () => void
  thread?: Thread
  replyCount?: number
  onCreateThread?: () => void
  onOpenThread?: (thread: Thread) => void
  onJumpToMessage?: (messageId: string) => void
  isHighlighted?: boolean
  onForward?: () => void
  selectionMode?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  }) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(message.content)
  const [showReactionPicker, setShowReactionPicker] = useState(false)
  const { menuState, openMenu, closeMenu } = useContextMenuState()
  const { menuState: userMenuState, openMenu: openUserMenu, closeMenu: closeUserMenu } = useContextMenuState()

  async function handleSaveEdit() {
    if (editValue.trim().length === 0) return
    const { error } = await onEdit(editValue.trim())
    if (!error) setEditing(false)
  }

  // agrupa reações por emoji
  const reactionGroups = reactions.reduce<Record<string, MessageReaction[]>>((acc, r) => {
    acc[r.emoji] = [...(acc[r.emoji] ?? []), r]
    return acc
  }, {})

  if (message.system_event === 'member_join') {
    const authorReactions = reactions.filter((r) => r.user_id === currentUserId && r.emoji === '👋')
    return (
      <div className="px-4 py-1.5 flex items-center gap-2 group">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-discord-green shrink-0">
          <path d="M12 4l-1.4 1.4L16.2 11H4v2h12.2l-5.6 5.6L12 20l8-8-8-8z" />
        </svg>
        <p className="text-sm text-discord-text-muted min-w-0 truncate">
          <button onClick={() => author && onViewProfile(author)} className="font-medium text-discord-text hover:underline">
            {author?.display_name || author?.username || 'Alguém'}
          </button>{' '}
          entrou no servidor.
        </p>
        <span className="text-[10px] text-discord-text-muted shrink-0">{formatTime(message.created_at)}</span>
        {currentUserId && currentUserId !== message.author_id && (
          <button
            onClick={() => onToggleReaction('👋')}
            className={`ml-auto text-xs px-2 py-1 rounded-full border shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ${
              authorReactions.length > 0
                ? 'bg-discord-blurple/20 border-discord-blurple text-white opacity-100'
                : 'border-white/10 text-discord-text-muted hover:text-white hover:border-white/30'
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
      className={`group relative px-4 py-0.5 hover:bg-black/10 animate-fade-slide-in ${showHeader ? 'mt-3 pt-1.5' : ''}`}
      onMouseLeave={() => setShowReactionPicker(false)}
      onContextMenu={openMenu}
    >
      {/* barra de ferramentas no hover */}
      <div className="hidden group-hover:flex absolute -top-3 right-4 bg-discord-channels border border-black/30 rounded shadow-md overflow-hidden z-10">
        <button
          title="Reagir"
          onClick={() => setShowReactionPicker((v) => !v)}
          className="p-1.5 text-discord-text-muted hover:text-white hover:bg-white/5"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM8.5 10a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm7 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM12 17.5c-2.3 0-4.3-1.3-5.3-3.2a1 1 0 1 1 1.8-.9c.7 1.3 2 2.1 3.5 2.1s2.8-.8 3.5-2.1a1 1 0 1 1 1.8.9c-1 1.9-3 3.2-5.3 3.2z" />
          </svg>
        </button>
        <button
          title="Responder"
          onClick={onReply}
          className="p-1.5 text-discord-text-muted hover:text-white hover:bg-white/5"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M10 8V5l-7 7 7 7v-3.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
          </svg>
        </button>
        {isOwn && (
          <button
            title="Editar"
            onClick={() => setEditing(true)}
            className="p-1.5 text-discord-text-muted hover:text-white hover:bg-white/5"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M19.4 13a7.4 7.4 0 0 0 .1-1 7.4 7.4 0 0 0-.1-1l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.6 7.6 0 0 0-1.7-1l-.4-2.5a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1a.5.5 0 0 0-.6.2L2.6 8.8a.5.5 0 0 0 .1.6l2 1.6a7.4 7.4 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.3a.5.5 0 0 0 .6.2l2.4-1c.5.4 1.1.8 1.7 1l.4 2.5a.5.5 0 0 0 .5.4h3.8a.5.5 0 0 0 .5-.4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1a.5.5 0 0 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6l-2-1.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" />
            </svg>
          </button>
        )}
        {(isOwn || canModerate) && (
          <button
            title="Excluir"
            onClick={onDelete}
            className="p-1.5 text-discord-text-muted hover:text-red-400 hover:bg-white/5"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M9 3a1 1 0 0 0-1 1v1H4a1 1 0 1 0 0 2h1v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7h1a1 1 0 1 0 0-2h-4V4a1 1 0 0 0-1-1H9zm1 6a1 1 0 1 1 2 0v8a1 1 0 1 1-2 0V9zm5-1a1 1 0 0 0-1 1v8a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1z" />
            </svg>
          </button>
        )}
      </div>

      {showReactionPicker && (
        <div className="absolute -top-11 right-4 bg-[#111214] border border-black/40 rounded-lg shadow-xl px-2 py-1.5 flex gap-1 z-20 max-w-xs flex-wrap">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                onToggleReaction(emoji)
                setShowReactionPicker(false)
              }}
              className="text-lg hover:scale-125 transition-transform"
            >
              {emoji}
            </button>
          ))}
          {emojis.length > 0 && <div className="w-px bg-white/10 mx-0.5" />}
          {emojis.slice(0, 12).map((e) => (
            <button
              key={e.id}
              onClick={() => {
                onToggleReaction(`:${e.name}:`)
                setShowReactionPicker(false)
              }}
              title={`:${e.name}:`}
              className="hover:scale-125 transition-transform"
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
          className="flex items-center gap-1.5 text-xs text-discord-text-muted ml-12 mb-0.5 hover:text-discord-text text-left"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 rotate-180 shrink-0">
            <path d="M10 8V5l-7 7 7 7v-3.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
          </svg>
          {replyToMessage ? (
            <>
              <span className="font-medium text-discord-text">
                {replyToAuthor?.display_name || replyToAuthor?.username || 'alguém'}
              </span>
              <span className="truncate max-w-xs">{replyToMessage.content}</span>
            </>
          ) : (
            <span className="italic">Mensagem original não encontrada</span>
          )}
        </button>
      )}

      <div
        id={`message-${message.id}`}
        onClick={selectionMode ? onToggleSelect : undefined}
        className={`flex gap-4 ${selectionMode ? 'cursor-pointer' : ''} ${
          isHighlighted ? 'bg-yellow-500/10 -mx-2 px-2 rounded transition-colors' : selected ? 'bg-discord-blurple/10 -mx-2 px-2 rounded' : ''
        }`}
      >
        {selectionMode && (
          <div className="pt-1 shrink-0">
            <input type="checkbox" checked={Boolean(selected)} readOnly className="w-4 h-4 accent-discord-blurple" />
          </div>
        )}
        {showHeader ? (
          <div className="pt-0.5">
            <button
              onClick={() => author && onViewProfile(author)}
              onContextMenu={openUserMenu}
              className="block"
            >
              <Avatar name={author?.username ?? '?'} avatarUrl={author?.avatar_url} size={40} />
            </button>
          </div>
        ) : (
          <div className="w-10 shrink-0 flex items-start justify-center">
            <span className="hidden group-hover:inline text-[10px] text-discord-text-muted pt-1">
              {formatTime(message.created_at)}
            </span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          {showHeader && (
            <div className="flex items-baseline gap-2">
              <button
                onClick={() => author && onViewProfile(author)}
                onContextMenu={openUserMenu}
                style={authorRoleColor ? { color: authorRoleColor } : undefined}
                className={`font-medium text-sm hover:underline ${authorRoleColor ? '' : 'text-white'}`}
              >
                {author?.display_name || author?.username || 'Usuário'}
              </button>
              <span
                className="text-xs text-discord-text-muted"
                title={formatFullDate(message.created_at)}
              >
                {formatTime(message.created_at)}
              </span>
              {message.pinned_at && (
                <span className="flex items-center gap-0.5 text-[10px] text-discord-blurple">
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
                  if (e.key === 'Escape') setEditing(false)
                }}
                autoFocus
                className="w-full bg-discord-lighter text-discord-text text-sm rounded px-3 py-2 outline-none resize-none"
                rows={2}
              />
              <p className="text-xs text-discord-text-muted mt-1">
                escape para <button onClick={() => setEditing(false)} className="text-discord-blurple hover:underline">cancelar</button> • enter para{' '}
                <button onClick={handleSaveEdit} className="text-discord-blurple hover:underline">salvar</button>
              </p>
            </div>
          ) : (
            <p className="text-sm text-discord-text whitespace-pre-wrap break-words leading-relaxed">
              {renderContent(message.content, members, emojis, roles)}
              {message.edited_at && (
                <span className="text-[10px] text-discord-text-muted ml-1">(editado)</span>
              )}
            </p>
          )}
          {(() => {
            const url = extractFirstUrl(message.content)
            return url ? <LinkPreviewCard url={url} /> : null
          })()}
          {thread && (
            <button
              onClick={() => onOpenThread?.(thread)}
              className="mt-1.5 flex items-center gap-1.5 text-xs text-discord-blurple hover:underline"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V6a1 1 0 0 1 1-1z" />
              </svg>
              {replyCount} {replyCount === 1 ? 'resposta' : 'respostas'} — {thread.name}
            </button>
          )}

          {attachments.length > 0 && (
            <div className="mt-2 flex flex-col gap-2 max-w-md">
              {attachments.map((att) =>
                att.mime_type.startsWith('image/') ? (
                  <a key={att.id} href={att.file_url} target="_blank" rel="noreferrer">
                    <img
                      src={att.file_url}
                      alt={att.file_name}
                      className="rounded-lg max-h-80 object-cover border border-black/20"
                    />
                  </a>
                ) : att.mime_type.startsWith('audio/') ? (
                  <div key={att.id} className="flex items-center gap-2 bg-discord-darker rounded-lg px-3 py-2.5">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-discord-blurple shrink-0">
                      <path d="M12 3a1 1 0 0 1 1 1v9.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4l3.3 3.3V4a1 1 0 0 1 1-1z" />
                    </svg>
                    <audio controls src={att.file_url} className="h-9 max-w-xs" />
                  </div>
                ) : (
                  <a
                    key={att.id}
                    href={att.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 bg-discord-darker rounded-lg px-3 py-2.5 hover:bg-discord-lighter transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-discord-text-muted shrink-0">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 2.5L18.5 9H14V4.5z" />
                    </svg>
                    <div className="min-w-0">
                      <p className="text-sm text-discord-blurple truncate">{att.file_name}</p>
                      <p className="text-xs text-discord-text-muted">{formatFileSize(att.file_size)}</p>
                    </div>
                  </a>
                )
              )}
            </div>
          )}

          {Object.keys(reactionGroups).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {Object.entries(reactionGroups).map(([emoji, group]) => {
                const reactedByMe = group.some((r) => r.user_id === currentUserId)
                return (
                  <button
                    key={emoji}
                    onClick={() => onToggleReaction(emoji)}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-all hover:scale-110 active:scale-95 ${
                      reactedByMe
                        ? 'bg-discord-blurple/20 border-discord-blurple text-discord-blurple shadow-[0_0_6px_0] shadow-discord-blurple/40'
                        : 'bg-discord-darker border-transparent text-discord-text-muted hover:border-discord-text-muted'
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
            { label: 'Responder', onClick: onReply },
            { label: 'Copiar texto', onClick: () => navigator.clipboard.writeText(message.content) },
            {
              label: 'Copiar link da mensagem',
              onClick: () => navigator.clipboard.writeText(`mamacos://message/${message.channel_id}/${message.id}`),
            },
            { label: 'Adicionar reação', onClick: () => setShowReactionPicker(true) },
            ...(onForward ? [{ label: 'Encaminhar', onClick: onForward }] : []),
            ...(!thread && onCreateThread ? [{ label: 'Criar thread', onClick: onCreateThread }] : []),
            ...(canModerate && (onPin || onUnpin)
              ? [
                  message.pinned_at
                    ? { label: 'Desafixar mensagem', onClick: () => onUnpin?.() }
                    : { label: 'Fixar mensagem', onClick: () => onPin?.() },
                ]
              : []),
            ...(isOwn ? [{ label: 'Editar', onClick: () => setEditing(true) }] : []),
            ...(isOwn || canModerate
              ? [
                  {
                    label: 'Excluir',
                    danger: true,
                    divider: true,
                    onClick: () => {
                      if (confirm('Excluir esta mensagem?')) onDelete()
                    },
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
