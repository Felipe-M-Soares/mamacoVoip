import { forwardRef, useEffect, useRef } from 'react'

// Aplica o alto-falante escolhido. Sem escolha (null) = padrão do sistema
// ('' — antes não chamava nada, então voltar pro "Padrão" no meio da
// call não fazia efeito). Reaplica quando um fone é conectado/desconectado
// (se o escolhido sumiu, toca no padrão; se voltou, volta pra ele).
function useSinkId(ref: { current: HTMLMediaElement | null }, sinkId: string | null | undefined) {
  useEffect(() => {
    const apply = () => {
      const el = ref.current as (HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }) | null
      if (!el?.setSinkId) return
      el.setSinkId(sinkId ?? '').catch(() => {
        el.setSinkId?.('').catch(() => {})
      })
    }
    apply()
    navigator.mediaDevices?.addEventListener?.('devicechange', apply)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', apply)
  }, [ref, sinkId])
}

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
export const VideoTile = forwardRef<HTMLVideoElement, { stream: MediaStream; sinkId?: string | null; fit?: 'cover' | 'contain'; mirror?: boolean }>(
  function VideoTile({ stream, sinkId, fit = 'cover', mirror = false }, forwardedRef) {
    const localRef = useRef<HTMLVideoElement>(null)
    useEffect(() => {
      const el = localRef.current
      if (!el) return
      // Só o VÍDEO vai pro elemento: o som toca sempre pelo <RemoteAudio>
      // (com o volume do app). Se a stream chegasse com áudio, os controles
      // nativos da tela cheia podiam "desmutar" o elemento e tocar o som
      // por fora — aí o mudo/volume do app paravam de funcionar.
      const videoOnly = new MediaStream(stream.getVideoTracks())
      const sync = () => {
        const tracks = stream.getVideoTracks()
        if (tracks.length !== videoOnly.getVideoTracks().length || tracks.some((t) => !videoOnly.getTrackById(t.id))) {
          for (const t of videoOnly.getVideoTracks()) videoOnly.removeTrack(t)
          for (const t of tracks) videoOnly.addTrack(t)
        }
      }
      stream.addEventListener('addtrack', sync)
      stream.addEventListener('removetrack', sync)
      el.srcObject = videoOnly
      el.muted = true
      const keepMuted = () => {
        if (!el.muted) el.muted = true
      }
      el.addEventListener('volumechange', keepMuted)
      return () => {
        stream.removeEventListener('addtrack', sync)
        stream.removeEventListener('removetrack', sync)
        el.removeEventListener('volumechange', keepMuted)
      }
    }, [stream])
    useSinkId(localRef, sinkId)
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
        className={`w-full h-full rounded-[inherit] bg-black ${fit === 'contain' ? 'object-contain' : 'object-cover'} ${mirror ? '-scale-x-100' : ''}`}
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
export function getSharedRemoteAudioContext(): AudioContext {
  if (!sharedRemoteAudioContext || sharedRemoteAudioContext.state === 'closed') {
    sharedRemoteAudioContext = new AudioContext({ latencyHint: 'interactive' })
  }
  return sharedRemoteAudioContext
}

// Quantos <RemoteAudio> estão usando o contexto compartilhado agora.
// Quando chega a zero (fim da call), o contexto é SUSPENSO — antes ele
// ficava rodando pra sempre depois da primeira call, mantendo a thread
// de áudio e o dispositivo de saída ativos à toa (CPU/bateria).
let sharedRemoteAudioUsers = 0
let suspendTimer: ReturnType<typeof setTimeout> | null = null
function retainSharedRemoteAudioContext() {
  sharedRemoteAudioUsers++
  if (suspendTimer) {
    clearTimeout(suspendTimer)
    suspendTimer = null
  }
}
function releaseSharedRemoteAudioContext() {
  sharedRemoteAudioUsers = Math.max(0, sharedRemoteAudioUsers - 1)
  if (sharedRemoteAudioUsers > 0 || suspendTimer) return
  // Pequena espera: numa troca de stream (desmonta e monta de novo no
  // mesmo instante) não vale suspender e acordar o contexto.
  suspendTimer = setTimeout(() => {
    suspendTimer = null
    if (sharedRemoteAudioUsers === 0 && sharedRemoteAudioContext?.state === 'running') {
      sharedRemoteAudioContext.suspend().catch(() => {})
    }
  }, 2000)
}

export function RemoteAudio({ stream, sinkId, volume }: { stream: MediaStream; sinkId?: string | null; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const volumeRef = useRef(volume)
  volumeRef.current = volume

  useEffect(() => {
    // Stream sem nenhuma track de áudio (ex.: só câmera) — nada pra
    // tocar. Antes, createMediaStreamSource() lançava InvalidStateError
    // nesse caso e caía no fallback, que tocava a stream "crua" direto.
    if (stream.getAudioTracks().length === 0) {
      if (ref.current) ref.current.srcObject = null
      return
    }
    // Contorno de um bug antigo e conhecido do Chromium (crbug 933677):
    // uma MediaStream REMOTA do WebRTC ligada só no Web Audio (via
    // createMediaStreamSource) pode sair MUDA se ela não estiver também
    // tocando em algum elemento de mídia. Um <audio> mudo, fora do DOM,
    // "segura" o fluxo de áudio ativo sem tocar nada de verdade (quem
    // toca é o elemento abaixo, com o áudio já passando pelo GainNode).
    const keepAlive = new Audio()
    keepAlive.muted = true
    keepAlive.srcObject = stream
    keepAlive.play().catch(() => {})
    let retained = false
    try {
      const ctx = getSharedRemoteAudioContext()
      retainSharedRemoteAudioContext()
      retained = true
      const source = ctx.createMediaStreamSource(stream)
      const gain = ctx.createGain()
      // Nivelador: segura quem fala muito alto (ou um jogo estourado na
      // transmissão) e evita distorção quando o volume passa de 100%.
      // Quem fala baixo passa intacto.
      const leveler = ctx.createDynamicsCompressor()
      leveler.threshold.value = -20
      leveler.knee.value = 12
      leveler.ratio.value = 4
      leveler.attack.value = 0.004
      leveler.release.value = 0.25
      const destination = ctx.createMediaStreamDestination()
      source.connect(gain)
      gain.connect(leveler)
      leveler.connect(destination)
      // Política de autoplay do Chromium pode nascer o contexto
      // "suspended" em algum caso de borda — sem isso, ficaria mudo até
      // algum outro gesto acordar ele sozinho.
      void ctx.resume().catch(() => {})
      audioContextRef.current = ctx
      sourceNodeRef.current = source
      gainNodeRef.current = gain
      // Aplica o volume atual JÁ na criação — antes o GainNode nascia em
      // 1.0 e só recebia o volume certo se `volume` mudasse depois (o
      // efeito de volume abaixo roda antes deste na troca de stream),
      // então uma pessoa com volume em 0% (ou "ensurdecido") voltava a
      // ser ouvida a 100% toda vez que a stream dela era recriada.
      gain.gain.value = Math.max(0, Math.min(2, volumeRef.current))
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
      if (ref.current) {
        ref.current.srcObject = stream
        ref.current.volume = Math.max(0, Math.min(1, volumeRef.current))
      }
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
      keepAlive.pause()
      keepAlive.srcObject = null
      if (retained) releaseSharedRemoteAudioContext()
      // NÃO fecha o AudioContext aqui — ele é COMPARTILHADO entre
      // todos os <RemoteAudio> montados (ver getSharedRemoteAudioContext
      // acima); fechar ao desmontar UM participante silenciaria todos
      // os outros que ainda estão na tela.
      audioContextRef.current = null
      gainNodeRef.current = null
      sourceNodeRef.current = null
    }
  }, [stream])
  useSinkId(ref, sinkId)
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
