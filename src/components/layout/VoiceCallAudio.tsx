import { useVoice } from '../../hooks/useVoice'
import { RemoteAudio } from './CallMediaTiles'

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
export function VoiceCallAudio() {
  const voice = useVoice()

  // Chamada de DM/grupo já tem seu próprio áudio sempre-montado (ver
  // DMCallOverlay.tsx, que segue exatamente esse mesmo padrão) — aqui
  // cuida só de canal de voz DE SERVIDOR (connectedServerId != null),
  // pra não tocar a mesma stream duas vezes ao mesmo tempo.
  if (!voice.connectedChannelId || !voice.connectedServerId) return null

  const sinkId = voice.audioSettings.speakerId

  return (
    <>
      {Object.entries(voice.participants).map(([userId, data]) => {
        if (!data.cameraStream) return null
        const participantVolume = voice.getParticipantVolume(userId)
        const effectiveVolume = (voice.masterVolume / 100) * (participantVolume / 100)
        return <RemoteAudio key={`mic-${userId}`} stream={data.cameraStream} sinkId={sinkId} volume={effectiveVolume} />
      })}
      {Object.entries(voice.participants).map(([userId, data]) => {
        if (!data.screenStream || data.screenStream.getAudioTracks().length === 0) return null
        const shareVolume = voice.getScreenShareVolume(userId)
        const effectiveVolume = (voice.masterVolume / 100) * (shareVolume / 100)
        return <RemoteAudio key={`screen-${userId}`} stream={data.screenStream} volume={effectiveVolume} />
      })}
    </>
  )
}
