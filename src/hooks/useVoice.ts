import { useContext } from 'react'
import { VoiceContext } from '../context/VoiceContext'

export function useVoice() {
  const ctx = useContext(VoiceContext)
  if (!ctx) throw new Error('useVoice precisa ser usado dentro de um VoiceProvider')
  return ctx
}
