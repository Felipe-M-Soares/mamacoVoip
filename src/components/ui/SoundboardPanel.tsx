import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useModeration } from '../../hooks/useModeration'
import { useSoundboard } from '../../hooks/useSoundboard'
import { useVoice } from '../../hooks/useVoice'
import { decodeAudioFile, trimAudioBufferToWav, MAX_SOUND_SECONDS } from '../../lib/audioTrim'
import type { SoundboardSound } from '../../types/database'

// Soundboard — efeitos sonoros que qualquer um no canal de voz ouve na
// hora, igual o Discord. Cada servidor tem o próprio catálogo de sons
// (ver useSoundboard.ts + 006_soundboard.sql); tocar um som usa
// voice.playSoundboardSound (VoiceContext.tsx), que toca localmente E
// avisa todo mundo mais no canal pra tocarem a mesma URL aí também —
// nenhum áudio é misturado no microfone, cada um ouve pelo próprio
// alto-falante (e no volume PRÓPRIO que cada um escolher — ver o
// controle de "Volume dos efeitos" abaixo).
export function SoundboardPanel({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const { user } = useAuth()
  const { permissions } = useModeration(serverId)
  const voice = useVoice()
  const soundboard = useSoundboard(serverId)
  const [search, setSearch] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploadName, setUploadName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [decoding, setDecoding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Enquanto o arquivo escolhido for mais longo que o limite, guarda o
  // AudioBuffer decodificado + o início do trecho de 5s escolhido — a
  // ferramenta de recorte abaixo mexe só nisso até a pessoa confirmar,
  // sem tocar em pendingFile (que só existe pro arquivo final, já dentro
  // do limite, pronto pra nomear e enviar).
  const [trimState, setTrimState] = useState<{ buffer: AudioBuffer; duration: number; start: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rawFileRef = useRef<File | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement>(null)
  const previewStopTimeoutRef = useRef<number | undefined>(undefined)

  // Fechar o painel no meio de um recorte/prévia deixava o áudio da
  // prévia tocando, o timer pendurado e a object URL do arquivo (o
  // arquivo INTEIRO em memória) sem revogar. Guardado num ref PRÓPRIO
  // (não o ref do elemento, que o React já zera antes deste cleanup).
  const activePreviewRef = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    return () => {
      window.clearTimeout(previewStopTimeoutRef.current)
      const audio = activePreviewRef.current
      if (audio) {
        audio.pause()
        if (audio.src) URL.revokeObjectURL(audio.src)
        audio.removeAttribute('src')
      }
    }
  }, [])

  const query = search.trim().toLowerCase()
  const filtered = query ? soundboard.sounds.filter((s) => s.name.toLowerCase().includes(query)) : soundboard.sounds
  // "Usados com frequência" — igual o Discord separa os sons mais
  // tocados numa seção própria em cima. Só mostra enquanto não há busca
  // ativa, pra não duplicar resultado com "Todos os sons" logo abaixo.
  const frequent = [...soundboard.sounds]
    .filter((s) => s.play_count > 0)
    .sort((a, b) => b.play_count - a.play_count)
    .slice(0, 6)

  function canDelete(sound: SoundboardSound) {
    return sound.uploaded_by === user?.id || permissions.manage_messages
  }

  function handlePlay(sound: SoundboardSound) {
    voice.playSoundboardSound(soundboard.getUrl(sound))
    soundboard.bumpPlayCount(sound.id)
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    rawFileRef.current = file
    setDecoding(true)
    try {
      const buffer = await decodeAudioFile(file)
      if (buffer.duration > MAX_SOUND_SECONDS + 0.05) {
        // Longo demais — precisa passar pela ferramenta de recorte antes
        // de virar um pendingFile de verdade.
        setTrimState({ buffer, duration: buffer.duration, start: 0 })
        setPendingFile(null)
      } else {
        setPendingFile(file)
        setUploadName(file.name.replace(/\.[^.]+$/, '').slice(0, 32))
      }
    } catch {
      // Não deu pra decodificar (formato incomum) — deixa passar direto
      // pro fluxo normal; uploadSound ainda tenta checar a duração de
      // novo lá, e se também não conseguir, só segue sem essa trava
      // extra em vez de travar um arquivo válido.
      setPendingFile(file)
      setUploadName(file.name.replace(/\.[^.]+$/, '').slice(0, 32))
    } finally {
      setDecoding(false)
    }
  }

  function cancelUpload() {
    setPendingFile(null)
    setUploadName('')
    setTrimState(null)
    rawFileRef.current = null
    window.clearTimeout(previewStopTimeoutRef.current)
    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
      if (previewAudioRef.current.src) URL.revokeObjectURL(previewAudioRef.current.src)
      previewAudioRef.current.removeAttribute('src')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Toca só o trecho de 5s escolhido no slider abaixo, direto do arquivo
  // original (sem precisar cortar de verdade só pra ouvir) — para
  // sozinho ao fim da janela.
  function handlePreviewTrim() {
    if (!trimState || !rawFileRef.current) return
    const audio = previewAudioRef.current
    if (!audio) return
    if (!audio.src) audio.src = URL.createObjectURL(rawFileRef.current)
    activePreviewRef.current = audio
    audio.currentTime = trimState.start
    audio.play().catch(() => {})
    window.clearTimeout(previewStopTimeoutRef.current)
    previewStopTimeoutRef.current = window.setTimeout(() => audio.pause(), MAX_SOUND_SECONDS * 1000)
  }

  // Corta de verdade (via Web Audio, ver lib/audioTrim.ts) e transforma o
  // resultado num File .wav — daí em diante segue o mesmo fluxo de
  // nomear/enviar que um arquivo já curto usaria.
  function handleConfirmTrim() {
    if (!trimState) return
    const blob = trimAudioBufferToWav(trimState.buffer, trimState.start, trimState.start + MAX_SOUND_SECONDS)
    const baseName = (rawFileRef.current?.name || 'som').replace(/\.[^.]+$/, '')
    const trimmedFile = new File([blob], `${baseName}-recorte.wav`, { type: 'audio/wav' })
    setPendingFile(trimmedFile)
    setUploadName(baseName.slice(0, 32))
    setTrimState(null)
  }

  async function handleConfirmUpload() {
    if (!pendingFile) return
    setError(null)
    setUploading(true)
    const { error: uploadError } = await soundboard.uploadSound(pendingFile, uploadName)
    setUploading(false)
    if (uploadError) {
      setError(uploadError)
      return
    }
    cancelUpload()
  }

  async function handleDelete(sound: SoundboardSound, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Apagar o som "${sound.name}"?`)) return
    await soundboard.deleteSound(sound.id)
  }

  return (
    <div
      className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="soundboard-title"
        className="surface-elevated rounded-2xl max-w-lg w-full p-5 max-h-[80vh] flex flex-col animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-[10px] bg-discord-blurple/15 text-discord-blurple ring-1 ring-inset ring-discord-blurple/25 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]" aria-hidden>
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </span>
            <div className="min-w-0">
              <h2 id="soundboard-title" className="font-display text-lg font-semibold text-white leading-tight">Soundboard</h2>
              <p className="text-[12px] text-discord-text-muted">Todo mundo no canal ouve na hora</p>
            </div>
          </div>
          <button onClick={onClose} className="icon-btn w-9 h-9 shrink-0" aria-label="Fechar" title="Fechar">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
            </svg>
          </button>
        </div>

        {/* Volume dos efeitos — INDEPENDENTE do volume geral da call
            (voice.masterVolume). Pedido explícito: cada pessoa controla
            o próprio volume dos sons pra não levar susto com efeito
            alto, sem precisar mexer no volume de quem está falando. */}
        <div className="mb-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-[var(--color-line)] shrink-0 flex items-center gap-3">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-discord-text-muted shrink-0" aria-hidden>
            <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 15 8.2v7.6a4.5 4.5 0 0 0 1.5-3.8z" />
          </svg>
          <label htmlFor="soundboard-volume" className="text-[12px] font-medium text-discord-text shrink-0">Volume dos efeitos</label>
          <input
            id="soundboard-volume"
            type="range"
            min={0}
            max={100}
            value={voice.soundboardVolume}
            onChange={(e) => voice.setSoundboardVolume(Number(e.target.value))}
            className="flex-1 min-w-0 accent-discord-blurple"
          />
          <span className="text-[12px] tabular-nums text-discord-text-muted w-9 text-right shrink-0">{voice.soundboardVolume}%</span>
        </div>

        <div className="relative mb-4 shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-discord-text-muted pointer-events-none" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar sons"
            aria-label="Pesquisar sons"
            className="w-full h-10 pl-9 pr-3 bg-discord-darker text-discord-text text-sm outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {soundboard.loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" aria-busy="true" aria-label="Carregando sons">
              {Array.from({ length: 9 }, (_, i) => (
                <div key={i} className="h-11 animate-pulse bg-white/[0.05] rounded-xl" />
              ))}
            </div>
          ) : soundboard.sounds.length === 0 ? (
            <div className="flex flex-col items-center text-center py-8">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-[var(--color-line)] flex items-center justify-center mb-3">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 text-discord-text-muted" aria-hidden>
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
              <p className="text-[14px] font-semibold text-white">Nenhum som ainda</p>
              <p className="text-[13px] text-discord-text-muted mt-0.5">Envie o primeiro efeito lá embaixo!</p>
            </div>
          ) : (
            <>
              {!query && frequent.length > 0 && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-discord-text-muted mb-2 flex items-center gap-1.5">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 text-amber-400" aria-hidden>
                      <path d="m12 2 2.9 6.9L22 9.5l-5.5 4.8 1.7 7.2L12 17.8 5.8 21.5l1.7-7.2L2 9.5l7.1-.6L12 2z" />
                    </svg>
                    Usados com frequência
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {frequent.map((s) => (
                      <SoundButton
                        key={s.id}
                        sound={s}
                        onPlay={() => handlePlay(s)}
                        onDelete={canDelete(s) ? (e) => handleDelete(s, e) : undefined}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div>
                {!query && (
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-discord-text-muted mb-2">Todos os sons</p>
                )}
                {filtered.length === 0 ? (
                  <p className="text-[13px] text-discord-text-muted text-center py-6">Nenhum som encontrado pra “{search.trim()}”.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {filtered.map((s) => (
                      <SoundButton
                        key={s.id}
                        sound={s}
                        onPlay={() => handlePlay(s)}
                        onDelete={canDelete(s) ? (e) => handleDelete(s, e) : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--color-line)] shrink-0">
          {error && (
            <p role="alert" className="text-[13px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-[10px] px-3 py-2 mb-3">
              {error}
            </p>
          )}
          {decoding ? (
            <div className="h-10 flex items-center justify-center gap-2 text-[13px] text-discord-text-muted">
              <span className="w-4 h-4 rounded-full border-2 border-white/20 border-t-discord-blurple animate-spin" aria-hidden />
              Analisando áudio...
            </div>
          ) : trimState ? (
            <div className="p-3.5 rounded-xl bg-discord-blurple/[0.06] border border-discord-blurple/30">
              <p className="text-[13px] text-discord-text mb-2.5">
                Esse áudio tem {trimState.duration.toFixed(1)}s — o soundboard só aceita até {MAX_SOUND_SECONDS}s.
                Escolha o trecho:
              </p>
              <input
                type="range"
                min={0}
                max={Math.max(0, trimState.duration - MAX_SOUND_SECONDS)}
                step={0.1}
                value={trimState.start}
                onChange={(e) => setTrimState((prev) => (prev ? { ...prev, start: Number(e.target.value) } : prev))}
                className="w-full accent-discord-blurple"
              />
              <p className="text-[12px] tabular-nums text-discord-text-muted mt-1">
                Tocando de {trimState.start.toFixed(1)}s até {(trimState.start + MAX_SOUND_SECONDS).toFixed(1)}s
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button onClick={handlePreviewTrim} className="h-9 px-3 btn-secondary text-[13px] flex items-center gap-1.5">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Ouvir trecho
                </button>
                <button onClick={handleConfirmTrim} className="h-9 px-3 btn-primary text-[13px]">
                  Usar esse trecho
                </button>
                <button onClick={cancelUpload} className="h-9 px-3 btn-ghost text-[13px] ml-auto">
                  Cancelar
                </button>
              </div>
            </div>
          ) : pendingFile ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                maxLength={32}
                placeholder="Nome do som"
                autoFocus
                aria-label="Nome do som"
                className="flex-1 min-w-0 h-10 px-3 bg-discord-darker text-discord-text text-sm outline-none"
              />
              <button
                onClick={handleConfirmUpload}
                disabled={uploading}
                className="h-10 px-4 btn-primary text-sm shrink-0"
              >
                {uploading ? 'Enviando...' : 'Enviar'}
              </button>
              <button
                onClick={cancelUpload}
                disabled={uploading}
                className="h-10 px-3 btn-ghost text-sm shrink-0"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 px-3 rounded-xl border border-dashed border-[var(--color-line-strong)] text-discord-text-muted hover:text-white hover:border-discord-blurple/60 hover:bg-discord-blurple/[0.06] transition-colors flex items-center justify-center gap-2.5"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4 shrink-0" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="text-[13px] font-medium">Adicionar som</span>
              <span className="text-[11px] opacity-70 hidden sm:inline">mp3, wav, ogg — até 2MB, até {MAX_SOUND_SECONDS}s</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/ogg,audio/wav,audio/webm,.mp3,.ogg,.wav,.webm"
            onChange={handleFilePicked}
            className="hidden"
          />
          <audio ref={previewAudioRef} className="hidden" />
        </div>
      </div>
    </div>
  )
}

// Antes cada som virava um quadrado grande com ícone + nome (tipo card),
// gastando MUITO espaço vertical pra pouca informação — com uma lista
// de sons um pouco maior, o painel virava um scroll infinito. O Discord
// de verdade mostra só o NOME num botãozinho compacto (só o texto,
// sem ícone), bem mais denso — é esse o visual que reproduzimos aqui.
function SoundButton({
  sound,
  onPlay,
  onDelete,
}: {
  sound: SoundboardSound
  onPlay: () => void
  onDelete?: (e: React.MouseEvent) => void
}) {
  return (
    <div className="relative group">
      <button
        onClick={onPlay}
        title={sound.name}
        aria-label={`Tocar ${sound.name}`}
        className="w-full h-11 pl-2.5 pr-3 rounded-xl bg-white/[0.04] border border-[var(--color-line)] hover:bg-discord-blurple/[0.12] hover:border-discord-blurple/50 hover:-translate-y-px active:translate-y-0 active:scale-[0.98] transition-all flex items-center gap-2 text-left"
      >
        <span className="w-6 h-6 rounded-full bg-white/[0.06] group-hover:bg-discord-blurple text-discord-text-muted group-hover:text-white flex items-center justify-center shrink-0 transition-colors" aria-hidden>
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 ml-px">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        <span className="text-[13px] font-medium text-discord-text truncate">{sound.name}</span>
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          title="Apagar som"
          aria-label={`Apagar som ${sound.name}`}
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 flex items-center justify-center transition-opacity shadow-md"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="w-2.5 h-2.5" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  )
}
