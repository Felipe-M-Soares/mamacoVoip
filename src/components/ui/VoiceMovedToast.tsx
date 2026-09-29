import { Avatar } from './Avatar'
import { useVoiceMoveRequests } from '../../hooks/useVoiceMoveRequests'

// Aviso "Você foi movido para #canal por X" — e, mais importante, é quem
// monta o useVoiceMoveRequests (uma vez só, no MainLayout), que escuta os
// pedidos de mover e troca de sala de voz sozinho.
export function VoiceMovedToast() {
  const { notices, dismiss } = useVoiceMoveRequests()

  if (notices.length === 0) return null

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[270] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} role="status" className="surface-elevated rounded-2xl p-3.5 animate-pop-in flex items-center gap-3">
          <Avatar name={n.movedByName} avatarUrl={n.movedByAvatarUrl} size={32} />
          <p className="text-[13px] text-discord-text leading-snug min-w-0 flex-1">
            Você foi movido para <span className="font-semibold text-white break-words">#{n.channelName}</span> por{' '}
            <span className="font-semibold text-white break-words">{n.movedByName}</span>
          </p>
          <button onClick={() => dismiss(n.id)} title="Fechar aviso" aria-label="Fechar aviso" className="icon-btn w-7 h-7 shrink-0">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
              <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
