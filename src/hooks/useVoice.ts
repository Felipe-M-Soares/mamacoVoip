import { useContext } from 'react'
import { VoiceContext } from '../context/VoiceContext'
import { VoiceCoreContext } from '../context/voiceSplit'

export {
  useVoiceSpeaking,
  useVoiceConnectionQuality,
  useLocalVoiceConnectionQuality,
  type VoiceCoreValue,
  type VoiceParticipantInfo,
} from '../context/voiceSplit'

/**
 * Valor COMPLETO da voz, incluindo os estados que mudam várias vezes por
 * segundo numa call (quem está falando, qualidade de conexão). Quem usa
 * isto re-renderiza a cada uma dessas mudanças — prefira `useVoiceCore()`
 * + os hooks de atividade (`useVoiceSpeaking` etc.) quando possível.
 */
export function useVoice() {
  const ctx = useContext(VoiceContext)
  if (!ctx) throw new Error('useVoice precisa ser usado dentro de um VoiceProvider')
  return ctx
}

/**
 * Tudo de useVoice() MENOS os estados de alta frequência (`speaking`,
 * `connectionQuality`, `localConnectionQuality` e o `speaking` de cada
 * participante). Não re-renderiza quando alguém começa/para de falar.
 */
export function useVoiceCore() {
  const ctx = useContext(VoiceCoreContext)
  if (!ctx) throw new Error('useVoiceCore precisa ser usado dentro de um VoiceProvider')
  return ctx
}
