import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { useAuth } from '../../hooks/useAuth'
import { useServerMembers } from '../../hooks/useServerMembers'
import { useVoice } from '../../hooks/useVoice'
import { InviteFriendsModal } from '../modals/InviteFriendsModal'
import type { VoiceParticipant } from '../../context/VoiceContext'
import type { Channel } from '../../types/database'

function VideoTile({ stream, sinkId }: { stream: MediaStream; sinkId?: string | null }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  useEffect(() => {
    const el = ref.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (el && sinkId && el.setSinkId) el.setSinkId(sinkId).catch(() => {})
  }, [sinkId])
  // Sempre mudo — o áudio de participantes remotos toca via <RemoteAudio>,
  // que aplica o volume individual. Tocar os dois ao mesmo tempo dava
  // áudio duplicado sempre que alguém ligava a câmera.
  return <video ref={ref} autoPlay playsInline muted className="w-full h-full object-cover rounded-lg bg-black" />
}

function RemoteAudio({ stream, sinkId, volume }: { stream: MediaStream; sinkId?: string | null; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  useEffect(() => {
    const el = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (el && sinkId && el.setSinkId) el.setSinkId(sinkId).catch(() => {})
  }, [sinkId])
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume))
  }, [volume])
  return <audio ref={ref} autoPlay />
}

// "Palco" de compartilhamentos de tela: divide o espaço certinho
// dependendo de quantas pessoas estão compartilhando ao mesmo tempo.
function ScreenShareStage({
  shares,
}: {
  shares: { key: string; name: string; stream: MediaStream; isLocal: boolean }[]
}) {
  const cols = shares.length <= 1 ? 1 : shares.length <= 2 ? 2 : shares.length <= 4 ? 2 : 3

  return (
    <div
      className="grid gap-3 mb-4"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {shares.map((share) => (
        <div key={share.key} className="relative aspect-video rounded-lg overflow-hidden border border-black/30 bg-black">
          <VideoTile stream={share.stream} />
          <span className="absolute bottom-1.5 left-2 text-xs text-white bg-black/60 px-1.5 py-0.5 rounded flex items-center gap-1">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
              <path d="M4 4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h5l-1 3h8l-1-3h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4zm0 2h16v9H4V6z" />
            </svg>
            {share.name}
            {share.isLocal && ' (você)'}
          </span>
        </div>
      ))}
    </div>
  )
}

