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
export function RemoteAudio({ stream, sinkId, volume }: { stream: MediaStream; sinkId?: string | null; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)

  useEffect(() => {
    try {
      const ctx = new AudioContext()
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
      const ctx = audioContextRef.current
      audioContextRef.current = null
      gainNodeRef.current = null
      sourceNodeRef.current = null
      if (ctx) ctx.close().catch(() => {})
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
