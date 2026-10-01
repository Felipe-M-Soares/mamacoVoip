import { Suspense, useEffect, useRef, useState } from 'react'
import { lazyComponent } from '../modals/lazyModal'
import type { KeyboardEvent } from 'react'
import type { Profile, ServerEmoji, Role } from '../../types/database'
import { getDraft, setDraft } from '../../lib/messageDrafts'
import { pushRecentSticker, stickerMessage } from '../../lib/stickers'
import { AudioFileIcon, StickerIcon, CheckIcon, CloseIcon, FileIcon, MicIcon, PlayIcon, PlusIcon, ReplyIcon, SendIcon, UploadIcon, WarningIcon } from '../ui/icons'

// Só carrega o seletor de GIF quando alguém abre — fora do pacote inicial.
const GifPicker = lazyComponent(() => import('./GifPicker').then((m) => m.GifPicker))
const StickerPicker = lazyComponent(() => import('./StickerPicker').then((m) => m.StickerPicker))

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
  adultGifs = false,
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
  /** GIFs com classificação R (só canal +18 confirmado — ver ChatArea). DMs nunca passam isso. */
  adultGifs?: boolean
}) {
  const [value, setValueState] = useState(() => (draftKey ? getDraft(draftKey) : ''))
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const draftKeyRef = useRef(draftKey)
  draftKeyRef.current = draftKey

  // Salva o rascunho junto com cada mudança do texto (e não num efeito
  // separado): antes, no render da troca de canal o efeito de "salvar"
  // rodava com a chave NOVA e o texto do canal ANTIGO, gravando por um
  // instante o rascunho de um canal no outro.
  function setValue(next: string) {
    setValueState(next)
    if (draftKeyRef.current) setDraft(draftKeyRef.current, next)
  }

  // Troca de canal/thread/conversa — carrega o rascunho salvo daquele
  // lugar e descarta o que era do lugar anterior. Antes os ANEXOS
  // selecionados, o erro e as sugestões de @menção continuavam na tela
  // (dava pra mandar sem querer no canal B um arquivo escolhido no A).
  const [stateDraftKey, setStateDraftKey] = useState(draftKey)
  if (stateDraftKey !== draftKey) {
    setStateDraftKey(draftKey)
    setValueState(draftKey ? getDraft(draftKey) : '')
    setFiles([])
    setSendError(null)
    setMentionQuery(null)
    setEmojiQuery(null)
  }

  // Ajusta a altura da caixa ao texto também quando ele muda "por fora"
  // (rascunho carregado, envio que limpa a caixa) — antes a caixa ficava
  // alta depois de mandar uma mensagem de várias linhas.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`
  }, [value])

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
    // Enter apertado duas vezes rápido mandava a mensagem em dobro (o
    // botão ficava desabilitado, mas o atalho do teclado não).
    if (sendingRef.current) return
    const trimmed = value.trim()
    if (trimmed.length === 0 && files.length === 0) return
    if (trimmed.length > MAX_LENGTH) {
      setSendError(`A mensagem passou do limite de ${MAX_LENGTH} caracteres.`)
      return
    }

    const sentFromKey = draftKey
    sendingRef.current = true
    setSending(true)
    setSendError(null)
    let result: { error: string | null } | void
    try {
      result = await onSend(trimmed, files)
    } catch (err) {
      result = { error: err instanceof Error ? err.message : 'Erro ao enviar mensagem' }
    } finally {
      sendingRef.current = false
      setSending(false)
    }

    // Trocou de canal enquanto enviava: não mexe no rascunho do canal novo.
    if (sentFromKey !== draftKeyRef.current) {
      if (sentFromKey && !(result && result.error)) setDraft(sentFromKey, '')
      return
    }

    if (result && 'error' in result && result.error) {
      setSendError(result.error)
      return
    }

    setValue('')
    setFiles([])
    setMentionQuery(null)
    setEmojiQuery(null)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Com a lista de sugestões aberta, Enter/Tab escolhem a primeira
    // sugestão (antes o Enter mandava a mensagem com o "@fu" pela metade)
    // e Esc só fecha a lista.
    const firstMention = specialMentionMatches[0] ?? roleMatches[0]?.name ?? mentionMatches[0]?.username
    const firstEmoji = emojiMatches[0]?.name
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      if (firstMention) {
        e.preventDefault()
        insertMention(firstMention)
        return
      }
      if (firstEmoji) {
        e.preventDefault()
        insertEmoji(firstEmoji)
        return
      }
    }
    if (e.key === 'Escape' && (mentionQuery !== null || emojiQuery !== null) && (firstMention || firstEmoji)) {
      e.preventDefault()
      e.stopPropagation()
      setMentionQuery(null)
      setEmojiQuery(null)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void handleSend()
    }
    if (e.key === 'Escape' && replyingTo) {
      e.stopPropagation()
      onCancelReply()
    }
  }

  // Ctrl+V com imagem/arquivo na área de transferência (print da tela,
  // imagem copiada, arquivo copiado no Explorer) vira anexo, igual
  // apps de chat. Texto continua colando normal.
  function filesFromClipboard(data: DataTransfer | null): File[] {
    if (!data) return []
    const out: File[] = []
    for (const item of Array.from(data.items ?? [])) {
      if (item.kind !== 'file') continue
      const f = item.getAsFile()
      if (!f) continue
      if (!f.name || f.name === 'image.png' || f.name === 'blob') {
        const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
        out.push(new File([f], `print-${stamp}.${ext}`, { type: f.type || 'image/png' }))
      } else out.push(f)
    }
    return out
  }
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = filesFromClipboard(e.clipboardData)
    if (pasted.length === 0) return
    e.preventDefault()
    setFiles((prev) => [...prev, ...pasted])
  }
  // Ctrl+V com o foco fora de qualquer campo (ex.: depois de clicar numa
  // mensagem) também anexa — e já coloca o cursor na caixa de texto.
  useEffect(() => {
    function onDocPaste(e: ClipboardEvent) {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      const pasted = filesFromClipboard(e.clipboardData)
      if (pasted.length === 0) return
      e.preventDefault()
      setFiles((prev) => [...prev, ...pasted])
      textareaRef.current?.focus()
    }
    document.addEventListener('paste', onDocPaste)
    return () => document.removeEventListener('paste', onDocPaste)
  }, [])

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
  const [showStickerPicker, setShowStickerPicker] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sair do canal/fechar a tela no meio de uma gravação deixava o
  // microfone ligado (luz de gravação acesa) e o timer rodando pra sempre.
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current
      if (recorder) {
        recorder.ondataavailable = null
        recorder.onstop = null
        if (recorder.state !== 'inactive') recorder.stop()
        recorder.stream.getTracks().forEach((t) => t.stop())
        mediaRecorderRef.current = null
      }
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    }
  }, [])

  async function startRecording() {
    if (mediaRecorderRef.current) return
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
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000)
    } catch {
      // Antes falhava em silêncio — o botão simplesmente "não fazia nada".
      setSendError('Não foi possível acessar o microfone para gravar a mensagem de voz.')
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    setRecording(false)
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
  }

  function cancelRecording() {
    // Guarda o recorder numa variável local: antes o onstop lia
    // `mediaRecorderRef.current`, que já tinha virado null na linha
    // seguinte — as trilhas nunca eram paradas e o microfone ficava ligado.
    const recorder = mediaRecorderRef.current
    if (recorder) {
      recorder.onstop = () => {
        recorder.stream.getTracks().forEach((t) => t.stop())
      }
      recorder.stop()
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

  const hasContent = value.trim().length > 0 || files.length > 0
  const suggestionItem = 'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-left transition-colors'

  return (
    <div
      data-tour="composer"
      className="px-4 pb-5 shrink-0 relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDraggingFile && (
        <div className="absolute inset-x-4 bottom-5 top-0 z-10 rounded-2xl border-2 border-dashed border-mv-accent bg-mv-accent/10 backdrop-blur-sm flex flex-col items-center justify-center gap-1 pointer-events-none animate-fade-in">
          <UploadIcon className="w-6 h-6 text-mv-accent" aria-hidden />
          <p className="text-sm text-mv-accent font-semibold">Solte pra anexar</p>
        </div>
      )}
      {emojiMatches.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-2 surface-elevated rounded-xl p-1.5 overflow-hidden z-20 animate-pop-in">
          <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted">Emojis</p>
          {emojiMatches.map((e) => (
            <button
              key={e.id}
              onClick={() => insertEmoji(e.name)}
              className={suggestionItem}
            >
              <img src={e.image_url} alt="" className="w-5 h-5 object-contain" />
              <span className="text-sm text-white">:{e.name}:</span>
            </button>
          ))}
        </div>
      )}

      {(mentionMatches.length > 0 || specialMentionMatches.length > 0 || roleMatches.length > 0) && (
        <div className="absolute bottom-full left-4 right-4 mb-2 surface-elevated rounded-xl p-1.5 overflow-hidden z-20 animate-pop-in">
          <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted">Mencionar</p>
          {specialMentionMatches.map((s) => (
            <button
              key={s}
              onClick={() => insertMention(s)}
              className={suggestionItem}
            >
              <span className="text-sm font-medium text-amber-300">@{s}</span>
              <span className="text-xs text-mv-muted">
                {s === 'everyone' ? 'Notifica todo mundo do servidor' : 'Notifica quem está online'}
              </span>
            </button>
          ))}
          {roleMatches.map((r) => (
            <button
              key={r.id}
              onClick={() => insertMention(r.name)}
              className={suggestionItem}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
              <span className="text-sm font-medium" style={{ color: r.color }}>
                @{r.name}
              </span>
            </button>
          ))}
          {mentionMatches.map((m) => (
            <button
              key={m.id}
              onClick={() => insertMention(m.username)}
              className={suggestionItem}
            >
              <span className="text-sm font-medium text-white">{m.display_name || m.username}</span>
              <span className="text-xs text-mv-muted">@{m.username}</span>
            </button>
          ))}
        </div>
      )}

      {sendError && (
        <div role="alert" className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3 py-2 mb-2 animate-fade-in">
          <WarningIcon className="w-4 h-4 shrink-0 text-rose-400" aria-hidden />
          <span className="pt-px">{sendError}</span>
        </div>
      )}

      <div className="rounded-2xl bg-mv-raised/60 border border-[var(--color-line)] transition-[border-color,box-shadow] focus-within:border-mv-accent/50 focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-mv-accent)_14%,transparent)]">
      {replyingTo && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] pl-4 pr-2 py-1.5 text-xs">
          <span className="flex items-center gap-1.5 text-mv-muted min-w-0">
            <ReplyIcon className="w-3.5 h-3.5 shrink-0 text-mv-accent" aria-hidden />
            <span className="truncate">
              Respondendo a{' '}
              <span className="text-white font-semibold">
                {replyingToAuthor?.display_name || replyingToAuthor?.username || 'alguém'}
              </span>
            </span>
          </span>
          <button onClick={onCancelReply} title="Cancelar resposta" aria-label="Cancelar resposta" className="icon-btn w-7 h-7 shrink-0">
            <CloseIcon className="w-4 h-4" aria-hidden />
          </button>
        </div>
      )}

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2.5 px-3 pt-3 pb-2.5 border-b border-[var(--color-line)]">
          {files.map((file, i) => (
            <FileAttachmentPreview key={`${file.name}-${i}`} file={file} onRemove={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} />
          ))}
        </div>
      )}

      <div className="pl-2 pr-2 py-2 flex items-end gap-1">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="icon-btn w-9 h-9 shrink-0"
          title="Anexar arquivo"
          aria-label="Anexar arquivo"
        >
          <PlusIcon className="w-5 h-5" aria-hidden />
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilesSelected} />

        {recording ? (
          <div className="flex items-center gap-2 h-9 bg-rose-500/10 border border-rose-500/25 rounded-full pl-3 pr-1 shrink-0" role="status" aria-label="Gravando mensagem de voz">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            <span className="text-xs text-rose-300 font-mono tabular-nums">
              {String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:{String(recordSeconds % 60).padStart(2, '0')}
            </span>
            <button onClick={cancelRecording} title="Cancelar gravação" aria-label="Cancelar gravação" className="w-7 h-7 rounded-full flex items-center justify-center text-rose-300 hover:bg-rose-500/15 hover:text-white transition-colors">
              <CloseIcon className="w-3.5 h-3.5" aria-hidden />
            </button>
            <button onClick={stopRecording} title="Parar e anexar" aria-label="Parar e anexar" className="w-7 h-7 rounded-full flex items-center justify-center bg-mv-green/15 text-mv-green hover:bg-mv-green hover:text-white transition-colors">
              <CheckIcon className="w-4 h-4" aria-hidden />
            </button>
          </div>
        ) : (
          <button
            onClick={startRecording}
            className="icon-btn w-9 h-9 shrink-0"
            title="Gravar mensagem de voz"
            aria-label="Gravar mensagem de voz"
          >
            <MicIcon className="w-5 h-5" aria-hidden />
          </button>
        )}

        <div className="relative shrink-0">
          <button
            onClick={() => {
              setShowStickerPicker(false)
              setShowGifPicker((v) => !v)
            }}
            className={`icon-btn w-9 h-9 ${showGifPicker ? '!text-mv-text bg-white/[0.07]' : ''}`}
            title="Enviar GIF"
            aria-label="Enviar GIF"
            aria-expanded={showGifPicker}
          >
            <span className="text-[10px] font-bold tracking-wide leading-none px-1 py-[3px] rounded-[5px] border-[1.5px] border-current">GIF</span>
          </button>
          {showGifPicker && (
            <Suspense fallback={null}>
              <GifPicker
                onSelect={async (gifUrl) => {
                  setShowGifPicker(false)
                  // Antes o erro de envio do GIF era descartado em silêncio.
                  try {
                    const result = await onSend(gifUrl, [])
                    if (result && result.error) setSendError(result.error)
                  } catch (err) {
                    setSendError(err instanceof Error ? err.message : 'Erro ao enviar GIF')
                  }
                }}
                onClose={() => setShowGifPicker(false)}
                adult={adultGifs}
              />
            </Suspense>
          )}
        </div>

        <div className="relative shrink-0">
          <button
            onClick={() => {
              setShowGifPicker(false)
              setShowStickerPicker((v) => !v)
            }}
            className={`icon-btn w-9 h-9 ${showStickerPicker ? '!text-mv-text bg-white/[0.07]' : ''}`}
            title="Enviar figurinha"
            aria-label="Enviar figurinha"
            aria-expanded={showStickerPicker}
          >
            <StickerIcon className="w-5 h-5" aria-hidden />
          </button>
          {showStickerPicker && (
            <Suspense fallback={null}>
              <StickerPicker
                onSelect={async (sticker) => {
                  setShowStickerPicker(false)
                  pushRecentSticker(sticker.id)
                  try {
                    const result = await onSend(stickerMessage(sticker.id), [])
                    if (result && result.error) setSendError(result.error)
                  } catch (err) {
                    setSendError(err instanceof Error ? err.message : 'Erro ao enviar figurinha')
                  }
                }}
                onClose={() => setShowStickerPicker(false)}
              />
            </Suspense>
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder ?? `Conversar em #${channelName}`}
          aria-label={placeholder ?? `Conversar em #${channelName}`}
          rows={1}
          maxLength={MAX_LENGTH}
          // Placeholder numa linha só, com "…" (no celular ele quebrava em 2 linhas).
          className="flex-1 min-w-0 bg-transparent outline-none !shadow-none text-[15px] leading-6 text-mv-text resize-none py-1.5 px-1.5 max-h-48 placeholder:whitespace-nowrap placeholder:overflow-hidden placeholder:text-ellipsis"
        />

        <button
          onClick={() => void handleSend()}
          disabled={sending || !hasContent}
          className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:cursor-not-allowed ${
            hasContent
              ? 'bg-brand-gradient text-white shadow-[0_6px_16px_-6px_var(--color-mv-accent)] hover:brightness-110 active:scale-95 disabled:opacity-60'
              : 'text-mv-muted/60'
          }`}
          title="Enviar"
          aria-label="Enviar"
        >
          {sending ? (
            <span className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
          ) : (
            <SendIcon className="w-[18px] h-[18px]" aria-hidden />
          )}
        </button>
      </div>
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
        <img src={previewUrl} alt={file.name} className="w-full h-full object-cover rounded-xl border border-[var(--color-line)]" />
        <button
          onClick={onRemove}
          title="Remover"
          aria-label="Remover anexo"
          className="absolute -top-1.5 -right-1.5 w-6 h-6 flex items-center justify-center rounded-full bg-mv-canvas border border-[var(--color-line-strong)] text-white opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-rose-600"
        >
          <CloseIcon className="w-3 h-3" aria-hidden />
        </button>
      </div>
    )
  }

  if (isVideo && previewUrl) {
    return (
      <div className="relative group/file w-20 h-20 shrink-0">
        <video src={previewUrl} muted className="w-full h-full object-cover rounded-xl bg-black border border-[var(--color-line)]" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl pointer-events-none">
          <PlayIcon className="w-6 h-6 text-white" fill="currentColor" aria-hidden />
        </div>
        <button
          onClick={onRemove}
          title="Remover"
          aria-label="Remover anexo"
          className="absolute -top-1.5 -right-1.5 w-6 h-6 flex items-center justify-center rounded-full bg-mv-canvas border border-[var(--color-line-strong)] text-white opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-rose-600"
        >
          <CloseIcon className="w-3 h-3" aria-hidden />
        </button>
      </div>
    )
  }

  // Áudio ou qualquer outro tipo de arquivo — cartão com ícone + nome + tamanho
  return (
    <div className="relative group/file flex items-center gap-2.5 bg-mv-canvas border border-[var(--color-line)] rounded-xl pl-2 pr-8 py-2 max-w-[240px]">
      <span className="shrink-0 w-9 h-9 rounded-lg bg-mv-accent/10 text-mv-accent flex items-center justify-center">
        {isAudio ? (
          <AudioFileIcon className="w-5 h-5" aria-hidden />
        ) : (
          <FileIcon className="w-5 h-5" aria-hidden />
        )}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-mv-text truncate">{file.name}</p>
        <p className="text-[10px] text-mv-muted">{formatFileSize(file.size)}</p>
      </div>
      <button
        onClick={onRemove}
        title="Remover"
        aria-label="Remover anexo"
        className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-full text-mv-muted opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-rose-600 hover:text-white"
      >
        <CloseIcon className="w-3 h-3" aria-hidden />
      </button>
    </div>
  )
}