function ParticipantTile({
  userId,
  name,
  avatarUrl,
  data,
  isLocal,
  localVideoEnabled,
  sinkId,
  compact = false,
}: {
  userId: string
  name: string
  avatarUrl?: string | null
  data: VoiceParticipant | undefined
  isLocal: boolean
  localVideoEnabled?: boolean
  sinkId?: string | null
  compact?: boolean
}) {
  const voice = useVoice()
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  const speaking = data?.speaking ?? false
  const hasCameraVideo = isLocal ? localVideoEnabled : Boolean(data?.cameraStream?.getVideoTracks().length)
  const participantVolume = isLocal ? 100 : voice.getParticipantVolume(userId)
  const effectiveVolume = (voice.masterVolume / 100) * (participantVolume / 100)

  const volumeButton = !isLocal && (
    <div className={compact ? 'relative' : 'absolute top-1.5 left-1.5 opacity-0 group-hover/tile:opacity-100 transition-opacity'}>
      <button
        onClick={() => setShowVolumeSlider((v) => !v)}
        title="Ajustar volume deste participante"
        className={
          compact
            ? 'w-5 h-5 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80'
            : 'w-6 h-6 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80'
        }
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
          <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 15 8.2v7.6a4.5 4.5 0 0 0 1.5-3.8z" />
        </svg>
      </button>
      {showVolumeSlider && (
        <div className="absolute bottom-full left-0 mb-1 bg-[#111214] rounded-lg shadow-xl border border-black/40 p-2.5 w-32 z-10">
          <p className="text-[10px] text-discord-text-muted mb-1.5">{participantVolume}%</p>
          <input
            type="range"
            min={0}
            max={100}
            value={participantVolume}
            onChange={(e) => voice.setParticipantVolume(userId, Number(e.target.value))}
            className="w-full accent-discord-blurple"
          />
        </div>
      )}
    </div>
  )

  const audioEl = !isLocal && data?.cameraStream && (
    <RemoteAudio stream={data.cameraStream} sinkId={sinkId} volume={effectiveVolume} />
  )

  if (compact) {
    return (
      <div className="flex flex-col items-center gap-1 w-16 shrink-0" onMouseLeave={() => setShowVolumeSlider(false)}>
        <div className={`relative rounded-full ${speaking ? 'ring-2 ring-discord-green' : ''}`}>
          <Avatar name={name} avatarUrl={avatarUrl} size={48} />
          {audioEl}
        </div>
        <span className="text-[10px] text-discord-text truncate max-w-full">{isLocal ? 'Você' : name}</span>
        {volumeButton}
      </div>
    )
  }

  return (
    <div
      className={`relative aspect-video bg-discord-darker rounded-lg flex items-center justify-center overflow-hidden border-2 transition-colors group/tile ${
        speaking ? 'border-discord-green' : 'border-transparent'
      }`}
      onMouseLeave={() => setShowVolumeSlider(false)}
    >
      {hasCameraVideo && data?.cameraStream ? (
        <VideoTile stream={data.cameraStream} sinkId={sinkId} />
      ) : (
        <Avatar name={name} avatarUrl={avatarUrl} size={64} />
      )}
      {audioEl}
      <span className="absolute bottom-1.5 left-2 text-xs text-white bg-black/50 px-1.5 py-0.5 rounded">
        {name}
        {isLocal && ' (você)'}
      </span>
      {volumeButton}
    </div>
  )
}

