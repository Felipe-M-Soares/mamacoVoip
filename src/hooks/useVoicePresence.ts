import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Se inscreve no MESMO canal Realtime que useVoiceChannel usa pra
// sinalização (voice:{channelId}), mas só pra observar a presença —
// nunca chama .track() nem pega microfone. Assim dá pra mostrar quem
// está numa sala de voz sem precisar entrar nela.
export function useVoicePresence(channelId: string | null) {
  const [userIds, setUserIds] = useState<string[]>([])

  useEffect(() => {
    if (!channelId) {
      setUserIds([])
      return
    }

    const rt = supabase.channel(`voice:${channelId}`, {
      config: { presence: { key: `observer-${Math.random().toString(36).slice(2)}` } },
    })

    rt.on('presence', { event: 'sync' }, () => {
      const state = rt.presenceState()
      // cada chave de presença que representa um participante real usa
      // o próprio user_id como key (veja join() em VoiceContext) — as
      // chaves "observer-..." como a nossa não devem contar como gente
      // na sala, então filtramos pelo formato esperado (uuid)
      const ids = Object.keys(state).filter((key) => !key.startsWith('observer-'))
      setUserIds(ids)
    })

    rt.subscribe()

    return () => {
      supabase.removeChannel(rt)
    }
  }, [channelId])

  return userIds
}
