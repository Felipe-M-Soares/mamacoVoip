import { useState } from 'react'
import { Avatar } from '../ui/Avatar'
import type { Message, MessageAttachment, MessageReaction, Profile } from '../../types/database'

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

function renderContent(content: string, members: Profile[]) {
  const usernames = new Set(members.map((m) => m.username.toLowerCase()))
  const parts = content.split(/(@[a-zA-Z0-9_.]+)/g)
  return parts.map((part, i) => {
    if (part.startsWith('@') && usernames.has(part.slice(1).toLowerCase())) {
      return (
        <span key={i} className="bg-discord-blurple/30 text-discord-blurple rounded px-1 font-medium">
          {part}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export function MessageItem({
  message,
  author,
  showHeader,
  isOwn,
  canModerate,
  replyToMessage,
  replyToAuthor,
  attachments,
  reactions,
  currentUserId,
  members,
  onEdit,
  onDelete,
  onReply,
  onToggleReaction,
  onViewProfile,
}: {
  message: Message
  author: Profile | undefined
  showHeader: boolean
  isOwn: boolean
  canModerate: boolean
  replyToMessage: Message | null
  replyToAuthor: Profile | undefined
  attachments: MessageAttachment[]
  reactions: MessageReaction[]
  currentUserId: string | undefined
  members: Profile[]
  onEdit: (content: string) => Promise<{ error: string | null }>
  onDelete: () => void
  onReply: () => void
  onToggleReaction: (emoji: string) => void
  onViewProfile: (profile: Profile) => void
  }) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(message.content)
  const [showReactionPicker, setShowReactionPicker] = useState(false)

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

  return (
    <div
      className={`group relative px-4 py-0.5 hover:bg-black/10 ${showHeader ? 'mt-3 pt-1.5' : ''}`}
      onMouseLeave={() => setShowReactionPicker(false)}
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
        <div className="absolute -top-11 right-4 bg-[#111214] border border-black/40 rounded-lg shadow-xl px-2 py-1.5 flex gap-1 z-20">
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
        </div>
      )}

      {/* preview da mensagem respondida */}
      {message.reply_to_id && (
        <div className="flex items-center gap-1.5 text-xs text-discord-text-muted ml-12 mb-0.5">
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
        </div>
      )}

      <div className="flex gap-4">
        {showHeader ? (
          <div className="pt-0.5">
            <button onClick={() => author && onViewProfile(author)} className="block">
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
                className="font-medium text-white text-sm hover:underline"
              >
                {author?.display_name || author?.username || 'Usuário'}
              </button>
              <span
                className="text-xs text-discord-text-muted"
                title={formatFullDate(message.created_at)}
              >
                {formatTime(message.created_at)}
              </span>
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
              {renderContent(message.content, members)}
              {message.edited_at && (
                <span className="text-[10px] text-discord-text-muted ml-1">(editado)</span>
              )}
            </p>
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
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                      reactedByMe
                        ? 'bg-discord-blurple/20 border-discord-blurple text-discord-blurple'
                        : 'bg-discord-darker border-transparent text-discord-text-muted hover:border-discord-text-muted'
                    }`}
                  >
                    <span>{emoji}</span>
                    <span>{group.length}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
