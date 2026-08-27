import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Profile, ServerEmoji, Role } from '../../types/database'
import { getDraft, setDraft } from '../../lib/messageDrafts'
import { GifPicker } from './GifPicker'

const MAX_LENGTH = 4000

export function MessageComposer({
  channelName,
  members,
  emojis,
  roles,
  draftKey,
  placeholder,
  replyingTo,
  replyingToAuthor,
  onCancelReply,
  onSend,
  onTyping,
}: {
  channelName: string
  members: Profile[]
  emojis?: ServerEmoji[]
  roles?: Role[]
  draftKey?: string
  placeholder?: string
  replyingTo: { id: string } | null
  replyingToAuthor: Profile | undefined
  onCancelReply: () => void
  onSend: (content: string, files: File[]) => Promise<{ error: string | null } | void>
  onTyping?: () => void
}) {
  const [value, setValue] = useState(() => (draftKey ? getDraft(draftKey) : ''))
  const [files, setFiles] = useState<File[]>([])

  // Troca de canal/thread — carrega o rascunho salvo daquele lugar
  // (ou texto vazio, se nunca digitou nada lá)
  useEffect(() => {
    if (draftKey) setValue(getDraft(draftKey))
  }, [draftKey])

  // Salva o rascunho a cada mudança, pro texto não se perder se a
  // pessoa trocar de canal no meio de uma mensagem
  useEffect(() => {
    if (!draftKey) return
    setDraft(draftKey, value)
  }, [draftKey, value])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const mentionMatches =
    mentionQuery !== null
      ? members.filter((m) => m.username.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 5)
      : []
  const specialMentionMatches =
    mentionQuery !== null
      ? (['everyone', 'here'] as const).filter((s) => s.startsWith(mentionQuery.toLowerCase()))
      : []
  const roleMatches =
    mentionQuery !== null && mentionQuery.length > 0
      ? (roles ?? []).filter((r) => r.name.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 5)
      : []
  const emojiMatches =
    emojiQuery !== null && emojiQuery.length > 0
      ? (emojis ?? []).filter((e) => e.name.startsWith(emojiQuery.toLowerCase())).slice(0, 6)
      : []

  function handleChange(text: string) {
    setValue(text)
    if (text.length > 0) onTyping?.()
    if (sendError) setSendError(null)

    const cursor = textareaRef.current?.selectionStart ?? text.length
    const uptoCursor = text.slice(0, cursor)
    const mentionMatch = uptoCursor.match(/(?:^|\s)@([a-zA-Z0-9_.]*)$/)
    setMentionQuery(mentionMatch ? mentionMatch[1] : null)

    const emojiMatch = uptoCursor.match(/(?:^|\s):([a-z0-9_]*)$/)
    setEmojiQuery(emojiMatch ? emojiMatch[1] : null)
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

  function insertEmoji(name: string) {
    const cursor = textareaRef.current?.selectionStart ?? value.length
    const uptoCursor = value.slice(0, cursor)
    const replaced = uptoCursor.replace(/:([a-z0-9_]*)$/, `:${name}: `)
    const rest = value.slice(cursor)
    setValue(replaced + rest)
    setEmojiQuery(null)
    textareaRef.current?.focus()
  }

  async function handleSend() {
    const trimmed = value.trim()
    if (trimmed.length === 0 && files.length === 0) return
    if (trimmed.length > MAX_LENGTH) return

    setSending(true)
    setSendError(null)
    const result = await onSend(trimmed, files)
    setSending(false)

    if (result && 'error' in result && result.error) {
      setSendError(result.error)
      return
    }

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

  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const dragCounterRef = useRef(0)

  // Gravação de mensagem de voz — usa a mesma via de upload de arquivo
  // que já existe (o áudio vira um File comum, mandado junto com o resto)
  const [recording, setRecording] = useState(false)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      recordedChunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' })
        const file = new File([blob], `mensagem-de-voz-${Date.now()}.webm`, { type: 'audio/webm' })
        setFiles((prev) => [...prev, file])
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setRecording(true)
      setRecordSeconds(0)
      recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000)
    } catch {
      // permissão negada ou sem microfone — sem problema, só não grava
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    setRecording(false)
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
  }

  function cancelRecording() {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = () => {
        mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop())
      }
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }
    setRecording(false)
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    dragCounterRef.current++
    setIsDraggingFile(true)
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) setIsDraggingFile(false)
  }
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDraggingFile(false)
    const dropped = Array.from(e.dataTransfer.files ?? [])
    if (dropped.length > 0) setFiles((prev) => [...prev, ...dropped])
  }

  return (
    <div
      className="px-4 pb-6 shrink-0 relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDraggingFile && (
        <div className="absolute inset-x-4 bottom-6 top-0 z-10 rounded-xl border-2 border-dashed border-discord-blurple bg-discord-blurple/10 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-discord-blurple font-medium">Solte pra anexar</p>
        </div>
      )}
      {emojiMatches.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-1 bg-discord-darker border border-black/40 rounded-lg shadow-xl overflow-hidden">
          {emojiMatches.map((e) => (
            <button
              key={e.id}
              onClick={() => insertEmoji(e.name)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 text-left"
            >
              <img src={e.image_url} alt="" className="w-5 h-5 object-contain" />
              <span className="text-sm text-white">:{e.name}:</span>
            </button>
          ))}
        </div>
      )}

      {(mentionMatches.length > 0 || specialMentionMatches.length > 0 || roleMatches.length > 0) && (
        <div className="absolute bottom-full left-4 right-4 mb-1 bg-discord-darker border border-black/40 rounded-lg shadow-xl overflow-hidden">
          {specialMentionMatches.map((s) => (
            <button
              key={s}
              onClick={() => insertMention(s)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 text-left"
            >
              <span className="text-sm text-yellow-400">@{s}</span>
              <span className="text-xs text-discord-text-muted">
                {s === 'everyone' ? 'Notifica todo mundo do servidor' : 'Notifica quem está online'}
              </span>
            </button>
          ))}
          {roleMatches.map((r) => (
            <button
              key={r.id}
              onClick={() => insertMention(r.name)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 text-left"
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
              <span className="text-sm" style={{ color: r.color }}>
                @{r.name}
              </span>
            </button>
          ))}
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

      {sendError && (
        <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded px-3 py-1.5 mb-1.5">
          {sendError}
        </p>
      )}

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2.5 bg-discord-lighter px-3 pt-3 pb-2 border-b border-black/20 rounded-t-xl">
          {files.map((file, i) => (
            <FileAttachmentPreview key={`${file.name}-${i}`} file={file} onRemove={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} />
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
          aria-label="Anexar arquivo"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M12 2a1 1 0 0 1 1 1v8h8a1 1 0 1 1 0 2h-8v8a1 1 0 1 1-2 0v-8H3a1 1 0 1 1 0-2h8V3a1 1 0 0 1 1-1z" />
          </svg>
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilesSelected} />

        {recording ? (
          <div className="flex items-center gap-2 bg-red-950/40 border border-red-900/50 rounded-full px-3 py-1.5 shrink-0">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs text-red-300 font-mono tabular-nums">
              {String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:{String(recordSeconds % 60).padStart(2, '0')}
            </span>
            <button onClick={cancelRecording} title="Cancelar gravação" aria-label="Cancelar gravação" className="text-red-400 hover:text-white">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
              </svg>
            </button>
            <button onClick={stopRecording} title="Parar e anexar" aria-label="Parar e anexar" className="text-discord-green hover:text-white">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M9 16.2l-3.5-3.5-1.4 1.4L9 19 20 8l-1.4-1.4z" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            onClick={startRecording}
            className="text-discord-text-muted hover:text-white hover:bg-white/10 rounded-full p-1.5 shrink-0 transition-colors"
            title="Gravar mensagem de voz"
            aria-label="Gravar mensagem de voz"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zM19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11z" />
            </svg>
          </button>
        )}

        <div className="relative shrink-0">
          <button
            onClick={() => setShowGifPicker((v) => !v)}
            className="text-discord-text-muted hover:text-white hover:bg-white/10 rounded-full p-1.5 transition-colors"
            title="Enviar GIF"
            aria-label="Enviar GIF"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm2.5 4.5A2.5 2.5 0 0 0 4 11v2a2.5 2.5 0 0 0 4.5 1.5V13H7v-1h3v1.5A3.5 3.5 0 0 1 3 13v-2a3.5 3.5 0 0 1 6-2.5l-.7.7a2.5 2.5 0 0 0-1.8-.7zM11 8h1v8h-1V8zm3 0h4v1h-3v2.5h2.5v1H15V16h-1V8z" />
            </svg>
          </button>
          {showGifPicker && (
            <GifPicker
              onSelect={async (gifUrl) => {
                setShowGifPicker(false)
                await onSend(gifUrl, [])
              }}
              onClose={() => setShowGifPicker(false)}
            />
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? `Conversar em #${channelName}`}
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
          aria-label="Enviar"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M3.4 20.6l17.5-8.2a1 1 0 0 0 0-1.8L3.4 2.4a1 1 0 0 0-1.4 1.1L4.5 12l-2.5 8.5a1 1 0 0 0 1.4 1.1z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileAttachmentPreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const isImage = file.type.startsWith('image/')
  const isVideo = file.type.startsWith('video/')
  const isAudio = file.type.startsWith('audio/')

  useEffect(() => {
    if (!isImage && !isVideo) return
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file, isImage, isVideo])

  if (isImage && previewUrl) {
    return (
      <div className="relative group/file w-20 h-20 shrink-0">
        <img src={previewUrl} alt={file.name} className="w-full h-full object-cover rounded-lg" />
        <button
          onClick={onRemove}
          title="Remover"
          aria-label="Remover anexo"
          className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-discord-darker border border-black/40 text-white opacity-0 group-hover/file:opacity-100 transition-opacity hover:bg-red-600"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
            <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
          </svg>
        </button>
      </div>
    )
  }

  if (isVideo && previewUrl) {
    return (
      <div className="relative group/file w-20 h-20 shrink-0">
        <video src={previewUrl} muted className="w-full h-full object-cover rounded-lg bg-black" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg pointer-events-none">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-white">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        <button
          onClick={onRemove}
          title="Remover"
          aria-label="Remover anexo"
          className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-discord-darker border border-black/40 text-white opacity-0 group-hover/file:opacity-100 transition-opacity hover:bg-red-600"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
            <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
          </svg>
        </button>
      </div>
    )
  }

  // Áudio ou qualquer outro tipo de arquivo — cartão com ícone + nome + tamanho
  return (
    <div className="relative group/file flex items-center gap-2 bg-discord-darker rounded-lg pl-2.5 pr-7 py-2 max-w-[220px]">
      <span className="shrink-0 text-discord-text-muted">
        {isAudio ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M12 3a1 1 0 0 1 1 1v10.2a3.5 3.5 0 1 1-2-3.16V4a1 1 0 0 1 1-1z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6zm7 1.5L18.5 9H13V3.5z" />
          </svg>
        )}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-discord-text truncate">{file.name}</p>
        <p className="text-[10px] text-discord-text-muted">{formatFileSize(file.size)}</p>
      </div>
      <button
        onClick={onRemove}
        title="Remover"
        aria-label="Remover anexo"
        className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full text-discord-text-muted opacity-0 group-hover/file:opacity-100 transition-opacity hover:bg-red-600 hover:text-white"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
          <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
        </svg>
      </button>
    </div>
  )
}
