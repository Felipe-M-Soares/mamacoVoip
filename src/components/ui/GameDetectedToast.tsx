import { useGameJustDetected } from '../../hooks/useGameJustDetected'
import { useVoiceCore } from '../../hooks/useVoice'
import { useKeybinds } from '../../lib/keybinds'

export function GameDetectedToast() {
  const { justDetectedGame, dismiss } = useGameJustDetected()
  const overlayCombo = useKeybinds().bindings['toggle-overlay']
  const voice = useVoiceCore()

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
    <div role="status" className="fixed bottom-48 left-3 z-[260] w-72 max-w-[calc(100vw-1.5rem)] surface-elevated rounded-2xl p-4 animate-pop-in">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-gradient flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white">
            <path d="M15 7.5H9a5.5 5.5 0 0 0 0 11h6a5.5 5.5 0 0 0 0-11zM7.5 12h1.25v1.25h1.5V12H11.5v-1.5H10.25V9.25h-1.5v1.25H7.5V12zm8-2.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 3a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">Jogando {justDetectedGame}</p>
          <p className="text-xs text-mv-muted mt-0.5">
            {inVoiceCall ? 'Quer compartilhar sua tela na call?' : 'Já apareceu no seu status pros seus amigos.'}
          </p>
        </div>
        <button onClick={dismiss} title="Dispensar" aria-label="Dispensar" className="icon-btn w-7 h-7 -mt-1 -mr-1.5 shrink-0">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
          </svg>
        </button>
      </div>

      {inVoiceCall && (
        <p className="text-[11px] leading-snug text-mv-muted mt-2" title="Sobreposição só aparece com o jogo em janela sem borda (sem injeção no jogo, seguro com anti-cheat).">
          {voice.screenShareQuality.gameAuto ? 'Transmite em 1080p60. ' : ''}{overlayCombo ? `Sobreposição: ${overlayCombo} (jogo em janela sem borda).` : 'Sobreposição: ligue no menu da sala ou crie um atalho em Configurações → Atalhos.'}
        </p>
      )}

      {inVoiceCall && (
        <div className="flex gap-2 mt-3.5">
          <button onClick={handleShare} className="flex-1 h-9 btn-primary text-sm">
            Compartilhar tela
          </button>
          <button onClick={dismiss} className="flex-1 h-9 btn-secondary text-sm">
            Agora não
          </button>
        </div>
      )}
    </div>
  )
}