export function VoiceChannelView({ channel, serverId }: { channel: Channel; serverId: string }) {
  const { profile } = useAuth()
  const { members } = useServerMembers(serverId)
  const voice = useVoice()
  const [showInvite, setShowInvite] = useState(false)

  const profileById = Object.fromEntries(members.map((m) => [m.user_id, m.profile]))
  const isConnectedHere = voice.connectedChannelId === channel.id
  const isConnectedElsewhere = voice.connectedChannelId !== null && !isConnectedHere

  async function handleSwitchHere() {
    voice.leave()
    await voice.join(channel.id, serverId)
  }

  const screenShares: { key: string; name: string; stream: MediaStream; isLocal: boolean }[] = []
  if (voice.screenSharing && voice.localScreenStream && profile) {
    screenShares.push({
      key: 'local',
      name: profile.display_name || profile.username,
      stream: voice.localScreenStream,
      isLocal: true,
    })
  }
  Object.entries(voice.participants).forEach(([userId, data]) => {
    if (data.screenStream) {
      const p = profileById[userId]
      screenShares.push({
        key: userId,
        name: p?.display_name || p?.username || 'Usuário',
        stream: data.screenStream,
        isLocal: false,
      })
    }
  })
  const hasScreenShares = screenShares.length > 0

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-discord-channels">
      <header className="h-12 px-4 flex items-center gap-2 border-b border-black/20 shadow-sm shrink-0">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-discord-text-muted">
          <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
        </svg>
        <h2 className="font-display font-semibold tracking-wide text-white">{channel.name}</h2>
        {isConnectedHere && (
          <span className="text-xs text-discord-text-muted">
            {Object.keys(voice.participants).length + 1}/{voice.maxParticipants} conectados
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setShowInvite(true)}
          className="text-xs px-3 py-1.5 rounded bg-discord-blurple text-white font-medium hover:opacity-90 transition-colors flex items-center gap-1.5 shrink-0"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M15 12a5 5 0 1 0-4.9-6H9a1 1 0 1 0 0 2h1.1c.1.4.2.7.4 1H9a1 1 0 1 0 0 2h2.5c.9.6 2 1 3.2 1zM3 20a6 6 0 0 1 6-6h1a6 6 0 0 1 6 6 1 1 0 1 1-2 0 4 4 0 0 0-4-4H9a4 4 0 0 0-4 4 1 1 0 1 1-2 0zm16-2v-2h-2v-2h2v-2h2v2h2v2h-2v2h-2z" />
          </svg>
          Chamar amigos
        </button>
      </header>

      {isConnectedElsewhere ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <div className="w-16 h-16 rounded-full bg-discord-lighter flex items-center justify-center mb-4">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-discord-text-muted">
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
            </svg>
          </div>
          <h3 className="font-display text-xl font-bold text-white tracking-wide">{channel.name}</h3>
          <p className="text-discord-text-muted mt-1 max-w-sm">
            Você já está conectado em outro canal de voz. Quer trocar pra este?
          </p>
          <button
            onClick={handleSwitchHere}
            disabled={voice.connecting}
            className="mt-4 px-5 py-2.5 rounded bg-discord-blurple text-white font-medium hover:opacity-90 transition-colors disabled:opacity-60"
          >
            {voice.connecting ? 'Trocando...' : 'Trocar de canal'}
          </button>
        </div>
      ) : !isConnectedHere ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <div className="w-16 h-16 rounded-full bg-discord-lighter flex items-center justify-center mb-4">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-discord-text-muted">
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V22a1 1 0 1 0 2 0v-2.06A9 9 0 0 0 21 11a1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
            </svg>
          </div>
          <h3 className="font-display text-xl font-bold text-white tracking-wide">{channel.name}</h3>
          <p className="text-discord-text-muted mt-1 max-w-sm">
            Ninguém está no canal de voz ainda. Entre pra começar uma chamada.
          </p>
          {voice.error && <p className="text-sm text-red-400 mt-3">{voice.error}</p>}
          <button
            onClick={() => voice.join(channel.id, serverId)}
            disabled={voice.connecting}
            className="mt-4 px-5 py-2.5 rounded bg-discord-green text-white font-medium hover:brightness-110 transition-colors disabled:opacity-60"
          >
            {voice.connecting ? 'Conectando...' : 'Entrar no canal de voz'}
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col">
            {hasScreenShares && <ScreenShareStage shares={screenShares} />}

            {hasScreenShares ? (
              // Com tela(s) compartilhada(s) em foco, os participantes viram
              // uma tira compacta embaixo do palco em vez do grid grande.
              <div className="flex flex-wrap gap-3 justify-center pt-1">
                {profile && (
                  <ParticipantTile
                    userId={profile.id}
                    name={profile.display_name || profile.username}
                    avatarUrl={profile.avatar_url}
                    data={undefined}
                    isLocal
                    localVideoEnabled={voice.videoEnabled}
                    compact
                  />
                )}
                {Object.entries(voice.participants).map(([userId, data]) => {
                  const p = profileById[userId]
                  return (
                    <ParticipantTile
                      key={userId}
                      userId={userId}
                      name={p?.display_name || p?.username || 'Usuário'}
                      avatarUrl={p?.avatar_url}
                      data={data}
                      isLocal={false}
                      sinkId={voice.audioSettings.speakerId}
                      compact
                    />
                  )
                })}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {profile && (
                  <ParticipantTile
                    userId={profile.id}
                    name={profile.display_name || profile.username}
                    avatarUrl={profile.avatar_url}
                    data={undefined}
                    isLocal
                    localVideoEnabled={voice.videoEnabled}
                  />
                )}
                {Object.entries(voice.participants).map(([userId, data]) => {
                  const p = profileById[userId]
                  return (
                    <ParticipantTile
                      key={userId}
                      userId={userId}
                      name={p?.display_name || p?.username || 'Usuário'}
                      avatarUrl={p?.avatar_url}
                      data={data}
                      isLocal={false}
                      sinkId={voice.audioSettings.speakerId}
                    />
                  )
                })}
              </div>
            )}
          </div>

          <div className="px-4 pb-6 shrink-0 flex flex-wrap items-center justify-center gap-3">
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

      {showInvite && (
        <InviteFriendsModal
          serverId={serverId}
          channelId={channel.id}
          channelName={channel.name}
          onClose={() => setShowInvite(false)}
        />
      )}
    </section>
  )
}
