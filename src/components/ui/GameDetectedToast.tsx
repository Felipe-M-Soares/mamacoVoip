import { useGameJustDetected } from '../../hooks/useGameJustDetected'
import { useVoice } from '../../hooks/useVoice'

export function GameDetectedToast() {
  const { justDetectedGame, dismiss } = useGameJustDetected()
  const voice = useVoice()

  if (!justDetectedGame) return null

  const inVoiceCall = Boolean(voice.connectedChannelId)

  async function handleShare() {
    // DÉCIMA QUARTA RODADA: `{ auto: true }` pula o seletor manual —
    // antes disso, clicar aqui abria o MESMO seletor completo de novo
    // (relatado: "esse botão já devia compartilhar direto"), mesmo já
    // sabendo qual jogo é. Ver o comentário grande em
    // captureScreenShareStream (VoiceContext.tsx).
    if (inVoiceCall && !voice.screenSharing) {
      await voice.toggleScreenShare({ auto: true })
    }
    dismiss()
  }

  return (
    <div className="fixed bottom-48 left-3 z-[260] w-72 bg-discord-dark border border-discord-blurple/30 rounded-xl shadow-2xl p-3.5 brand-glow-sm">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-discord-blurple/20 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-discord-blurple">
            <path d="M15 7.5H9a5.5 5.5 0 0 0 0 11h6a5.5 5.5 0 0 0 0-11zM7.5 12h1.25v1.25h1.5V12H11.5v-1.5H10.25V9.25h-1.5v1.25H7.5V12zm8-2.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 3a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">Jogando {justDetectedGame}!</p>
          <p className="text-xs text-discord-text-muted mt-0.5">
            {inVoiceCall ? 'Quer compartilhar sua tela na call?' : 'Já apareceu no seu status pros seus amigos.'}
          </p>
        </div>
        <button onClick={dismiss} title="Dispensar" className="text-discord-text-muted hover:text-white shrink-0">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
          </svg>
        </button>
      </div>

      {inVoiceCall && (
        <div className="flex gap-2 mt-3">
          <button onClick={handleShare} className="flex-1 py-1.5 rounded btn-primary text-xs">
            Compartilhar tela
          </button>
          <button onClick={dismiss} className="flex-1 py-1.5 rounded btn-secondary text-xs">
            Agora não
          </button>
        </div>
      )}
    </div>
  )
}
