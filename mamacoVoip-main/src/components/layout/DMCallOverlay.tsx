import { useState } from 'react'
import { useVoice } from '../../hooks/useVoice'
import { Avatar } from '../ui/Avatar'
import { VideoTile, RemoteAudio } from './CallMediaTiles'
import type { Profile } from '../../types/database'

// Barra flutuante da chamada de voz/vídeo quando ela é numa DM ou
// grupo (não num canal de servidor — esses já têm a própria tela
// cheia em VoiceChannelView.tsx). Fica montada globalmente
// (MainLayout.tsx) porque a chamada em si continua mesmo navegando
// pra outro lugar do app — só aparece quando de fato há uma chamada
// de DM/grupo em andamento (connectedServerId null é o sinal disso,
// ver join() em VoiceContext.tsx).
export function DMCallOverlay({ profilesById }: { profilesById: Record<string, Profile> }) {
  const voice = useVoice()
  const [minimized, setMinimized] = useState(false)

  if (!voice.connectedChannelId || voice.connectedServerId) return null

  const participantIds = Object.keys(voice.participants)
  const hasAnyVideo = participantIds.some((id) => voice.participants[id]?.cameraStream?.getVideoTracks().length)

  return (
    <div className="fixed bottom-20 right-4 z-[350] w-72 bg-discord-dark rounded-xl shadow-2xl border border-discord-blurple/20 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-discord-darker">
        <span className="text-xs font-medium text-white truncate">
          {voice.connectedChannelName || 'Chamada'}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized((v) => !v)}
            className="w-6 h-6 flex items-center justify-center rounded text-discord-text-muted hover:text-white hover:bg-white/5"
            title={minimized ? 'Expandir' : 'Minimizar'}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
              {minimized ? <path d="M7 10l5 5 5-5z" /> : <path d="M7 14l5-5 5 5z" />}
            </svg>
          </button>
        </div>
      </div>

      {!minimized && (
        <div className={`grid gap-1.5 p-2 ${hasAnyVideo ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {/* Sem preview da própria câmera aqui — mesma escolha já feita
              em VoiceChannelView.tsx (o tile local nunca recebe um
              cameraStream próprio, só mostra o avatar). */}
          <ParticipantMiniTile
            key="local"
            isLocal
            name="Você"
            avatarUrl={undefined}
            speaking={voice.speaking}
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
                speaking={data?.speaking ?? false}
                hasVideo={hasVideo}
                stream={data?.cameraStream ?? null}
                sinkId={voice.audioSettings.speakerId}
              />
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-center gap-2 px-3 py-2.5 border-t border-black/20">
        <button
          onClick={voice.toggleMute}
          title={voice.muted ? 'Ativar microfone' : 'Silenciar'}
          className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${
            voice.muted ? 'bg-red-600 text-white' : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
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
          className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${
            voice.deafened ? 'bg-red-600 text-white' : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5v-1a7 7 0 0 1 14 0v1h-2a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z" />
          </svg>
        </button>

        <button
          onClick={() => voice.toggleVideo()}
          title={voice.videoEnabled ? 'Desligar câmera' : 'Ligar câmera'}
          className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${
            voice.videoEnabled ? 'bg-discord-blurple text-white' : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
          </svg>
        </button>

        <button
          onClick={voice.leave}
          title="Sair da chamada"
          className="w-9 h-9 flex items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 rotate-135">
            <path d="M20 15.5c-1.2 0-2.5-.2-3.6-.6-.4-.1-.8 0-1.1.3l-2.2 2.2c-2.8-1.4-5.2-3.8-6.6-6.6l2.2-2.2c.3-.3.4-.7.3-1.1-.4-1.1-.6-2.4-.6-3.6 0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1 0 9.4 7.6 17 17 17 .6 0 1-.4 1-1v-3.5c0-.6-.4-1-1-1z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function ParticipantMiniTile({
  isLocal,
  name,
  avatarUrl,
  speaking,
  hasVideo,
  stream,
  sinkId,
}: {
  isLocal: boolean
  name: string
  avatarUrl?: string | null
  speaking: boolean
  hasVideo: boolean
  stream: MediaStream | null
  sinkId?: string | null
}) {
  return (
    <div
      className={`relative aspect-video bg-discord-darker rounded-md flex items-center justify-center overflow-hidden border transition-colors ${
        speaking ? 'border-discord-blurple' : 'border-transparent'
      }`}
    >
      {hasVideo && stream ? (
        <VideoTile stream={stream} sinkId={sinkId} />
      ) : (
        <Avatar name={name} avatarUrl={avatarUrl ?? null} size={36} />
      )}
      {!isLocal && stream && <RemoteAudio stream={stream} sinkId={sinkId} volume={1} />}
      <span className="absolute bottom-0.5 left-1 text-[9px] text-white/90 bg-black/40 px-1 rounded truncate max-w-[90%]">
        {name}
      </span>
    </div>
  )
}
