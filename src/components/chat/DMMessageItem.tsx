import { useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { InviteMessageCard } from './InviteMessageCard'
import { parseInviteMessage } from '../../lib/inviteMessage'
import { parseMessageContent } from '../../lib/messageFormatting'
import { LinkPreviewCard, extractFirstUrl } from './LinkPreviewCard'
import type { DMMessage, Profile } from '../../types/database'

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function DMMessageItem({
  message,
  author,
  showHeader,
  isOwn,
  replyToMessage,
  replyToAuthor,
  onEdit,
  onDelete,
  onReply,
}: {
  message: DMMessage
  author: Profile | undefined
  showHeader: boolean
  isOwn: boolean
  replyToMessage: DMMessage | null
  replyToAuthor: Profile | undefined
  onEdit: (content: string) => Promise<{ error: string | null }>
  onDelete: () => void
  onReply: () => void
}) {
  const inviteData = parseInviteMessage(message.content)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(message.content)

  async function handleSaveEdit() {
    if (editValue.trim().length === 0) return
    const { error } = await onEdit(editValue.trim())
    if (!error) setEditing(false)
  }

  return (
    <div className={`group relative px-4 py-0.5 hover:bg-black/10 ${showHeader ? 'mt-3 pt-1.5' : ''}`}>
      <div className="hidden group-hover:flex absolute -top-3 right-4 bg-discord-channels border border-black/30 rounded shadow-md overflow-hidden z-10">
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
          <>
            <button
              title="Editar"
              onClick={() => setEditing(true)}
              className="p-1.5 text-discord-text-muted hover:text-white hover:bg-white/5"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M19.4 13a7.4 7.4 0 0 0 .1-1 7.4 7.4 0 0 0-.1-1l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.6 7.6 0 0 0-1.7-1l-.4-2.5a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1a.5.5 0 0 0-.6.2L2.6 8.8a.5.5 0 0 0 .1.6l2 1.6a7.4 7.4 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.3a.5.5 0 0 0 .6.2l2.4-1c.5.4 1.1.8 1.7 1l.4 2.5a.5.5 0 0 0 .5.4h3.8a.5.5 0 0 0 .5-.4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1a.5.5 0 0 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6l-2-1.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" />
              </svg>
            </button>
            <button
              title="Excluir"
              onClick={onDelete}
              className="p-1.5 text-discord-text-muted hover:text-red-400 hover:bg-white/5"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M9 3a1 1 0 0 0-1 1v1H4a1 1 0 1 0 0 2h1v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7h1a1 1 0 1 0 0-2h-4V4a1 1 0 0 0-1-1H9zm1 6a1 1 0 1 1 2 0v8a1 1 0 1 1-2 0V9zm5-1a1 1 0 0 0-1 1v8a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1z" />
              </svg>
            </button>
          </>
        )}
      </div>

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
            <Avatar name={author?.username ?? '?'} avatarUrl={author?.avatar_url} size={40} />
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
              <span className="font-medium text-white text-sm">
                {author?.display_name || author?.username || 'Usuário'}
              </span>
              <span className="text-xs text-discord-text-muted">{formatTime(message.created_at)}</span>
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
            </div>
          ) : inviteData ? (
            <div className="mt-1">
              <InviteMessageCard invite={inviteData} />
            </div>
          ) : (
            <p className="text-sm text-discord-text whitespace-pre-wrap break-words leading-relaxed">
              {parseMessageContent(message.content, [])}
              {message.edited_at && <span className="text-[10px] text-discord-text-muted ml-1">(editado)</span>}
            </p>
          )}
          {(() => {
            const url = extractFirstUrl(message.content)
            return url ? <LinkPreviewCard url={url} /> : null
          })()}
        </div>
      </div>
    </div>
  )
}
