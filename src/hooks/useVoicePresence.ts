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
//
// BUG REAL (era isto que derrubava o app inteiro ao SAIR de uma call):
// "skip" vira false na hora, de forma síncrona, assim que você chama
// leave() (connectedChannelId zera de imediato — de propósito, pra UI
// reagir na hora). Só que o desligamento de VERDADE do canal Realtime
// da chamada (untrack() + removeChannel(), em leave() no VoiceContext)
// roda em segundo plano e leva pelo menos uma ida-e-volta ao servidor.
// Nessa janela — que dura só uma fração de segundo, mas sempre existe —
// o Supabase ainda tem o canal antigo (já com subscribe() chamado)
// registrado sob o mesmo tópico "voice:{channelId}". Se este hook tenta
// se inscrever bem nesse instante, `supabase.channel(topic)` devolve
// esse MESMO objeto reaproveitado (é assim que o cliente Realtime
// funciona, ver RealtimeClient.channel() dentro de
// @supabase/realtime-js), e chamar `.on('presence', ...)` nele explode
// com a exceção. Como isso acontece dentro de um efeito, sem try/catch,
// a exceção sobe até o ErrorBoundary lá no topo do app (App.tsx) — que
// fica ACIMA do VoiceProvider inteiro — e derruba a árvore de
// componentes INTEIRA (não só a barra lateral), forçando quem estava na
// call a recarregar o app manualmente bem no momento em que sai dela.
//
// Correção: antes de criar/inscrever um canal observador, checa se já
// existe um canal (nosso ou de uma conexão de verdade ainda
// desligando) registrado sob o mesmo tópico e ainda não fechado. Se
// existir, espera um pouco e tenta de novo em vez de arriscar a
// exceção — a janela real costuma fechar em bem menos de um segundo.
export function useVoicePresence(channelId: string | null, skip = false) {
  const [userIds, setUserIds] = useState<string[]>([])

  useEffect(() => {
    if (!channelId || skip) {
      setUserIds([])
      return
    }

    let cancelled = false
    let activeChannel: ReturnType<typeof supabase.channel> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const topic = `voice:${channelId}`

    const trySubscribe = () => {
      if (cancelled) return

      // `realtime:` é o prefixo interno que o cliente usa pra guardar o
      // tópico (ver RealtimeClient.channel()) — comparamos com ele pra
      // achar exatamente o mesmo canal que `supabase.channel(topic)`
      // reaproveitaria aqui embaixo.
      const existing = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
      if (existing && existing.state !== 'closed' && existing.state !== 'errored') {
        retryTimer = setTimeout(trySubscribe, 250)
        return
      }

      const rt = supabase.channel(topic, {
        config: { presence: { key: `observer-${Math.random().toString(36).slice(2)}` } },
      })
      activeChannel = rt

      try {
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
      } catch {
        // Corrida perdida mesmo com a checagem acima (ex.: outra aba/
        // instância reaproveitou o tópico entre a checagem e agora) —
        // não deixa a exceção subir e derrubar o app; só tenta de novo.
        supabase.removeChannel(rt)
        activeChannel = null
        retryTimer = setTimeout(trySubscribe, 250)
      }
    }

    trySubscribe()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (activeChannel) supabase.removeChannel(activeChannel)
    }
  }, [channelId, skip])

  return userIds
}
