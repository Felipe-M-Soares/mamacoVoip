import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Message, Profile } from '../../types/database'

const MAX_LENGTH = 4000

export function MessageComposer({
  channelName,
  members,
  replyingTo,
  replyingToAuthor,
  onCancelReply,
  onSend,
}: {
  channelName: string
  members: Profile[]
  replyingTo: Message | null
  replyingToAuthor: Profile | undefined
  onCancelReply: () => void
  onSend: (content: string, files: File[]) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const mentionMatches =
    mentionQuery !== null
      ? members.filter((m) => m.username.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 5)
      : []

  function handleChange(text: string) {
    setValue(text)

    const cursor = textareaRef.current?.selectionStart ?? text.length
    const uptoCursor = text.slice(0, cursor)
    const match = uptoCursor.match(/(?:^|\s)@([a-zA-Z0-9_.]*)$/)
    setMentionQuery(match ? match[1] : null)
  }

  function insertMention(username: string) {
    const cursor = textareaRef.current?.selectionStart ?? value.length
    const uptoCursor = value.slice(0, cursor)
    const replaced = uptoCursor.replace(/@([a-zA-Z0-9_.]*)$/, `@${username} `)
    const rest = value.slice(cursor)
    setValue(replaced + rest)
    setMentionQuery(null)
    textareaRef.current?.focus()
  }

  async function handleSend() {
    const trimmed = value.trim()
    if (trimmed.length === 0 && files.length === 0) return
    if (trimmed.length > MAX_LENGTH) return

    setSending(true)
    await onSend(trimmed, files)
    setSending(false)
    setValue('')
    setFiles([])
    setMentionQuery(null)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Escape' && replyingTo) {
      onCancelReply()
    }
  }

  function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    setFiles((prev) => [...prev, ...selected])
    e.target.value = ''
  }

  return (
    <div className="px-4 pb-6 shrink-0 relative">
      {mentionMatches.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-1 bg-[#111214] border border-black/40 rounded-lg shadow-xl overflow-hidden">
          {mentionMatches.map((m) => (
            <button
              key={m.id}
              onClick={() => insertMention(m.username)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 text-left"
            >
              <span className="text-sm text-white">{m.display_name || m.username}</span>
              <span className="text-xs text-discord-text-muted">@{m.username}</span>
            </button>
          ))}
        </div>
      )}

      {replyingTo && (
        <div className="flex items-center justify-between bg-discord-lighter/60 rounded-t-lg px-3 py-1.5 text-xs">
          <span className="text-discord-text-muted">
            Respondendo a{' '}
            <span className="text-white font-medium">
              {replyingToAuthor?.display_name || replyingToAuthor?.username || 'alguém'}
            </span>
          </span>
          <button onClick={onCancelReply} className="text-discord-text-muted hover:text-white">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
            </svg>
          </button>
        </div>
      )}

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 bg-discord-lighter px-3 py-2 border-b border-black/20">
          {files.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 bg-discord-darker rounded px-2 py-1 text-xs text-discord-text"
            >
              <span className="truncate max-w-[140px]">{file.name}</span>
              <button
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-discord-text-muted hover:text-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className={`bg-discord-lighter px-4 py-3 flex items-end gap-3 border border-white/5 focus-within:border-discord-blurple/40 transition-colors ${
          replyingTo || files.length > 0 ? 'rounded-b-xl' : 'rounded-xl'
        }`}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-discord-text-muted hover:text-white hover:bg-white/10 rounded-full p-1.5 shrink-0 transition-colors"
          title="Anexar arquivo"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M12 2a1 1 0 0 1 1 1v8h8a1 1 0 1 1 0 2h-8v8a1 1 0 1 1-2 0v-8H3a1 1 0 1 1 0-2h8V3a1 1 0 0 1 1-1z" />
          </svg>
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilesSelected} />

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Conversar em #${channelName}`}
          rows={1}
          maxLength={MAX_LENGTH}
          className="flex-1 bg-transparent outline-none text-discord-text placeholder:text-discord-text-muted resize-none py-1 max-h-48"
          style={{ height: 'auto' }}
          onInput={(e) => {
            const el = e.currentTarget
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 192)}px`
          }}
        />

        <button
          onClick={handleSend}
          disabled={sending || (value.trim().length === 0 && files.length === 0)}
          className={`shrink-0 rounded-full p-1.5 transition-colors disabled:opacity-40 ${
            value.trim().length > 0 || files.length > 0
              ? 'bg-discord-blurple text-white hover:brightness-110'
              : 'text-discord-text-muted hover:bg-white/10'
          }`}
          title="Enviar"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M3.4 20.6l17.5-8.2a1 1 0 0 0 0-1.8L3.4 2.4a1 1 0 0 0-1.4 1.1L4.5 12l-2.5 8.5a1 1 0 0 0 1.4 1.1z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
