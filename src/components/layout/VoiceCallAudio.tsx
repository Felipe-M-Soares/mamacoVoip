import { useVoiceCore } from '../../hooks/useVoice'
import { useEffect } from 'react'
import { RemoteAudio } from './CallMediaTiles'
import { resetStreamView, syncActiveStreams, useStreamView } from '../../lib/streamView'

// TRIGÉSIMA NONA RODADA — bug relatado: navegar pra OUTRO canal (só
// pra olhar, sem sair da call) parava o áudio da chamada inteiro — voz
// dos outros e som da transmissão de tela — voltando só quando
// clicava de novo no canal em que estava conectado de verdade.
//
// Causa: os <RemoteAudio> que tocam esse áudio (ver CallMediaTiles.tsx)
// viviam DENTRO de VoiceChannelView.tsx — componente montado só
// enquanto você está OLHANDO aquele canal especificamente
// (`activeChannel`/`ActiveServerBody` em MainLayout.tsx, carregado sob
// demanda). Navegar pra outro canal (de voz ou de texto) TROCA qual
// componente está montado ali — desmontando VoiceChannelView do canal
// conectado (e os elementos <audio> dentro dele) mesmo com a conexão
// de voz de verdade (`voice.connectedChannelId`, a sala do LiveKit)
// continuando ativa por baixo, sem ninguém ter pedido pra sair dela.
//
// Este componente existe FORA desse ciclo de vida: fica montado o
// tempo todo (ver MainLayout.tsx, ao lado de DMCallOverlay/
// OverlayStateSync, que já seguem esse mesmo padrão de "sempre
// montado"), então o áudio só realmente para quando a CALL em si
// termina (voice.leave()) ou uma transmissão específica é encerrada de
// verdade — nunca só por trocar de tela. VoiceChannelView.tsx continua
// existindo só pra parte VISUAL (vídeo, botões, sliders) — não toca
// mais áudio nenhum sozinho, pra não duplicar o som enquanto a pessoa
// está de fato olhando o canal conectado.
//
// AUDITORIA DE VOZ — este componente passou a tocar o áudio de TODA call,
// inclusive DM/grupo. Antes, DM/grupo tocava o áudio de dentro dos tiles
// do DMCallOverlay.tsx, o que tinha três bugs: (1) minimizar a barra da
// chamada DESMONTAVA os tiles e cortava o áudio de todo mundo; (2) o
// volume era fixo em 100% — "Ensurdecer" (que zera o volume geral) e o
// volume por pessoa não tinham efeito nenhum em DM; (3) o áudio da
// transmissão de tela de quem estava na DM nunca tocava.
//
// Também usa as streams SÓ-ÁUDIO (micAudioStream/screenAudioStream, ver
// recomputeParticipant em VoiceContext.tsx) em vez de cameraStream/
// screenStream: essas mudam de identidade quando a pessoa liga/desliga a
// câmera (ou a transmissão troca de vídeo), e cada troca recriava o
// gráfico de áudio — um "clique"/corte na voz toda vez que alguém ligava
// a câmera. E o áudio da tela agora respeita o alto-falante escolhido
// (antes só a voz usava `sinkId`; o som da transmissão ia sempre pro
// dispositivo padrão do sistema).
//
// Transmissões FECHADAS por você (lib/streamView) não tocam som — antes o
// áudio de uma transmissão fechada continuava por cima da que você estava
// assistindo. "Desativar áudio" (ensurdecer) zera tudo aqui, sem mexer no
// volume geral salvo.
export function VoiceCallAudio() {
  const voice = useVoiceCore()
  const { hidden } = useStreamView()
  const connected = Boolean(voice.connectedChannelId)

  // Saiu da call: esquece quais transmissões estavam fechadas/em destaque.
  useEffect(() => {
    if (!connected) resetStreamView()
  }, [connected])

  // Transmissões novas de outras pessoas começam fechadas (só baixa quem
  // clicar em "Assistir"); quem parou de transmitir sai da lista.
  const sharingKeys = Object.entries(voice.participants)
    .filter(([, d]) => d.screenStream)
    .map(([id]) => id)
    .sort()
    .join(',')
  useEffect(() => {
    if (!connected) return
    const active = new Set(sharingKeys ? sharingKeys.split(',') : [])
    if (voice.screenSharing) active.add('local')
    // Só em sala de servidor (que tem a tela pra assistir/fechar). Em
    // chamada privada continua tocando como antes.
    syncActiveStreams(active, Boolean(voice.connectedServerId))
  }, [connected, sharingKeys, voice.screenSharing, voice.connectedServerId])

  if (!connected) return null

  const sinkId = voice.audioSettings.speakerId
  const master = voice.deafened ? 0 : voice.masterVolume / 100

  return (
    <>
      {Object.entries(voice.participants).map(([userId, data]) => {
        if (!data.micAudioStream) return null
        const effectiveVolume = master * (voice.getParticipantVolume(userId) / 100)
        return <RemoteAudio key={`mic-${userId}`} stream={data.micAudioStream} sinkId={sinkId} volume={effectiveVolume} />
      })}
      {Object.entries(voice.participants).map(([userId, data]) => {
        if (!data.screenAudioStream || hidden.has(userId)) return null
        const effectiveVolume = master * (voice.getScreenShareVolume(userId) / 100)
        return <RemoteAudio key={`screen-${userId}`} stream={data.screenAudioStream} sinkId={sinkId} volume={effectiveVolume} />
      })}
    </>
  )
}
