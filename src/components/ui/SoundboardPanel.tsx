import { useRef, useState } from 'react'
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
      className="fixed inset-0 z-[300] bg-black/50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-discord-dark rounded-lg shadow-2xl max-w-lg w-full p-4 border border-white/5 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h2 className="font-display text-lg font-bold text-white tracking-wide">Soundboard</h2>
          <button onClick={onClose} className="text-discord-text-muted hover:text-white p-1">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
            </svg>
          </button>
        </div>

        {/* Volume dos efeitos — INDEPENDENTE do volume geral da call
            (voice.masterVolume). Pedido explícito: cada pessoa controla
            o próprio volume dos sons pra não levar susto com efeito
            alto, sem precisar mexer no volume de quem está falando. */}
        <div className="mb-3 p-2.5 rounded-lg bg-discord-darker/60 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-bold uppercase text-discord-text-muted">Volume dos efeitos</label>
            <span className="text-[11px] text-discord-text-muted">{voice.soundboardVolume}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={voice.soundboardVolume}
            onChange={(e) => voice.setSoundboardVolume(Number(e.target.value))}
            className="w-full accent-discord-blurple"
          />
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquisar sons"
          className="w-full px-3 py-2 mb-3 rounded bg-discord-darker text-discord-text text-sm outline-none focus:ring-2 focus:ring-discord-blurple shrink-0"
        />

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {soundboard.loading ? (
            <p className="text-sm text-discord-text-muted text-center py-6">Carregando...</p>
          ) : soundboard.sounds.length === 0 ? (
            <p className="text-sm text-discord-text-muted text-center py-6">
              Nenhum som ainda. Envie o primeiro efeito abaixo!
            </p>
          ) : (
            <>
              {!query && frequent.length > 0 && (
                <div className="mb-4">
                  <p className="text-[11px] font-bold uppercase text-discord-text-muted mb-1.5">
                    Usados com frequência
                  </p>
                  <div className="grid grid-cols-3 gap-2">
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
                  <p className="text-[11px] font-bold uppercase text-discord-text-muted mb-1.5">Todos os sons</p>
                )}
                {filtered.length === 0 ? (
                  <p className="text-sm text-discord-text-muted text-center py-4">Nenhum som encontrado.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
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

        <div className="mt-3 pt-3 border-t border-white/10 shrink-0">
          {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
          {decoding ? (
            <p className="text-xs text-discord-text-muted text-center py-2.5">Analisando áudio...</p>
          ) : trimState ? (
            <div className="p-3 rounded-lg bg-discord-darker border border-discord-blurple/40">
              <p className="text-xs text-discord-text mb-2">
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
              <p className="text-[11px] text-discord-text-muted mt-1">
                Tocando de {trimState.start.toFixed(1)}s até {(trimState.start + MAX_SOUND_SECONDS).toFixed(1)}s
              </p>
              <div className="flex gap-2 mt-2.5">
                <button onClick={handlePreviewTrim} className="px-3 py-1.5 rounded btn-secondary text-xs">
                  ▶ Ouvir trecho
                </button>
                <button onClick={handleConfirmTrim} className="px-3 py-1.5 rounded btn-primary text-xs">
                  Usar esse trecho
                </button>
                <button onClick={cancelUpload} className="px-3 py-1.5 rounded btn-secondary text-xs ml-auto">
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
                className="flex-1 min-w-0 px-3 py-2 rounded bg-discord-darker text-discord-text text-sm outline-none focus:ring-2 focus:ring-discord-blurple"
              />
              <button
                onClick={handleConfirmUpload}
                disabled={uploading}
                className="px-4 py-2 rounded btn-primary text-sm shrink-0 disabled:opacity-60"
              >
                {uploading ? 'Enviando...' : 'Enviar'}
              </button>
              <button
                onClick={cancelUpload}
                disabled={uploading}
                className="px-3 py-2 rounded btn-secondary text-sm shrink-0 disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2.5 rounded btn-secondary text-sm"
            >
              + Adicionar som (mp3, wav, ogg — até 2MB, até {MAX_SOUND_SECONDS}s)
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
        className="w-full aspect-square flex flex-col items-center justify-center gap-1 rounded-lg bg-discord-darker hover:bg-discord-blurple/20 border border-white/5 hover:border-discord-blurple transition-colors p-2"
      >
        <span className="text-xl">🔊</span>
        <span className="text-[11px] text-discord-text truncate w-full text-center">{sound.name}</span>
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          title="Apagar som"
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-xs opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
        >
          ×
        </button>
      )}
    </div>
  )
}
