import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Se inscreve no MESMO canal Realtime que useVoiceChannel usa pra
// sinalização (voice:{channelId}), mas só pra observar a presença —
// nunca chama .track() nem pega microfone. Assim dá pra mostrar quem
// está numa sala de voz sem precisar entrar nela.
//
// "skip" existe pra evitar uma inscrição duplicada no MESMO canal que
// você já está conectado de verdade (via VoiceContext) — o Supabase
// reaproveita a conexão existente por tópico, e tentar adicionar mais
// escutas de presença numa conexão que já chamou subscribe() quebra
// com "cannot add callbacks after subscribe()".
export function useVoicePresence(channelId: string | null, skip = false) {
  const [userIds, setUserIds] = useState<string[]>([])

  useEffect(() => {
    if (!channelId || skip) {
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
  }, [channelId, skip])

  return userIds
}
