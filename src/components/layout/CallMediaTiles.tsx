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

export function RemoteAudio({ stream, sinkId, volume }: { stream: MediaStream; sinkId?: string | null; volume: number }) {
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
