import { useState } from 'react'
import { useVoiceCore, useVoiceSpeaking } from '../../hooks/useVoice'
import { useAuth } from '../../hooks/useAuth'
import { Avatar } from '../ui/Avatar'
import { VideoTile } from './CallMediaTiles'
import type { Profile } from '../../types/database'

// Barra flutuante da chamada de voz/vídeo quando ela é numa DM ou
// grupo (não num canal de servidor — esses já têm a própria tela
// cheia em VoiceChannelView.tsx). Fica montada globalmente
// (MainLayout.tsx) porque a chamada em si continua mesmo navegando
// pra outro lugar do app — só aparece quando de fato há uma chamada
// de DM/grupo em andamento (connectedServerId null é o sinal disso,
// ver join() em VoiceContext.tsx).
export function DMCallOverlay({ profilesById }: { profilesById: Record<string, Profile> }) {
  const voice = useVoiceCore()
  const selfId = useAuth().user?.id ?? null
  const [minimized, setMinimized] = useState(false)

  if (!voice.connectedChannelId || voice.connectedServerId) return null

  const participantIds = Object.keys(voice.participants)
  const hasAnyVideo = participantIds.some((id) => voice.participants[id]?.cameraStream?.getVideoTracks().length)

  return (
    <div
      role="region"
      aria-label="Chamada em andamento"
      className="fixed bottom-20 right-4 z-[350] w-[300px] max-w-[calc(100vw-2rem)] surface-elevated rounded-2xl overflow-hidden animate-pop-in"
    >
      <div className="flex items-center justify-between gap-2 pl-3.5 pr-2 h-11 border-b border-[var(--color-line)]">
        <span className="flex items-center gap-2 min-w-0">
          <span className="relative flex w-2 h-2 shrink-0" aria-hidden>
            <span className="absolute inset-0 rounded-full bg-discord-green animate-ping opacity-60" />
            <span className="relative w-2 h-2 rounded-full bg-discord-green" />
          </span>
          <span className="text-[13px] font-semibold text-white truncate">
            {voice.connectedChannelName || 'Chamada'}
          </span>
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized((v) => !v)}
            className="icon-btn w-7 h-7"
            title={minimized ? 'Expandir' : 'Minimizar'}
            aria-label={minimized ? 'Expandir' : 'Minimizar'}
            aria-expanded={!minimized}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              {minimized ? <path d="M7 10l5 5 5-5z" /> : <path d="M7 14l5-5 5 5z" />}
            </svg>
          </button>
        </div>
      </div>

      {!minimized && (
        <div className={`grid gap-2 p-2.5 ${hasAnyVideo ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {/* Sem preview da própria câmera aqui — mesma escolha já feita
              em VoiceChannelView.tsx (o tile local nunca recebe um
              cameraStream próprio, só mostra o avatar). */}
          <ParticipantMiniTile
            key="local"
            isLocal
            name="Você"
            avatarUrl={undefined}
            speakerId={selfId}
            hasVideo={false}
            stream={null}
            sinkId={null}
          />
          {participantIds.map((id) => {
            const data = voice.participants[id]
            const profile = profilesById[id]
            const hasVideo = Boolean(data?.cameraStream?.getVideoTracks().length)
            return (
              <ParticipantMiniTile
                key={id}
                isLocal={false}
                name={profile?.display_name || profile?.username || 'Usuário'}
                avatarUrl={profile?.avatar_url}
                speakerId={id}
                hasVideo={hasVideo}
                stream={data?.cameraStream ?? null}
                sinkId={voice.audioSettings.speakerId}
              />
            )
          })}
        </div>
      )}

      <div role="toolbar" aria-label="Controles da chamada" className="flex items-center justify-center gap-2 px-3 py-2.5 border-t border-[var(--color-line)] bg-white/[0.02]">
        <button
          onClick={voice.toggleMute}
          title={voice.muted ? 'Ativar microfone' : 'Silenciar'}
          aria-label={voice.muted ? 'Ativar microfone' : 'Silenciar'}
          aria-pressed={voice.muted}
          className={`w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-95 ${
            voice.muted ? 'bg-rose-500/15 text-rose-400 ring-1 ring-inset ring-rose-500/35 hover:bg-rose-500/25' : 'bg-white/[0.07] text-discord-text hover:bg-white/[0.13] hover:text-white'
          }`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
            {voice.muted ? (
              <path d="M19 11h-1.7a5.3 5.3 0 0 1-.34 1.87l1.23 1.24c.5-.94.81-2 .81-3.11zm-4.02.17c0-.06.02-.11.02-.17V5a3 3 0 0 0-6 0v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11a3 3 0 0 0 4.68 2.49l1.44 1.44A5 5 0 0 1 7 10H5.3c0 3.03 2.13 5.56 5 6.2V19H7v2h6.73l1.99 2 1.27-1.27L4.27 3z" />
            ) : (
              <path d="M12 15.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v6a3.5 3.5 0 0 0 3.5 3.5zM18 12a6 6 0 0 1-12 0H4.3c0 3.03 2.13 5.56 5 6.2V21h5.4v-2.8c2.87-.64 5-3.17 5-6.2H18z" />
            )}
          </svg>
        </button>

        <button
          onClick={voice.toggleDeafen}
          title={voice.deafened ? 'Reativar áudio' : 'Ensurdecer'}
          aria-label={voice.deafened ? 'Reativar áudio' : 'Ensurdecer'}
          aria-pressed={voice.deafened}
          className={`w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-95 ${
            voice.deafened ? 'bg-rose-500/15 text-rose-400 ring-1 ring-inset ring-rose-500/35 hover:bg-rose-500/25' : 'bg-white/[0.07] text-discord-text hover:bg-white/[0.13] hover:text-white'
          }`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
            <path d="M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5v-1a7 7 0 0 1 14 0v1h-2a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z" />
          </svg>
        </button>

        <button
          onClick={() => voice.toggleVideo()}
          title={voice.videoEnabled ? 'Desligar câmera' : 'Ligar câmera'}
          aria-label={voice.videoEnabled ? 'Desligar câmera' : 'Ligar câmera'}
          aria-pressed={voice.videoEnabled}
          className={`w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-95 ${
            voice.videoEnabled ? 'bg-discord-blurple text-white hover:brightness-110' : 'bg-white/[0.07] text-discord-text hover:bg-white/[0.13] hover:text-white'
          }`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
            <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
          </svg>
        </button>

        <button
          onClick={voice.leave}
          title="Sair da chamada"
          aria-label="Sair da chamada"
          className="btn-danger !rounded-full w-14 h-10 flex items-center justify-center ml-1"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 rotate-135">
            <path d="M20 15.5c-1.2 0-2.5-.2-3.6-.6-.4-.1-.8 0-1.1.3l-2.2 2.2c-2.8-1.4-5.2-3.8-6.6-6.6l2.2-2.2c.3-.3.4-.7.3-1.1-.4-1.1-.6-2.4-.6-3.6 0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1 0 9.4 7.6 17 17 17 .6 0 1-.4 1-1v-3.5c0-.6-.4-1-1-1z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function ParticipantMiniTile({
  name,
  avatarUrl,
  speakerId,
  hasVideo,
  stream,
  sinkId,
}: {
  isLocal: boolean
  name: string
  avatarUrl?: string | null
  // Quem é (pra acender a borda quando fala) — lido direto do store de
  // atividade, sem re-renderizar a janela da chamada inteira.
  speakerId: string | null
  hasVideo: boolean
  stream: MediaStream | null
  sinkId?: string | null
}) {
  const speaking = useVoiceSpeaking(speakerId)
  return (
    <div
      className={`relative ${hasVideo && stream ? 'aspect-video' : 'aspect-[5/4] flex-col gap-1.5 pt-1'} bg-discord-darker rounded-xl flex items-center justify-center overflow-hidden border transition-[border-color,box-shadow] duration-200 ${
        speaking
          ? 'border-discord-green/80 shadow-[0_0_0_1px_var(--color-discord-green),0_0_16px_-4px_var(--color-discord-green)]'
          : 'border-[var(--color-line)]'
      }`}
    >
      {hasVideo && stream ? (
        <VideoTile stream={stream} sinkId={sinkId} />
      ) : (
        <div className={`rounded-full transition-shadow ${speaking ? 'ring-2 ring-discord-green ring-offset-2 ring-offset-discord-darker' : ''}`}>
          <Avatar name={name} avatarUrl={avatarUrl ?? null} size={34} />
        </div>
      )}
      {/* O áudio da chamada NÃO toca mais aqui — ver VoiceCallAudio.tsx
          (sempre montado): aqui dentro ele parava ao minimizar a barra e
          ignorava volume/ensurdecer. */}
      {hasVideo && stream ? (
        <span className="glass absolute bottom-1 left-1 text-[10px] font-medium text-white px-1.5 py-px rounded-full truncate max-w-[90%]">
          {name}
        </span>
      ) : (
        <span className="text-[11px] font-medium text-discord-text truncate max-w-[90%]">{name}</span>
      )}
    </div>
  )
}
