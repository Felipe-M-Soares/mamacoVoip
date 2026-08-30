import { forwardRef, useEffect, useRef } from 'react'

// VideoTile/RemoteAudio moram nesse arquivo próprio (em vez de dentro
// de VoiceChannelView.tsx, onde viveram originalmente) porque
// VoiceChannelView.tsx é carregado sob demanda (lazy, só quando
// alguém entra num canal de voz de SERVIDOR — ver o import()
// dinâmico em MainLayout.tsx) e é um arquivo grande. DMCallOverlay.tsx
// (a barra de chamada de DM/grupo) fica montada globalmente o tempo
// todo, então se ela importasse esses dois componentes direto de
// VoiceChannelView.tsx, isso puxaria o arquivo inteiro pro bundle
// principal, cancelando o efeito do lazy loading — daí o
// compartilhado ficar isolado aqui, um arquivo pequeno que os dois
// lados podem importar sem esse efeito colateral.
export const VideoTile = forwardRef<HTMLVideoElement, { stream: MediaStream; sinkId?: string | null; fit?: 'cover' | 'contain' }>(
  function VideoTile({ stream, sinkId, fit = 'cover' }, forwardedRef) {
    const localRef = useRef<HTMLVideoElement>(null)
    useEffect(() => {
      if (localRef.current) localRef.current.srcObject = stream
    }, [stream])
    useEffect(() => {
      const el = localRef.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null
      if (el && sinkId && el.setSinkId) el.setSinkId(sinkId).catch(() => {})
    }, [sinkId])
    // Sempre mudo — o áudio de participantes remotos toca via <RemoteAudio>,
    // que aplica o volume individual. Tocar os dois ao mesmo tempo dava
    // áudio duplicado sempre que alguém ligava a câmera.
    return (
      <video
        ref={(node) => {
          localRef.current = node
          if (typeof forwardedRef === 'function') forwardedRef(node)
          else if (forwardedRef) forwardedRef.current = node
        }}
        autoPlay
        playsInline
        muted
        className={`w-full h-full rounded-lg bg-black ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
      />
    )
  }
)

// BUG REAL — provável causa de "gente que tá junto na call não se
// ouve", principalmente em salas com mais gente: esta função criava um
// `new AudioContext()" TODA VEZ que um <RemoteAudio> montava, ou seja,
// UM CONTEXTO INTEIRO POR PARTICIPANTE remoto na tela (cada
// AudioContext abre sua própria linha com o driver de áudio do
// sistema). Em TODO o resto do app (analisador de nível em
// VoiceContext.tsx, redutor de ruído do microfone e da transmissão em
// noiseSuppression.ts) só existe UM AudioContext, reaproveitado —
// esta era a única exceção. Alguns sistemas/versões de Chromium
// degradam ou simplesmente param de processar áudio depois de um
// punhado de contextos simultâneos abertos na mesma aba/janela — em
// uma call com só 4-5 pessoas com vídeo/áudio ligados, isso já soma
// vários contextos (1 por tile, mais os já existentes pro microfone e
// pro medidor de nível), sem nenhum aviso ou erro visível: o áudio
// remoto simplesmente para de tocar pra quem entrou por último (os
// contextos mais recentes, geralmente os primeiros a serem
// sufocados). A correção reaproveita um ÚNICO AudioContext
// compartilhado entre todos os <RemoteAudio> montados ao mesmo tempo
// (getSharedRemoteAudioContext logo abaixo) — cada instância só cria
// seus PRÓPRIOS nós (source/gain) dentro dele e os desconecta ao
// desmontar, sem nunca fechar o contexto em si (outras instâncias
// podem continuar precisando dele).
//
// DÉCIMA OITAVA RODADA: "qualidade tá boa mas o volume dos participantes
// tá baixo" — o problema real é que `<audio>.volume` só ATENUA (trava
// em 1.0/100%, o próprio elemento recusa qualquer valor acima disso), e
// não existe jeito de REFORÇAR além do nível que a pessoa do outro lado
// mandou (mic longe da boca, captação fraca do hardware dela, etc.). A
// correção monta um grafo de Web Audio (fonte da stream → GainNode →
// destino) igual o padrão já usado pro microfone/áudio de tela (ver
// noiseSuppression.ts) — um GainNode aceita ganho acima de 1.0 de
// verdade, então agora dá pra reforçar até 200% (ver o novo teto do
// slider de volume por participante em setParticipantVolume, em
// VoiceContext.tsx), não só atenuar. O elemento <audio> passa a tocar a
// stream JÁ processada pelo GainNode (sempre a 100% nele mesmo — quem
// manda no volume de verdade agora é o gain.value).
let sharedRemoteAudioContext: AudioContext | null = null
function getSharedRemoteAudioContext(): AudioContext {
  if (!sharedRemoteAudioContext || sharedRemoteAudioContext.state === 'closed') {
    sharedRemoteAudioContext = new AudioContext()
  }
  return sharedRemoteAudioContext
}

export function RemoteAudio({ stream, sinkId, volume }: { stream: MediaStream; sinkId?: string | null; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)

  useEffect(() => {
    try {
      const ctx = getSharedRemoteAudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const gain = ctx.createGain()
      const destination = ctx.createMediaStreamDestination()
      source.connect(gain)
      gain.connect(destination)
      // Política de autoplay do Chromium pode nascer o contexto
      // "suspended" em algum caso de borda — sem isso, ficaria mudo até
      // algum outro gesto acordar ele sozinho.
      void ctx.resume().catch(() => {})
      audioContextRef.current = ctx
      sourceNodeRef.current = source
      gainNodeRef.current = gain
      if (ref.current) {
        ref.current.srcObject = destination.stream
        ref.current.volume = 1
      }
    } catch {
      // Navegador sem suporte a Web Audio (bem raro) — degrada pro jeito
      // antigo: toca a stream direto, sem reforço além de 100% (só
      // atenuação, ver o outro efeito abaixo).
      audioContextRef.current = null
      gainNodeRef.current = null
      sourceNodeRef.current = null
      if (ref.current) ref.current.srcObject = stream
    }
    return () => {
      try {
        sourceNodeRef.current?.disconnect()
      } catch {
        // já desconectado — sem problema
      }
      try {
        gainNodeRef.current?.disconnect()
      } catch {
        // já desconectado — sem problema
      }
      // NÃO fecha o AudioContext aqui — ele é COMPARTILHADO entre
      // todos os <RemoteAudio> montados (ver getSharedRemoteAudioContext
      // acima); fechar ao desmontar UM participante silenciaria todos
      // os outros que ainda estão na tela.
      audioContextRef.current = null
      gainNodeRef.current = null
      sourceNodeRef.current = null
    }
  }, [stream])
  useEffect(() => {
    const el = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (el && sinkId && el.setSinkId) el.setSinkId(sinkId).catch(() => {})
  }, [sinkId])
  useEffect(() => {
    // Até 200% (2.0) via GainNode; se o Web Audio falhou ao montar (ver
    // acima), só sobra o fallback do próprio elemento — que continua
    // travado em 100%, sem reforço, mas sem quebrar a call por isso.
    const clamped = Math.max(0, Math.min(2, volume))
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = clamped
    } else if (ref.current) {
      ref.current.volume = Math.max(0, Math.min(1, clamped))
    }
  }, [volume])
  return <audio ref={ref} autoPlay />
}
