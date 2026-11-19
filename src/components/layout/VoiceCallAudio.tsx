import { useVoiceCore } from '../../hooks/useVoice'
import { useEffect } from 'react'
import { RemoteAudio } from './CallMediaTiles'
import { resetStreamView, syncActiveStreams, useStreamView } from '../../lib/streamView'

export function VoiceCallAudio() {
  const voice = useVoiceCore()
  const { hidden } = useStreamView()
  const connected = Boolean(voice.connectedChannelId)

  useEffect(() => {
    if (!connected) resetStreamView()
  }, [connected])

  const sharingKeys = Object.entries(voice.participants)
    .filter(([, d]) => d.screenStream)
    .map(([id]) => id)
    .sort()
    .join(',')
  useEffect(() => {
    if (!connected) return
    const active = new Set(sharingKeys ? sharingKeys.split(',') : [])
    if (voice.screenSharing) active.add('local')
    syncActiveStreams(active, Boolean(voice.connectedServerId))
  }, [connected, sharingKeys, voice.screenSharing, voice.connectedServerId])

  if (!connected) return null

  const sinkId = voice.audioSettings.speakerId
  const master = voice.deafened ? 0 : voice.masterVolume / 100

  return (
    <>
      {Object.entries(voice.participants).map(([userId, data]) => {
        if (!data.micAudioStream) return null
        const effectiveVolume = master * (voice.getParticipantVolume(userId) / 100)
        return <RemoteAudio key={`mic-${userId}`} stream={data.micAudioStream} sinkId={sinkId} volume={effectiveVolume} />
      })}
      {Object.entries(voice.participants).map(([userId, data]) => {
        if (!data.screenAudioStream || hidden.has(userId)) return null
        const effectiveVolume = master * (voice.getScreenShareVolume(userId) / 100)
        return <RemoteAudio key={`screen-${userId}`} stream={data.screenAudioStream} sinkId={sinkId} volume={effectiveVolume} />
      })}
    </>
  )
}
