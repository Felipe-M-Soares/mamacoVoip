import { useEffect, useRef } from 'react'
import { Avatar } from '../ui/Avatar'
import { useAuth } from '../../hooks/useAuth'
import { useServerMembers } from '../../hooks/useServerMembers'
import { useVoiceChannel, type VoiceParticipant } from '../../hooks/useVoiceChannel'
import type { Channel } from '../../types/database'

function VideoTile({ stream, muted = false, sinkId }: { stream: MediaStream; muted?: boolean; sinkId?: string | null }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  useEffect(() => {
    const el = ref.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (el && sinkId && el.setSinkId) el.setSinkId(sinkId).catch(() => {})
  }, [sinkId])
  return <video ref={ref} autoPlay playsInline muted={muted} className="w-full h-full object-cover rounded-lg bg-black" />
}

function RemoteAudio({ stream, sinkId }: { stream: MediaStream; sinkId?: string | null }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  useEffect(() => {
    const el = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (el && sinkId && el.setSinkId) el.setSinkId(sinkId).catch(() => {})
  }, [sinkId])
  return <audio ref={ref} autoPlay />
}

function ParticipantTile({
  name,
  avatarUrl,
  data,
  isLocal,
  localVideoEnabled,
  localScreenSharing,
  sinkId,
}: {
  name: string
  avatarUrl?: string | null
  data: VoiceParticipant | undefined
  isLocal: boolean
  localVideoEnabled?: boolean
  localScreenSharing?: boolean
  sinkId?: string | null
}) {
  const speaking = data?.speaking ?? false
  const hasCameraVideo = isLocal ? localVideoEnabled : Boolean(data?.cameraStream?.getVideoTracks().length)

  return (
    <div
      className={`relative aspect-video bg-discord-darker rounded-lg flex items-center justify-center overflow-hidden border-2 transition-colors ${
        speaking ? 'border-discord-green' : 'border-transparent'
      }`}
    >
      {hasCameraVideo && data?.cameraStream ? (
        <VideoTile stream={data.cameraStream} muted={isLocal} sinkId={sinkId} />
      ) : (
        <Avatar name={name} avatarUrl={avatarUrl} size={64} />
      )}
      {!isLocal && data?.cameraStream && <RemoteAudio stream={data.cameraStream} sinkId={sinkId} />}
      <span className="absolute bottom-1.5 left-2 text-xs text-white bg-black/50 px-1.5 py-0.5 rounded">
        {name}
        {isLocal && ' (você)'}
      </span>
      {((isLocal && localScreenSharing) || data?.screenStream) && (
        <span className="absolute top-1.5 right-2 text-xs text-white bg-discord-blurple/80 px-1.5 py-0.5 rounded">
          Compartilhando tela
        </span>
      )}
    </div>
  )
}

export function VoiceChannelView({ channel, serverId }: { channel: Channel; serverId: string }) {
  const { profile } = useAuth()
  const { members } = useServerMembers(serverId)
  const voice = useVoiceChannel(channel.id, serverId)

  const profileById = Object.fromEntries(members.map((m) => [m.user_id, m.profile]))

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-discord-channels">
      <header className="h-12 px-4 flex items-center gap-2 border-b border-black/20 shadow-sm shrink-0">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-discord-text-muted">
          <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
        </svg>
        <h2 className="font-semibold text-white">{channel.name}</h2>
        {voice.connected && (
          <span className="text-xs text-discord-text-muted">
            {Object.keys(voice.participants).length + 1}/{voice.maxParticipants} conectados
          </span>
        )}
      </header>

      {!voice.connected ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <div className="w-16 h-16 rounded-full bg-discord-lighter flex items-center justify-center mb-4">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-discord-text-muted">
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-white">{channel.name}</h3>
          <p className="text-discord-text-muted mt-1 max-w-sm">
            Ninguém está no canal de voz ainda. Entre pra começar uma chamada.
          </p>
          {voice.error && <p className="text-sm text-red-400 mt-3">{voice.error}</p>}
          <button
            onClick={voice.join}
            disabled={voice.connecting}
            className="mt-4 px-5 py-2.5 rounded bg-discord-green text-white font-medium hover:bg-green-600 transition-colors disabled:opacity-60"
          >
            {voice.connecting ? 'Conectando...' : 'Entrar no canal de voz'}
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4">
            {voice.localScreenStream && (
              <div className="mb-4 aspect-video max-h-96 mx-auto rounded-lg overflow-hidden border border-black/30">
                <VideoTile stream={voice.localScreenStream} muted />
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {profile && (
                <ParticipantTile
                  name={profile.display_name || profile.username}
                  avatarUrl={profile.avatar_url}
                  data={undefined}
                  isLocal
                  localVideoEnabled={voice.videoEnabled}
                  localScreenSharing={voice.screenSharing}
                />
              )}
              {Object.entries(voice.participants).map(([userId, data]) => {
                const p = profileById[userId]
                return (
                  <ParticipantTile
                    key={userId}
                    name={p?.display_name || p?.username || 'Usuário'}
                    avatarUrl={p?.avatar_url}
                    data={data}
                    isLocal={false}
                    sinkId={voice.audioSettings.speakerId}
                  />
                )
              })}
            </div>
          </div>

          <div className="px-4 pb-6 shrink-0 flex items-center justify-center gap-3">
            <button
              onClick={voice.toggleMute}
              title={voice.muted ? 'Ativar microfone' : 'Mutar microfone'}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                voice.muted ? 'bg-red-600 text-white' : 'bg-discord-lighter text-discord-text hover:bg-discord-darker'
              }`}
            >
              {voice.muted ? (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-8.6 3.5L18 5A1 1 0 1 0 16.6 3.6L3.6 16.6A1 1 0 1 0 5 18l2-2A7 7 0 0 0 19 11zM12 15a3 3 0 0 0 3-3l-5.7 5.7A3 3 0 0 0 12 15zM9 6a3 3 0 0 1 6 0v3.5l2-2V6a5 5 0 0 0-9.9-1L9 6.6V6z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zM19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11z" />
                </svg>
              )}
            </button>

            {voice.audioSettings.microphones.length > 1 && (
              <select
                value={voice.audioSettings.micId ?? ''}
                onChange={(e) => voice.changeMicrophone(e.target.value)}
                title="Escolher microfone"
                className="bg-discord-lighter text-discord-text text-xs rounded-full px-3 py-2 outline-none max-w-[140px] truncate"
              >
                {voice.audioSettings.microphones.map((m) => (
                  <option key={m.deviceId} value={m.deviceId}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={voice.toggleVideo}
              title={voice.videoEnabled ? 'Desativar câmera' : 'Ativar câmera'}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                voice.videoEnabled ? 'bg-discord-blurple text-white' : 'bg-discord-lighter text-discord-text hover:bg-discord-darker'
              }`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
              </svg>
            </button>

            <button
              onClick={voice.toggleScreenShare}
              title={voice.screenSharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                voice.screenSharing ? 'bg-discord-blurple text-white' : 'bg-discord-lighter text-discord-text hover:bg-discord-darker'
              }`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M4 4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h5l-1 3h8l-1-3h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4zm0 2h16v9H4V6z" />
              </svg>
            </button>

            <button
              onClick={voice.leave}
              title="Desconectar"
              className="w-11 h-11 rounded-full flex items-center justify-center bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
              </svg>
            </button>
          </div>
        </>
      )}
    </section>
  )
}
