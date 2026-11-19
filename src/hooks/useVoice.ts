import { useContext } from 'react'
import { VoiceContext } from '../context/VoiceContext'
import { VoiceCoreContext } from '../context/voiceSplit'

export {
  useVoiceSpeaking,
  useVoiceSpeakingKey,
  useVoiceConnectionQuality,
  useLocalVoiceConnectionQuality,
  type VoiceCoreValue,
  type VoiceParticipantInfo,
} from '../context/voiceSplit'

export function useVoice() {
  const ctx = useContext(VoiceContext)
  if (!ctx) throw new Error('useVoice precisa ser usado dentro de um VoiceProvider')
  return ctx
}

export function useVoiceCore() {
  const ctx = useContext(VoiceCoreContext)
  if (!ctx) throw new Error('useVoiceCore precisa ser usado dentro de um VoiceProvider')
  return ctx
}
