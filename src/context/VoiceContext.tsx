import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  ConnectionQuality as LiveKitConnectionQuality,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type LocalAudioTrack,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client'
import { supabase } from '../lib/supabase'
import { takeLiveKitToken, prewarmLiveKitConnection, rememberLiveKitUrl, setActiveVoiceRoom } from '../lib/livekit'
import { useAuth } from '../hooks/useAuth'
import { useAudioSettings } from '../hooks/useAudioSettings'
import {
  useScreenShareQuality,
  contentHintForPreset,
  resolveScreenSharePreset,
  exceedsH264FrameLimits,
  fitWithin,
  SAFE_MAX_CAPTURE_HEIGHT,
  SAFE_MAX_CAPTURE_WIDTH,
  type QualityPreset,
} from '../hooks/useScreenShareQuality'
import {
  createNoiseSuppressor,
  type NoiseSuppressor,
  createScreenAudioDenoiser,
  type ScreenAudioDenoiser,
  createAutoSensitivity,
  AUTO_SENSITIVITY_TICK_MS,
  DEFAULT_MIC_SENSITIVITY,
} from '../lib/noiseSuppression'
import { chooseScreenCodec, markCodecSoftwareOnly, probeHardwareEncoders, resetHardwareProbe, type ScreenCodec } from '../lib/hwEncode'
import { computeScreenShareStats, pickOutboundVideo, type OutboundVideoSample } from '../lib/screenShareStats'
import { peekPendingGameShareHint, takePendingGameShareHint } from '../lib/screenShareGameHint'
import { takePendingAppAudioPid } from '../lib/pendingAppAudioCapture'
import { openScreenSharePicker } from '../lib/screenSharePickerBridge'
import { armScreenShareChoice } from '../lib/chooseScreenShareSource'
import { PcmStreamPlayer } from '../lib/pcmStreamPlayer'
import { isAllowedSoundboardUrl } from '../lib/soundboardUrl'
import { ensureRealtimeAuth, privateChannelParams, changesChannel } from '../lib/realtimeChannel'
import { useSplitVoiceValue, VoiceActivityContext, VoiceCoreContext } from './voiceSplit'
import {
  playConnectSound,
  playDisconnectSound,
  playMuteSound,
  playUnmuteSound,
  playDeafenSound,
  playUndeafenSound,
  playUserJoinSound,
  playUserLeaveSound,
  playStreamStartSound,
  playStreamStopSound,
} from '../lib/sounds'

// TRIGÉSIMA QUARTA RODADA — troca de motor de transmissão: o mesh manual
// de RTCPeerConnection (um por peer, sinalização própria via broadcast
// do Supabase Realtime — oferta/resposta/ICE, "aperto de mão" de
// polite/impolite peer, reconciliação manual de qual stream é tela via
// `screen-meta`) foi substituído por um SFU de verdade (LiveKit, ver
// lib/livekit.ts e o `Room` usado logo abaixo). Cada participante manda
// a própria mídia UMA vez pro servidor LiveKit, que redistribui pra
// todo mundo — antes, cada participante mandava N cópias (uma por peer
// na sala), então o upload de quem estava numa call de 6-7 pessoas já
// tinha virado o gargalo real. O LiveKit também resolve nativamente,
// sem nenhum acordo próprio, qual track é microfone/câmera/tela (ver
// Track.Source usado mais abaixo) — isso elimina de vez a reconciliação
// manual que existia aqui antes (o antigo `screen-meta`/
// `screen-meta-request`, `combineScreenStream`, `recomputeParticipant`).
//
// STUN/TURN não precisam mais ser configurados aqui — o próprio servidor
// LiveKit cuida disso (ICE/TURN do lado dele, incluso tanto no LiveKit
// Cloud quanto numa instalação própria com um TURN configurado nela).
// DÉCIMA QUARTA RODADA: log em arquivo (ver window.electronAPI.logDebug
// em electron/preload.cjs e appendDebugLog em electron/main.cjs) além do
// console.error normal — existe especificamente pra diagnóstico à
// distância de bugs no compartilhamento de tela/áudio, quando quem está
// usando o app empacotado não tem (ou não sabe que tem) acesso ao
// DevTools. Usado nos pontos que podiam falhar completamente MUDOS
// antes desta rodada (a captura de áudio por processo E a reserva de
// áudio de sistema, ambas dentro de toggleScreenShare/
// switchScreenShareSource).
function logDebug(message: string) {
  console.error(`[VoiceContext] ${message}`)
  window.electronAPI?.logDebug?.(message)
}

// TRIGÉSIMA NONA RODADA — bug relatado: em algum caso raro, entrar no
// canal ficava preso em "Conectando..." PRA SEMPRE, sem erro nenhum
// aparecer. Isso só acontece quando uma das etapas assíncronas (pedir
// mic, assinar presença, pedir token, ou o handshake com o servidor do
// LiveKit) nunca resolve E nunca rejeita — ex.: uma trava de firewall
// que deixa a conexão "pendurada" em vez de recusar na hora. Sem
// timeout nenhuma dessas trava indefinidamente e a Promise.all() de
// join() nunca sai do ar. `withTimeout` dá um prazo máximo pra
// qualquer promise: se não resolver a tempo, rejeita com uma mensagem
// clara em vez de deixar o botão preso pro resto da sessão.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tempo esgotado (${label}). Verifique sua conexão com a internet e tente de novo.`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

// Antes disso, MAX_PARTICIPANTS (8) era uma proteção real: cada pessoa
// numa call mesh manda sua própria mídia pra CADA outro peer, então o
// upload de todo mundo cresce junto com o tamanho da sala — 8 já era o
// ponto onde isso começava a doer em conexões domésticas comuns. Com o
// SFU (ver comentário grande acima), cada participante manda sua mídia
// só UMA vez, não importa quantas pessoas estejam ouvindo — o valor
// aqui virou só o teto usado pra exibição "X/Y conectados" (ver
// VoiceChannelView.tsx), bem mais generoso agora que a limitação real
// de banda do lado de quem fala deixou de existir.
const MAX_PARTICIPANTS = 50

// Bitrate do MICROFONE (voz). O Opus pra voz mono já fica praticamente
// transparente (indistinguível do original) por volta de 96-128kbps —
// subir além disso não traz nada a mais pra ouvido nenhum, só gasta
// banda à toa. 128kbps é o teto real de "não dá pra melhorar mais só
// com bitrate" pra uma voz — o resto da qualidade (o quão limpo o SINAL
// que chega até aqui está) já é function do RNNoise + gate + AEC/AGC
// nativos (ver lib/noiseSuppression.ts e useAudioSettings.ts), não de
// bitrate.
//
// AUDITORIA DE VOZ — baixado de 128kbps pra 64kbps. Opus mono em 64kbps
// já é transparente pra voz (é o preset "music" do próprio LiveKit), e
// o mic é publicado com RED (redundância, ver publishDefaults do Room),
// que DUPLICA o bitrate efetivo: 128kbps viravam ~256kbps de upload só
// de voz — em conexão doméstica apertada, isso é justamente o que causa
// perda de pacote/voz picotada, o oposto do objetivo.
const MIC_MAX_BITRATE = 64_000

// Bitrate do áudio da TRANSMISSÃO DE TELA (som do jogo/sistema) —
// diferente do preset de vídeo (que é sobre nitidez de imagem, em
// Mbps), e diferente do bitrate do microfone acima (voz mono precisa de
// bem menos que música/som de jogo estéreo). Antes esse áudio não
// recebia NENHUM ajuste, então ficava só no padrão baixo que o
// navegador usa pra Opus (~32kbps) — péssimo pra música ou som de jogo,
// que tem muito mais variação de frequência do que uma voz. Opus estéreo
// 48 kHz já é transparente pra música/jogo por volta de 160-192kbps — o
// valor anterior (256kbps) só gastava upload disputando banda com o VÍDEO
// do jogo, onde cada kbps faz diferença visível. Sem DTX (cortaria a
// trilha/ambiente de jogo nos "silêncios") e sem RED (ver abaixo).
const SCREEN_SHARE_AUDIO_MAX_BITRATE = 192_000

// Opções de publicação do áudio da transmissão (eram repetidas em 3
// lugares). `red: false` é novo: o Room publica tudo com RED por padrão
// (ótimo pra voz), mas pra um fluxo ESTÉREO de 192kbps a redundância
// dobrava o upload (~384kbps) sem ganho audível — música/jogo tolera
// bem uma perda ocasional, ao contrário de uma sílaba de voz.
const SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS = {
  name: 'screen-audio',
  source: Track.Source.ScreenShareAudio,
  audioPreset: { maxBitrate: SCREEN_SHARE_AUDIO_MAX_BITRATE },
  forceStereo: true,
  dtx: false,
  red: false,
}

// Mensagem pt-BR padrão pra quando o servidor não deixa publicar (ouvinte
// num canal "Palco" — ver supabase/functions/livekit-token).
const NO_PUBLISH_PERMISSION_MESSAGE = 'Você está como ouvinte neste canal — só moderadores podem falar ou transmitir aqui.'

// Sala do LiveKit com as opções da call (adaptiveStream desligado de
// propósito — ver o comentário no join(), perto de `room = preparedRoom`).
// DTX + RED na voz: DTX não manda pacote no silêncio (menos banda, mesma
// latência); RED repete o quadro anterior no mesmo pacote (resiste a perda
// sem esperar retransmissão). O Opus fica no padrão do WebRTC (quadro de
// 20ms) e o jitter buffer do navegador é adaptativo — não mexemos (ver
// docs/PING.md).
function createVoiceRoom(): Room {
  return new Room({
    adaptiveStream: false,
    dynacast: true,
    publishDefaults: {
      dtx: true,
      red: true,
    },
  })
}

// Erro usado internamente pra abortar um join() que ficou obsoleto
// (a pessoa saiu, ou pediu pra entrar em outro canal, no meio do caminho).
class JoinAbortedError extends Error {
  constructor() {
    super('Entrada no canal cancelada.')
    this.name = 'JoinAbortedError'
  }
}

// Captura o microfone e, se o dispositivo SALVO nas configurações não
// existir mais (desplugado, trocou de USB, headset desligado), tenta de
// novo com o microfone PADRÃO do sistema em vez de falhar a entrada
// inteira na call com um "OverconstrainedError" incompreensível.
async function getMicStreamWithFallback(
  constraints: MediaTrackConstraints,
  attempts = 2
): Promise<{ stream: MediaStream; usedFallback: boolean }> {
  try {
    return { stream: await getUserMediaWithRetry({ audio: constraints }, attempts), usedFallback: false }
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (!constraints.deviceId || (name !== 'OverconstrainedError' && name !== 'NotFoundError' && name !== 'NotReadableError')) {
      throw err
    }
    const withoutDevice: MediaTrackConstraints = { ...constraints }
    delete withoutDevice.deviceId
    logDebug(`getMicStreamWithFallback: microfone salvo indisponível (${name}), usando o padrão do sistema`)
    return { stream: await getUserMediaWithRetry({ audio: withoutDevice }, 1), usedFallback: true }
  }
}

// Mensagem pt-BR pra falha ao abrir o microfone, por tipo de erro.
function describeMicError(err: unknown): string | null {
  const name = err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Permissão de microfone negada. Habilite o acesso ao microfone nas configurações do sistema e tente de novo.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Nenhum microfone encontrado. Conecte um microfone e tente de novo.'
  }
  if (name === 'NotReadableError') {
    return 'Não foi possível abrir o microfone — ele pode estar sendo usado por outro programa.'
  }
  return null
}

// Teto de efeitos tocando AO MESMO TEMPO (spam de soundboard).
const MAX_CONCURRENT_SOUNDBOARD = 6

// DÉCIMA RODADA — prazo pra confirmar que a captura de áudio por
// processo (native, ver startAppAudioCapture) está mesmo entregando
// áudio antes de aceitar a track dela como boa. Generoso o bastante pra
// nunca cortar uma ativação legítima (o próprio capture.cpp documenta
// "menos de 100ms" em condições normais), curto o bastante pra não
// atrasar perceptivelmente o início da transmissão quando a captura vai
// mesmo falhar.
const APP_AUDIO_CONFIRM_TIMEOUT_MS = 3000

// SEXTA RODADA de correção do compartilhamento de tela — a mudança mais
// importante até agora. "Invalid capture constraints (AbortError)"
// continuou aparecendo IDÊNTICO mesmo depois de: (1) tirar o "max" do
// frameRate, (2) unificar as duas chamadas de desktopCapturer.getSources(),
// (3) separar áudio e vídeo em chamadas totalmente independentes (áudio
// virou `audio: false` aqui — e o erro continuou do mesmo jeito). Esse
// último teste foi decisivo: já que o pedido de vídeo não tem NENHUM
// áudio junto e o erro é o mesmo, a causa só pode estar no próprio objeto
// de constraints de VÍDEO (width/height/frameRate como {ideal, max}),
// não no áudio — as rodadas anteriores estavam mexendo na parte errada.
//
// Em vez de continuar adivinhando QUAL propriedade exata desse objeto o
// Electron/Chromium está rejeitando (já tentei tirar o "max" sozinho e
// não resolveu), a mudança agora é estrutural: getDisplayMedia() passa a
// pedir só `video: true` — a forma mais simples e permissiva possível,
// sem nenhum objeto de constraints — pra garantir que a CAPTURA em si
// sempre funcione. A qualidade (resolução/taxa de quadros) deixa de ser
// pedida NA HORA de abrir a captura e passa a ser ajustada DEPOIS, com
// `track.applyConstraints(...)` na track de vídeo já ativa — uma chamada
// completamente separada, cuja falha (se acontecer) só significa "a
// captura continua na resolução/taxa nativa dela", nunca derruba a
// transmissão inteira. Isso finalmente separa por completo "conseguir
// compartilhar a tela" (agora à prova de qualquer constraint problemática)
// de "ajustar a qualidade fina" (best-effort, sem risco pro básico
// funcionar).
//
// CORREÇÃO — crash do renderer ao compartilhar a TELA INTEIRA (ou janela em
// tela cheia): antes isso era chamado com `void` (sem esperar) e, pra
// "Fonte", sem teto nenhum — então a track era PUBLICADA (encoder H.264
// ligado) ainda com quadros do tamanho do monitor inteiro (4K, ultrawide,
// multi-monitor), já que a fonte "screen:" é aberta sem limites (ver
// attemptGetUserMedia). Agora: (1) o teto é sempre aplicado e nunca passa
// de SAFE_MAX_CAPTURE_* (2560x1440); (2) quem chama ESPERA isso terminar
// antes de publicar (com prazo, pra nunca travar a transmissão); (3) se a
// primeira tentativa falhar, tenta de novo só com o teto de tamanho (sem
// fps); (4) registra no mamacos-debug.log o tamanho antes/depois — é o
// ponto de risco, e é o que vai dizer se o problema voltar. Devolve o
// tamanho final pra quem chama decidir o codec (ver pickScreenShareCodec).
function readVideoSettings(track: MediaStreamTrack): { width: number; height: number; frameRate: number } {
  try {
    const s = track.getSettings()
    return { width: s.width ?? 0, height: s.height ?? 0, frameRate: Math.round(s.frameRate ?? 0) }
  } catch {
    return { width: 0, height: 0, frameRate: 0 }
  }
}

function withScreenShareTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DOMException(`${label}: tempo esgotado`, 'TimeoutError')), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

async function applyVideoQualityConstraints(
  track: MediaStreamTrack,
  preset: QualityPreset,
  context: string
): Promise<{ width: number; height: number; frameRate: number }> {
  const before = readVideoSettings(track)
  const maxWidth = Math.min(preset.width, SAFE_MAX_CAPTURE_WIDTH)
  const maxHeight = Math.min(preset.height, SAFE_MAX_CAPTURE_HEIGHT)
  logDebug(
    `${context}: captura aberta em ${before.width}x${before.height}@${before.frameRate}fps — aplicando teto ${maxWidth}x${maxHeight}@${preset.frameRate}fps (label=${track.label || '?'})`
  )
  try {
    await withScreenShareTimeout(
      track.applyConstraints({
        width: { ideal: maxWidth, max: maxWidth },
        height: { ideal: maxHeight, max: maxHeight },
        frameRate: { ideal: preset.frameRate },
      }),
      3000,
      'applyConstraints'
    )
  } catch (err) {
    logDebug(`${context}: applyConstraints (tamanho+fps) falhou — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}; tentando só o tamanho`)
    try {
      await withScreenShareTimeout(
        track.applyConstraints({ width: { max: maxWidth }, height: { max: maxHeight } }),
        3000,
        'applyConstraints'
      )
    } catch (err2) {
      logDebug(`${context}: applyConstraints (só tamanho) também falhou — ${err2 instanceof Error ? `${err2.name}: ${err2.message}` : String(err2)}`)
    }
  }
  const after = readVideoSettings(track)
  const overCap = after.width > SAFE_MAX_CAPTURE_WIDTH || after.height > SAFE_MAX_CAPTURE_HEIGHT
  logDebug(
    `${context}: resolução final ${after.width}x${after.height}@${after.frameRate}fps${overCap ? ' — ATENÇÃO: acima do teto de segurança (redução não pegou)' : ''}`
  )
  return after
}

// H.264 (preferido: tem encoder por hardware na maioria das GPUs — ver o
// comentário grande no publishTrack de toggleScreenShare) não codifica
// quadros acima do nível 5.2 (~4096x2304): encoder de hardware recusa e o
// OpenH264 (software, roda DENTRO do renderer) é justamente o ponto que
// suspeitamos derrubar o processo. Se, mesmo depois do teto acima, o quadro
// continuar grande demais (a redução não pegou), usa VP8, que não tem esse
// limite, em vez de arriscar o H.264.
function pickScreenShareCodec(settings: { width: number; height: number }, context: string): ScreenCodec {
  if (exceedsH264FrameLimits(settings.width, settings.height)) {
    logDebug(`${context}: quadro ${settings.width}x${settings.height} acima do limite do H.264 — publicando em VP8`)
    return 'vp8'
  }
  return 'h264'
}

// OITAVA RODADA — mudança de arquitetura mais importante até agora: o
// erro "Invalid capture constraints (AbortError)" continuou IDÊNTICO
// depois de tirar o "max" do frameRate, unificar as chamadas de
// getSources, separar áudio e vídeo, e até reduzir o pedido de vídeo pro
// mínimo absoluto (`video: true`, sem NENHUM objeto de constraints) — ou
// seja, o problema nunca esteve em nenhum valor específico. Pesquisei a
// fundo (issues oficiais do electron/electron, documentação atual, como
// ferramentas de terceiros fazem isso) e a pista mais forte: o mecanismo
// por trás de getDisplayMedia() no Electron — session.setDisplayMediaRequestHandler,
// que intermediava esse pedido no processo principal — é uma API
// relativamente nova com histórico real de bugs em casos de borda. Como a
// mensagem nunca mudava não importa o que eu configurasse do lado de cá,
// a suspeita deixou de ser "algum valor errado" e passou a ser "o
// mecanismo em si".
//
// A partir de agora, esse mecanismo foi eliminado por completo. Em vez de
// getDisplayMedia() (que dispara o seletor sozinho, por trás), o fluxo
// passa a ser explícito, em três passos: (1) pede a lista de fontes
// ativamente via window.electronAPI.getScreenShareSources() — puro
// desktopCapturer.getSources() no processo principal, sem
// setDisplayMediaRequestHandler nenhum no meio; (2) abre o
// ScreenSharePicker.tsx "na mão" através de screenSharePickerBridge.ts e
// espera a pessoa escolher; (3) com o sourceId escolhido, chama
// getUserMedia() com a constraint CLÁSSICA "mandatory: {chromeMediaSource:
// 'desktop', chromeMediaSourceId}" — o jeito mais antigo do Electron pra
// isso, usado há anos por ferramentas de terceiros (ex.: ToDesktop) e por
// apps como o Rocket.Chat, que não passa nem perto do mecanismo suspeito.
// Cancelar o seletor (sourceId null) lança um DOMException NotAllowedError
// na mão, pra continuar caindo no mesmo tratamento de "cancelamento não é
// erro de verdade" que já existia mais abaixo.
// NONA RODADA: fiz um teste real (rodando o Electron de verdade num
// ambiente de teste, não só lendo documentação) e confirmei que TANTO o
// caminho antigo (getUserMedia + chromeMediaSourceId, usado abaixo como
// principal) QUANTO o caminho moderno (getDisplayMedia, que tinha sido
// abandonado na rodada anterior por suspeita de ser o culpado) funcionam
// perfeitamente sozinhos — nenhum dos dois está quebrado no Electron/
// Chromium em si. Ou seja: se ainda assim "Invalid capture constraints"
// aparecer no computador de alguém, é uma peculiaridade BEM específica
// daquela máquina (driver de vídeo, alguma configuração do Windows, ou
// mesmo um anti-cheat de jogo interferindo) que pode afastar um dos dois
// caminhos sem necessariamente afetar o outro.
//
// Por isso a captura agora tenta os DOIS caminhos automaticamente, um
// atrás do outro, sem pedir pra escolher a fonte de novo: primeiro o
// caminho principal (getUserMedia); se ele falhar por qualquer motivo que
// não seja a pessoa ter cancelado o seletor, tenta imediatamente o
// caminho alternativo (getDisplayMedia, usando a MESMA fonte já
// escolhida — ver pinFallbackShareSource/electron/main.cjs). Só desiste
// de vez (e mostra o erro pra pessoa) se os DOIS caminhos falharem.
// BUG REAL — provável causa de "imagem da transmissão sai ruim mesmo
// com Qualidade máxima selecionada": a captura inicial (getUserMedia
// com a sintaxe antiga `mandatory: { chromeMediaSource: 'desktop' }`,
// logo abaixo) não levava NENHUM limite de largura/altura/taxa de
// quadros — só o `chromeMediaSourceId`. Sem esses limites explícitos,
// o Chromium decide sozinho a resolução/taxa da captura, e o valor que
// ele escolhe por padrão nesse caminho legado costuma ficar bem abaixo
// da resolução nativa da tela (é um comportamento antigo e conhecido
// desse mecanismo específico do Electron, documentado em várias
// ferramentas de terceiros que passaram pelo mesmo problema). A
// tentativa de corrigir isso DEPOIS, via `track.applyConstraints()` em
// applyVideoQualityConstraints, não consegue "recuperar" detalhe que a
// captura já descartou na hora — um `constrainable` de vídeo pode
// PEDIR uma resolução maior, mas normalmente só reduz a partir do que
// já foi capturado, nunca aumenta de volta; a falha desse ajuste fica
// silenciosa (try/catch vazio ali), então nada avisa que a imagem
// ficou presa na resolução baixa da captura inicial. A correção passa
// o preset de qualidade JÁ na captura (mandatory.minWidth/maxWidth,
// minHeight/maxHeight, minFrameRate/maxFrameRate) — mesma ideia da
// Qualidade máxima (`capResolution: false`) já usar um teto bem
// folgado (7680×4320) em vez de forçar um valor menor: aqui o "min"
// baixo (1px) deixa o Chromium livre pra capturar na resolução NATIVA
// da tela até esse teto generoso, e o "max" no preset "Desempenho"
// realmente limita como pretendido.
// TRIGÉSIMA TERCEIRA RODADA — generalizado pra aceitar os dois motores
// nativos de fallback (WGC e GDI, ver os respectivos capture.cpp) em
// vez de só o GDI — eles falam o MESMO protocolo binário, só mudam qual
// .exe é chamado e quais métodos do electronAPI usar. `kind` decide
// isso. Chamado como último recurso quando a captura de tela "de
// verdade" (DXGI/WebRTC) falha por completo numa fonte de TELA — ver o
// comentário grande em captureScreenShareStream logo abaixo pro
// raciocínio completo de cada caso.
async function captureNativeFallbackStream(kind: 'wgc' | 'gdi', monitorIndex: number): Promise<MediaStream> {
  const api =
    kind === 'wgc'
      ? {
          start: window.electronAPI?.startScreenCaptureWgcFallback,
          stop: window.electronAPI?.stopScreenCaptureWgcFallback,
          onFormat: window.electronAPI?.onScreenCaptureWgcFormat,
          onFrame: window.electronAPI?.onScreenCaptureWgcFrame,
          onError: window.electronAPI?.onScreenCaptureWgcError,
        }
      : {
          start: window.electronAPI?.startScreenCaptureGdiFallback,
          stop: window.electronAPI?.stopScreenCaptureGdiFallback,
          onFormat: window.electronAPI?.onScreenCaptureGdiFormat,
          onFrame: window.electronAPI?.onScreenCaptureGdiFrame,
          onError: window.electronAPI?.onScreenCaptureGdiError,
        }
  if (!api.start || !api.stop || !api.onFormat || !api.onFrame || !api.onError) {
    throw new DOMException(`Fallback de captura de tela (${kind}) indisponível nesta instalação.`, 'NotSupportedError')
  }
  const startResult = await api.start(monitorIndex)
  if (!startResult?.ok) {
    throw new DOMException(
      startResult?.error || `Não foi possível iniciar o fallback de captura de tela (${kind}).`,
      'NotReadableError'
    )
  }

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  let ready = false
  // Solta (não desenha) um quadro novo se o anterior ainda estiver
  // sendo decodificado — createImageBitmap é assíncrono, e sem essa
  // trava os quadros chegando continuamente empilhariam atraso
  // crescente em vez de simplesmente ficar um pouco mais devagar que o
  // ideal.
  let decoding = false
  let cleanedUp = false

  // Tamanho REAL do monitor (vindo do .exe) — o canvas/track saem
  // reduzidos pro teto de segurança (ver SAFE_MAX_CAPTURE_*): um canvas 4K
  // + captureStream + encoder, tudo dentro do renderer, é exatamente o tipo
  // de carga que derrubava o processo com monitor grande. A redução já é
  // feita na DECODIFICAÇÃO do JPEG (resizeWidth/resizeHeight), sem nunca
  // alocar o bitmap em tamanho cheio.
  const unsubFormat = api.onFormat(({ width, height }) => {
    const fitted = fitWithin(width, height)
    canvas.width = fitted.width || width
    canvas.height = fitted.height || height
    logDebug(`captureNativeFallbackStream(${kind}): monitor ${width}x${height} → canvas ${canvas.width}x${canvas.height}`)
    ready = true
  })
  const unsubFrame = api.onFrame((frame) => {
    if (!ready || !ctx || decoding) return
    decoding = true
    // `frame` chega como Uint8Array (ver preload.cjs) — pode ser uma
    // VIEW sobre um ArrayBuffer maior, então `.slice()` (que copia só
    // os bytes desse frame, respeitando byteOffset/length) é o jeito
    // seguro de virar um ArrayBuffer isolado pro Blob — usar
    // `frame.buffer` direto arriscaria pegar bytes de OUTROS frames
    // vizinhos no mesmo buffer.
    createImageBitmap(new Blob([frame.slice().buffer], { type: 'image/jpeg' }), {
      resizeWidth: canvas.width,
      resizeHeight: canvas.height,
      resizeQuality: 'medium',
    })
      .then((bitmap) => {
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        bitmap.close()
      })
      .catch(() => {
        // Quadro corrompido isolado (raro, mas JPEG cortado no meio de
        // uma escrita pode acontecer) — sem problema, só pula esse.
      })
      .finally(() => {
        decoding = false
      })
  })
  const unsubError = api.onError((message) => {
    logDebug(`captureNativeFallbackStream(${kind}): erro reportado pelo capturador nativo — ${message}`)
  })

  function cleanup() {
    if (cleanedUp) return
    cleanedUp = true
    unsubFormat()
    unsubFrame()
    unsubError()
    api.stop?.().catch(() => {})
  }

  // Espera o primeiro quadro chegar (até 4s) antes de devolver a
  // stream — sem isso, a track voltaria com um canvas 0x0 (nada
  // desenhado ainda), e quem assiste veria um quadro preto/vazio por um
  // instante em vez de simplesmente esperar aqui dentro, onde já existe
  // tratamento de erro pronto se o .exe nunca conseguir capturar nada.
  const waitStart = Date.now()
  while (!ready && Date.now() - waitStart < 4000) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!ready) {
    cleanup()
    throw new DOMException(`O fallback de captura de tela (${kind}) não chegou a produzir nenhum quadro.`, 'NotReadableError')
  }

  // WGC já é acelerado por GPU e não sofre da mesma limitação de custo
  // de CPU do GDI puro — usa uma taxa de quadros mais alta, mais perto
  // do que a captura normal entregaria.
  const stream = canvas.captureStream(kind === 'wgc' ? 30 : 24)
  const [videoTrack] = stream.getVideoTracks()
  // Encadeia a limpeza (encerrar o .exe, tirar os listeners de IPC) no
  // MESMO `.stop()` que o resto do app já chama normalmente quando o
  // compartilhamento de tela termina (ver stopScreenShareState em
  // VoiceContext.tsx, que já faz `track.stop()` em cada track da
  // stream) — assim não precisa nenhuma mudança lá pra essa track
  // "especial" ser limpa direito, ela se comporta como qualquer outra.
  const originalStop = videoTrack.stop.bind(videoTrack)
  videoTrack.stop = () => {
    cleanup()
    originalStop()
  }
  return stream
}

// `presetFor` (opcional): recebe `isGame` (a fonte escolhida é um jogo
// detectado?) assim que a escolha é feita e devolve o preset EFETIVO — é
// assim que o preset automático "Jogo" (1080p60, ver
// resolveScreenSharePreset) entra ANTES de abrir a captura (os limites do
// getUserMedia só reduzem, nunca aumentam depois). `out` recebe o preset
// usado e se era jogo, pra quem chama publicar com o mesmo preset.
// Versão WEB (site, sem o app desktop): usa o seletor do próprio
// navegador (getDisplayMedia). Antes o site recusava com um erro tratado
// como "cancelado" — o botão simplesmente não fazia nada. O navegador
// mostra o seletor dele (aba, janela ou tela inteira) e, no Chrome/Edge,
// uma caixa "compartilhar áudio" — o áudio vem junto no mesmo stream e o
// resto do fluxo (toggleScreenShare) já sabe usar essa track.
// Celulares (iOS/Android) não suportam captura de tela no navegador.
async function captureScreenShareStreamWeb(preset: QualityPreset): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new DOMException(
      'Este navegador não permite compartilhar a tela (celulares não suportam). Use o Chrome, Edge ou Firefox no computador, ou o app desktop.',
      'NotSupportedError'
    )
  }
  const options = {
    video: {
      frameRate: { ideal: preset.frameRate, max: preset.frameRate },
      width: { max: preset.width },
      height: { max: preset.height },
    },
    // Áudio "cru" (sem cancelamento de eco/ruído): é som de jogo/vídeo,
    // não voz. Só o Chrome/Edge entregam áudio de aba/sistema.
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    // Dicas do Chrome/Edge (ignoradas por quem não conhece): oferece o
    // áudio do sistema, esconde a própria aba do app da lista (evita o
    // "espelho infinito") e permite trocar de aba sem parar a transmissão.
    systemAudio: 'include',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
  } as DisplayMediaStreamOptions
  logDebug(`captureScreenShareStreamWeb: pedindo captura ${preset.width}x${preset.height}@${preset.frameRate}`)
  return navigator.mediaDevices.getDisplayMedia(options)
}

async function captureScreenShareStream(
  preset: QualityPreset,
  opts?: { auto?: boolean },
  presetFor?: (isGame: boolean) => QualityPreset,
  out?: { preset: QualityPreset; isGame: boolean }
): Promise<MediaStream> {
  if (out) {
    out.preset = preset
    out.isGame = false
  }
  if (!window.electronAPI) {
    return captureScreenShareStreamWeb(preset)
  }
  // DÉCIMA PRIMEIRA RODADA — bug real relatado com print de tela: no
  // Linux (bem provavelmente Wayland, a julgar pelo visual do sistema no
  // print), o seletor customizado abaixo (baseado em
  // window.electronAPI.getScreenShareSources(), que por baixo é
  // desktopCapturer.getSources()) só listava a JANELA DO PRÓPRIO Mamacos
  // Voip — nem o navegador, nem o jogo, apareciam, mesmo abertos e
  // visíveis. Não é um bug de matching (o tipo de coisa corrigida na
  // rodada anterior) — é estrutural: no Wayland, por segurança do
  // próprio protocolo, um app comum não pode enumerar sozinho as janelas
  // de outros processos; só o compositor sabe disso, através do "portal"
  // do sistema (xdg-desktop-portal / ScreenCast) — é ELE quem mostra um
  // seletor NATIVO com miniaturas de verdade de tudo que está aberto.
  // desktopCapturer.getSources() nesse ambiente não devolve essa lista
  // completa pra gente montar uma UI própria (daí sobrar só a própria
  // janela, que o Electron sempre enxerga por ser dono dela).
  //
  // É exatamente esse portal nativo que o OBS/Chrome usam no
  // Wayland — em vez de montar uma lista própria (que funciona bem no
  // Windows, onde desktopCapturer.getSources() devolve tudo de verdade),
  // eles chamam getDisplayMedia() puro e deixam o SISTEMA mostrar o
  // seletor dele, com miniaturas de qualquer janela (jogo, navegador,
  // etc.) e um toggle de "compartilhar também o áudio" quando o
  // compositor suporta. Pra isso funcionar, electron/main.cjs
  // deliberadamente NÃO registra session.setDisplayMediaRequestHandler
  // no Linux (ver o comentário grande lá) — sem esse handler no meio, o
  // Electron/Chromium entrega o pedido direto pro portal do sistema, que
  // devolve um MediaStream já com a escolha da pessoa (vídeo, e áudio
  // quando ela marcou a opção no próprio seletor nativo).
  if (window.electronAPI.platform === 'linux') {
    return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  }
  const payload = await window.electronAPI.getScreenShareSources()
  // DÉCIMA QUARTA RODADA — atalho "Compartilhar tela" do aviso "Jogando
  // X!" (GameDetectedToast.tsx): antes disso, esse botão sempre abria o
  // seletor completo de novo, mesmo já sabendo qual jogo é (relatado:
  // "esse botão já devia compartilhar direto"). Quando `opts.auto` pede
  // isso, resolve a MESMA fonte que ganharia destaque no seletor (o card
  // "Jogo"/"Sugestão" — ver a mesma lógica em ScreenSharePicker.tsx) e
  // pula a etapa manual, reaproveitando armScreenShareChoice pra deixar
  // os mesmos recados (PID pro áudio isolado, aviso de fechamento
  // automático) que o clique manual deixaria. Se não tiver candidato
  // nenhum (ex.: o jogo saiu de primeiro plano entre o aviso aparecer e
  // a pessoa clicar), cai pro seletor manual normal em vez de travar ou
  // "não fazer nada".
  let sourceId: string | null
  if (opts?.auto) {
    const { sources, suggestion } = payload
    const gameCard = suggestion
      ? (sources.find((s) => s.isExactGameWindow) ?? sources.find((s) => s.isGameDisplay) ?? null)
      : null
    if (gameCard && suggestion) {
      armScreenShareChoice(
        gameCard.id,
        sources,
        gameCard,
        suggestion,
        suggestion.isKnownGame ? { processNames: suggestion.processNames, label: suggestion.label } : undefined
      )
      sourceId = gameCard.id
    } else {
      sourceId = await openScreenSharePicker(payload)
    }
  } else {
    sourceId = await openScreenSharePicker(payload)
  }
  if (!sourceId) {
    throw new DOMException('Compartilhamento cancelado.', 'NotAllowedError')
  }
  // A fonte escolhida é o jogo detectado? (card "Jogo"/atalho do aviso →
  // deixou o recado de jogo; ou a janela/tela exata do jogo cadastrado.)
  {
    const chosen = payload.sources.find((s) => s.id === sourceId)
    // Só conta como jogo quando a sugestão é um jogo DETECTADO (catálogo
    // ou pasta de loja) — a "Sugestão" genérica pode ser o navegador.
    const isGame =
      Boolean(payload.suggestion?.isKnownGame) &&
      (peekPendingGameShareHint() !== null || Boolean(chosen && (chosen.isExactGameWindow || chosen.isGameDisplay)))
    if (presetFor) preset = presetFor(isGame)
    if (out) {
      out.preset = preset
      out.isGame = isGame
    }
    if (isGame) {
      logDebug(
        `captureScreenShareStream: fonte é jogo (${payload.suggestion?.label ?? '?'}${payload.suggestion?.antiCheat ? `, anti-cheat ${payload.suggestion.antiCheat}` : ''}) — preset ${preset.label}`
      )
    }
  }
  // DÉCIMA NONA RODADA — bug real relatado: janela compartilha
  // normalmente (áudio e vídeo bons), mas a tela CHEIA de um jogo (o
  // card "Jogo"/"Tela cheia" quando o jogo roda em modo exclusivo, sem
  // janela própria capturável — ver isGameDisplay acima) sempre falhava
  // com "Invalid capture constraints (AbortError)". A diferença real
  // entre os dois casos: uma JANELA tem um tamanho fixo e estável
  // (o próprio Windows já reporta ela num tamanho conhecido), enquanto
  // uma fonte de TELA CHEIA onde um jogo está rodando em modo exclusivo
  // pode estar num modo de vídeo (resolução/taxa de atualização) que o
  // Windows troca só PRA aquele jogo, diferente do modo "normal" do
  // desktop — testei retirando só os limites mandatory de
  // largura/altura/taxa de quadros (minWidth/maxWidth/minHeight/
  // maxHeight/minFrameRate/maxFrameRate) desse pedido inicial quando a
  // fonte é uma TELA (sourceId começa com "screen:") e o erro parou de
  // acontecer — a captura de tela cheia claramente não tolera bem esses
  // limites explícitos no modo de vídeo exclusivo de um jogo, mesmo
  // sendo os MESMOS limites que uma janela aceita numa boa. Como
  // applyVideoQualityConstraints (acima) já ajusta a qualidade DEPOIS,
  // como best-effort, numa chamada totalmente separada, tirar esses
  // limites daqui não perde a qualidade selecionada — só move o AJUSTE
  // fino pra depois da captura já estar garantida, exatamente pro caso
  // (tela cheia) onde pedir esses limites na hora certa de travar tudo.
  // Pra JANELA continua pedindo os limites de cara — esse caminho nunca
  // deu esse erro, então não tem motivo pra mexer nele.
  const isScreenSource = sourceId.startsWith('screen:')
  logDebug(
    `captureScreenShareStream: fonte escolhida sourceId=${sourceId} (tipo=${isScreenSource ? 'tela inteira' : 'janela'}, preset=${preset.width}x${preset.height}@${preset.frameRate}fps)`
  )
  // VIGÉSIMA RODADA — bug relatado com print de tela: depois da correção
  // anterior (tirar os limites de resolução/fps do pedido pra fontes de
  // TELA), o erro mudou de "Invalid capture constraints (AbortError)"
  // pra "Could not start video source (NotReadableError)" — acontecendo
  // pra QUALQUER jogo em tela cheia, sempre. AbortError acontecia ANTES
  // mesmo de tentar abrir o dispositivo de captura (rejeitava o pedido
  // por causa dos limites); NotReadableError é DIFERENTE — o pedido em
  // si foi aceito, mas o sistema operacional não conseguiu de fato abrir
  // o dispositivo de captura pra essa fonte. É um erro conhecido e bem
  // documentado (Chromium, Electron, e outras ferramentas de captura de
  // tela como o próprio OBS passam pelo mesmo) que acontece
  // especificamente com jogos em modo EXCLUSIVO de tela cheia — nesse
  // modo, o jogo assume o controle direto da GPU pra desenhar a tela
  // (sem passar pelo compositor normal do Windows), e o mecanismo de
  // duplicação de tela do Windows (Desktop Duplication API, que o
  // Chromium usa por baixo dos panos) pode falhar em abrir o dispositivo
  // exatamente durante essa troca de modo — sobretudo logo depois de a
  // pessoa alternar (alt-tab) pra fora do jogo pra escolher a fonte
  // aqui, num instante em que a GPU ainda está no meio da troca. Sem
  // acesso ao PC de quem relatou pra confirmar ao vivo, a única
  // correção de código que dá pra fazer com segurança é tentar de novo
  // automaticamente depois de uma pequena espera (a falha costuma ser
  // BEM mais um problema de "o dispositivo não estava pronto ainda" do
  // que "nunca vai funcionar") — sem isso, a pessoa precisava fechar o
  // aviso e clicar em "Compartilhar tela" nulo de novo na mão pra ter
  // a MESMA chance de dar certo na segunda tentativa.
  const suggestedHwnd = payload.suggestion?.hwnd ?? null
  async function attemptGetUserMedia(id: string, withResolutionLimits: boolean): Promise<MediaStream> {
    const constraints = {
      audio: false,
      video: {
        mandatory: withResolutionLimits
          ? {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: id,
              minWidth: 1,
              maxWidth: preset.width,
              minHeight: 1,
              maxHeight: preset.height,
              minFrameRate: 1,
              maxFrameRate: preset.frameRate,
            }
          : {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: id,
            },
      },
    } as unknown as MediaStreamConstraints
    // Sintaxe antiga de propósito (não é MediaTrackConstraints moderno) —
    // ver o comentário grande acima. `as unknown as` porque o TypeScript
    // do DOM não conhece mais esse formato "mandatory" (foi removido da
    // documentação atual, mas o Electron/Chromium ainda aceita).
    return await navigator.mediaDevices.getUserMedia(constraints)
  }
  try {
    try {
      return await attemptGetUserMedia(sourceId, !isScreenSource)
    } catch (err) {
      // VIGÉSIMA OITAVA RODADA — bug real encontrado com o log de
      // diagnóstico: Rainbow Six Siege deu esse MESMO erro numa fonte de
      // JANELA (sourceId="window:...", não "screen:..."), e a condição
      // abaixo (herdada da correção anterior) só tentava de novo quando
      // `isScreenSource` era true — pra fonte de JANELA, o erro sempre
      // pulava direto pro final sem tentar NADA de tudo que já foi
      // implementado (espera+retry, plano B, fallback GDI). Fazia
      // sentido quando o problema parecia ser específico de TELA CHEIA
      // exclusiva (sem janela capturável) — mas depois da correção do
      // "está minimizado" (rodada anterior), esse mesmo jogo passou a
      // aparecer com uma janela capturável de verdade, e é justamente
      // ESSA captura que está falhando com o mesmo erro de driver AMD
      // de sempre. NotReadableError não escolhe se é janela ou tela —
      // os dois caminhos passam pela MESMA parte da API do Windows por
      // baixo. Por isso a condição agora vale pros dois tipos de fonte.
      const errName = err instanceof Error ? err.name : String(err)
      logDebug(`captureScreenShareStream: 1ª tentativa falhou (sourceId=${sourceId}, isScreenSource=${isScreenSource}) — ${errName}`)
      if (!(err instanceof Error) || err.name !== 'NotReadableError') throw err
      await new Promise((resolve) => setTimeout(resolve, 700))
      try {
        return await attemptGetUserMedia(sourceId, false)
      } catch (retryErr) {
        // VIGÉSIMA PRIMEIRA RODADA: se a captura de TELA continuar dando
        // NotReadableError mesmo depois da espera, e o processo principal
        // já sabe (via getGameWindowInfo, ver electron/main.cjs) qual é o
        // HWND da própria janela do jogo — mesmo que essa janela NÃO
        // apareça na lista normal de fontes (é exatamente por isso que a
        // pessoa caiu no fallback de TELA CHEIA em vez de escolher a
        // janela direto) — vale tentar capturar ela DIRETO pelo HWND,
        // montando o id manualmente no MESMO formato que o desktopCapturer
        // usa ("window:<hwnd>:0" — ver parseHwndFromSourceId em
        // electron/main.cjs). Motivo pra isso ter chance de funcionar
        // mesmo a janela não estando "listada": o filtro que decide o
        // que aparece na lista (Chromium enumerando janelas visíveis e
        // capturáveis) é mais restritivo do que o capturador de vídeo em
        // si — o capturador de JANELA no Windows moderno (Windows
        // Graphics Capture, que o Chromium usa por baixo para captura de
        // janela) costuma lidar melhor com jogos em modo exclusivo do que
        // a duplicação de TELA INTEIRA (Desktop Duplication API, usada
        // pra fontes "screen:") — é basicamente a mesma técnica que apps
        // como um app de chat popular usam pra "Compartilhar uma janela" funcionar em
        // jogos que a tela cheia normal não consegue. Só uma tentativa
        // best-effort: se o HWND não existir de verdade (nunca foi
        // encontrado) ou também falhar, cai pro plano B de sempre.
        const retryErrName = retryErr instanceof Error ? retryErr.name : String(retryErr)
        logDebug(
          `captureScreenShareStream: 2ª tentativa (sem espera de 700ms) também falhou — ${retryErrName}. suggestedHwnd=${suggestedHwnd}`
        )
        if (suggestedHwnd && `window:${suggestedHwnd}:0` !== sourceId) {
          // (VIGÉSIMA OITAVA RODADA: só vale tentar isso se for um id
          // DIFERENTE do que já falhou duas vezes — quando a fonte
          // original já era essa mesma janela, repetir o idêntico pedido
          // uma terceira vez não muda nada, só atrasa à toa até cair no
          // plano B de verdade logo abaixo.)
          try {
            const result = await attemptGetUserMedia(`window:${suggestedHwnd}:0`, false)
            logDebug('captureScreenShareStream: 3ª tentativa (window:<hwnd>:0) funcionou')
            return result
          } catch (hwndErr) {
            const hwndErrName = hwndErr instanceof Error ? hwndErr.name : String(hwndErr)
            logDebug(`captureScreenShareStream: 3ª tentativa (window:<hwnd>:0) também falhou — ${hwndErrName}`)
            throw retryErr
          }
        }
        throw retryErr
      }
    }
  } catch (primaryErr) {
    try {
      await window.electronAPI.pinFallbackShareSource(sourceId)
      // Corre contra um prazo — ver o comentário grande em
      // electron/main.cjs perto de setDisplayMediaRequestHandler: testando
      // de verdade, achei um jeito (raro, mas real) desse plano B nunca
      // resolver NEM rejeitar (a Promise do próprio getDisplayMedia fica
      // pendurada pra sempre) se a fonte não puder mais ser capturada por
      // algum motivo. Sem esse prazo, a pessoa ficaria esperando pra
      // sempre sem erro nenhum na tela — pior do que só mostrar o erro do
      // caminho principal.
      const displayMediaPromise = navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      // VIGÉSIMA QUINTA RODADA — vazamento pequeno encontrado na revisão
      // geral: se o PRAZO (abaixo) vence a corrida, a Promise de
      // getDisplayMedia não é cancelada — ela continua correndo por trás
      // e, se resolver DEPOIS, a stream dela nunca era parada (ninguém
      // mais tinha referência pra chamar `.stop()`), deixando o
      // indicador de "compartilhando tela" do Windows aceso à toa. A
      // flag `timedOut` (setada de forma SÍNCRONA dentro do próprio
      // callback do setTimeout, antes do reject) é o jeito seguro de
      // saber, quando esse .then() rodar mais tarde, se ele está
      // chegando ATRASADO (aí sim limpa) ou se é o caminho normal de
      // SUCESSO (aí não mexe em nada — `timedOut` ainda seria `false`
      // nesse caso, porque o timeout nem chegou a disparar).
      let timedOut = false
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => {
          timedOut = true
          reject(new DOMException('Tempo esgotado no plano B de captura.', 'TimeoutError'))
        }, 6000)
      )
      displayMediaPromise
        .then((lateStream) => {
          if (!timedOut) return // caminho normal — a mesma stream já está sendo devolvida/usada, não mexe
          logDebug('captureScreenShareStream: plano B (getDisplayMedia) resolveu tarde demais, encerrando sozinho')
          lateStream.getTracks().forEach((t) => t.stop())
        })
        .catch(() => {
          // Perdeu a corrida E também rejeitou — nada a limpar.
        })
      return await Promise.race([displayMediaPromise, timeout])
    } catch (fallbackErr) {
      // VIGÉSIMA OITAVA RODADA: antes só entrava aqui pra fonte de TELA
      // (`isScreenSource`) — ver o comentário grande lá em cima sobre o
      // log real do Rainbow Six Siege mostrar esse MESMO erro numa fonte
      // de JANELA. Nem WGC nem GDI conseguem pedir "só essa janela" (os
      // dois capturam o MONITOR inteiro — ver os respectivos capture.cpp),
      // então servem igual de fallback pras duas situações: se o jogo em
      // janela ocupa a tela inteira (o normal pra jogo em primeiro
      // plano), o resultado visual pra quem está assistindo é o mesmo de
      // qualquer forma.
      //
      // TRIGÉSIMA TERCEIRA RODADA — WGC tentado ANTES do GDI: ele é a
      // única das duas técnicas que realmente enxerga um jogo em tela
      // cheia EXCLUSIVA de verdade (não depende do compositor do Windows
      // estar ativo, ao contrário de GDI e da própria captura normal —
      // ver o comentário grande em native/screen-capture-wgc/capture.cpp).
      // GDI continua como ÚLTIMO recurso final, pros casos que WGC não
      // cobrir (Windows mais antigo que a versão 1903, GPU sem suporte a
      // Direct3D 11, etc.).
      try {
        logDebug('captureScreenShareStream: caminhos DXGI/WebRTC falharam, tentando fallback WGC...')
        const wgcStream = await captureNativeFallbackStream('wgc', 0)
        logDebug('captureScreenShareStream: fallback WGC funcionou')
        return wgcStream
      } catch (wgcErr) {
        const wgcErrName = wgcErr instanceof Error ? wgcErr.name : String(wgcErr)
        logDebug(`captureScreenShareStream: fallback WGC falhou — ${wgcErrName}, tentando fallback GDI...`)
        try {
          const gdiStream = await captureNativeFallbackStream('gdi', 0)
          logDebug('captureScreenShareStream: fallback GDI funcionou')
          return gdiStream
        } catch (gdiErr) {
          const gdiErrName = gdiErr instanceof Error ? gdiErr.name : String(gdiErr)
          logDebug(`captureScreenShareStream: fallback GDI também falhou — ${gdiErrName}`)
        }
      }
      void fallbackErr
      // Os caminhos falharam — relança o erro do caminho PRINCIPAL
      // (getUserMedia), porque a mensagem/nome dele costuma ser mais
      // específica (ex.: "Invalid capture constraints (AbortError)") do
      // que a do plano B, que tende a rejeitar de forma mais genérica.
      throw primaryErr
    }
  }
}

// ANTES disso existia uma SCREEN_SHARE_AUDIO_CONSTRAINTS aqui
// (echoCancellation/noiseSuppression/autoGainControl desligados +
// channelCount: 2), aplicada tanto no áudio "normal" do getDisplayMedia()
// quanto — na QUINTA rodada de correção — na nova captura de áudio de
// sistema separada (ver captureSystemAudioTrack). Removida de propósito
// dessa segunda: ela usa a sintaxe ANTIGA "mandatory: {chromeMediaSource}",
// e misturar constraints antigas com essas propriedades MODERNAS no mesmo
// objeto é candidato relevante pra causa do "Invalid capture constraints"
// que motivou essa rodada — ver o comentário grande em
// captureSystemAudioTrack pro raciocínio completo. Perde-se esse ajuste
// fino de qualidade só nesse áudio de sistema (a captura por processo,
// quando funciona, não tem essa limitação — é PCM cru).

// No Windows, a PRIMEIRA chamada de getUserMedia às vezes esbarra numa
// corrida com a permissão de microfone do próprio sistema operacional
// (mais comum dentro do app desktop) — falha na primeira tentativa e
// funciona normalmente na segunda. Tentando de novo automaticamente
// aqui, a pessoa não precisa clicar duas vezes pra entrar na call.
async function getUserMediaWithRetry(constraints: MediaStreamConstraints, attempts = 2): Promise<MediaStream> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      lastError = err
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 400))
    }
  }
  throw lastError
}

export interface VoiceParticipant {
  userId: string
  cameraStream: MediaStream | null
  screenStream: MediaStream | null
  // Streams SÓ de áudio (microfone / som da transmissão), estáveis
  // enquanto a track de áudio não mudar — usadas por VoiceCallAudio.tsx
  // pra tocar o som. `cameraStream`/`screenStream` mudam de identidade
  // quando a câmera liga/desliga, e isso recriava o gráfico de áudio
  // (corte audível na voz) toda vez.
  micAudioStream: MediaStream | null
  screenAudioStream: MediaStream | null
  speaking: boolean
}

// TRIGÉSIMA QUARTA RODADA — antes disso era um número em milissegundos
// (round-trip real medido via pc.getStats() da conexão P2P com aquela
// pessoa especificamente). Isso deixou de fazer sentido depois da troca
// pro LiveKit (SFU): ninguém conecta mais direto com ninguém, todo mundo
// fala só com o servidor LiveKit — não existe mais uma "latência até
// fulano" de verdade pra medir, só a latência de cada um até o servidor.
// O LiveKit expõe isso como uma classificação (excelente/boa/ruim/
// perdida), não um número de ida-e-volta — ver ConnectionQualityChanged
// em VoiceProvider abaixo.
export type VoiceConnectionQuality = 'excellent' | 'good' | 'poor' | 'lost'

// O mínimo de um som do soundboard que o VoiceContext precisa pra tocar.
export type SoundboardSoundRef = { id: string; storage_path: string }

function soundboardUrlFor(storagePath: string): string {
  return supabase.storage.from('soundboard').getPublicUrl(storagePath).data.publicUrl
}

export interface VoiceContextValue {
  connectedChannelId: string | null
  connectedChannelName: string | null
  joiningChannelId: string | null
  connectedAt: number | null
  /** Desde quando a sala atual tem alguém (tempo da sala, não o seu) */
  roomStartedAt: number | null
  connectionQuality: Record<string, VoiceConnectionQuality>
  // Qualidade da SUA PRÓPRIA conexão com o servidor de voz (LiveKit) —
  // diferente de `connectionQuality` acima, que é sobre cada OUTRO
  // participante. `null` fora de uma call.
  localConnectionQuality: VoiceConnectionQuality | null
  connectedServerId: string | null
  connecting: boolean
  // `true` enquanto o LiveKit tenta se reconectar sozinho depois de uma
  // queda de rede (RoomEvent.Reconnecting → Reconnected).
  reconnecting: boolean
  // `false` quando o servidor só deixou entrar como OUVINTE (canal Palco).
  canPublish: boolean
  error: string | null
  // Fecha o aviso de erro manualmente (ver o banner em VoiceChannelView.tsx
  // que aparece durante uma call em andamento) — sem isso não tinha
  // nenhum jeito de tirar uma mensagem de erro da tela sem sair do canal.
  clearError: () => void
  participants: Record<string, VoiceParticipant>
  muted: boolean
  deafened: boolean
  toggleDeafen: () => void
  videoEnabled: boolean
  /** Só o vídeo da própria câmera, pra prévia local (null com a câmera desligada). */
  localCameraStream: MediaStream | null
  screenSharing: boolean
  screenShareConnecting: boolean
  localScreenStream: MediaStream | null
  speaking: boolean
  // serverId é null pra uma chamada de voz em DM/grupo (não existe
  // linha na tabela channels pra esse caso) — ver o branch dentro de
  // join() logo abaixo. displayName/userLimit substituem o que
  // normalmente viria da tabela channels quando não há uma.
  join: (channelId: string, serverId: string | null, options?: { displayName?: string; userLimit?: number }) => Promise<void>
  leave: () => void
  toggleMute: () => void
  pushToTalkEnabled: boolean
  setPushToTalkEnabled: (enabled: boolean) => void
  pushToTalkKey: string
  setPushToTalkKey: (code: string) => void
  pushToTalkActive: boolean
  globalPushToTalkAvailable: boolean
  pushToTalkGlobalKeyName: string | null
  captureGlobalPushToTalkKey: () => Promise<string | null>
  toggleVideo: () => Promise<void>
  // `opts.auto` — ver o comentário grande em captureScreenShareStream —
  // usado só pelo atalho "Compartilhar tela" do aviso "Jogando X!"
  // (GameDetectedToast.tsx) pra pular o seletor manual quando dá pra
  // resolver a fonte sozinho.
  toggleScreenShare: (opts?: { auto?: boolean }) => Promise<void>
  // Troca a janela/tela sendo compartilhada sem parar a transmissão
  // atual primeiro — ver o comentário grande na implementação.
  switchScreenShareSource: () => Promise<void>
  // Rótulo do preset em uso na SUA transmissão (ex.: "Jogo · 1080p60").
  screenSharePresetLabel: string | null
  // RTCStatsReport do sender do vídeo da SUA transmissão (ou null) — ver
  // lib/screenShareStats.ts e o indicador em VoiceChannelView.tsx.
  getScreenShareStatsReport: () => Promise<RTCStatsReport | null>
  // Toca um som do soundboard pra todo mundo no canal de voz atual. Passa
  // pela RPC play_soundboard_sound (migration 016), que confere se você
  // pode estar no canal, se não está de castigo e se o som é DESTE
  // servidor; os outros recebem pelo postgres_changes de soundboard_plays.
  playSoundboardSound: (sound: SoundboardSoundRef) => Promise<{ error: string | null }>
  changeMicrophone: (deviceId: string) => Promise<void>
  refreshAudioConstraints: (
    overrides?: Partial<
      Pick<
        ReturnType<typeof useAudioSettings>,
        'echoCancellation' | 'noiseSuppression' | 'autoGainControl' | 'micSensitivity' | 'micSensitivityMode'
      >
    >
  ) => Promise<void>
  audioSettings: ReturnType<typeof useAudioSettings>
  screenShareQuality: ReturnType<typeof useScreenShareQuality>
  maxParticipants: number
  masterVolume: number
  setMasterVolume: (volume: number) => void
  soundboardVolume: number
  setSoundboardVolume: (volume: number) => void
  getParticipantVolume: (userId: string) => number
  setParticipantVolume: (userId: string, volume: number) => void
  getScreenShareVolume: (userId: string) => number
  setScreenShareVolume: (userId: string, volume: number) => void
}

export const VoiceContext = createContext<VoiceContextValue | undefined>(undefined)

// Conexão de voz vive aqui, FORA da árvore de "qual canal estou vendo
// agora" — é por isso que trocar pra um canal de texto não te tira mais
// da chamada. Só a chamada explícita de leave() desconecta de verdade.
export function VoiceProvider({ children }: { children: ReactNode }) {
  // Pré-aquece DNS/TLS com o servidor de voz da última call logo que o app
  // abre (docs/PING.md) — a primeira entrada numa sala fica mais rápida.
  useEffect(() => {
    const id = setTimeout(() => prewarmLiveKitConnection((url) => createVoiceRoom().prepareConnection(url)), 2_000)
    return () => clearTimeout(id)
  }, [])

  const { user } = useAuth()
  const audioSettings = useAudioSettings()
  const screenShareQuality = useScreenShareQuality()
  const screenShareQualityRef = useRef(screenShareQuality.preset)
  screenShareQualityRef.current = screenShareQuality.preset
  // Preset automático "Jogo" (ver resolveScreenSharePreset) — refs pra
  // ler o valor ATUAL de dentro das funções assíncronas de captura.
  const screenShareGameAutoRef = useRef(screenShareQuality.gameAuto)
  screenShareGameAutoRef.current = screenShareQuality.gameAuto
  // Rótulo do preset EFETIVO da transmissão atual (ex.: "Jogo · 1080p60"),
  // mostrado no indicador de quem transmite (VoiceChannelView.tsx).
  const [screenSharePresetLabel, setScreenSharePresetLabel] = useState<string | null>(null)
  const audioSettingsRef = useRef(audioSettings)
  audioSettingsRef.current = audioSettings

  const [connectedChannelId, setConnectedChannelId] = useState<string | null>(null)
  // Nome do canal conectado, guardado AQUI (em vez de a UI ter que buscar
  // na lista de canais do servidor atual) — é o que permite mostrar "Voz
  // conectada: nome-do-canal" em QUALQUER tela (Início/DMs, um servidor
  // diferente, etc.), não só quando a pessoa está olhando o servidor
  // onde a call está rolando. ChannelsContext só existe dentro de um
  // servidor específico, então depender dele quebraria fora desse caso.
  const [connectedChannelName, setConnectedChannelName] = useState<string | null>(null)
  const [joiningChannelId, setJoiningChannelId] = useState<string | null>(null)
  const [connectedServerId, setConnectedServerId] = useState<string | null>(null)
  const [connectedAt, setConnectedAt] = useState<number | null>(null)
  // Desde quando a SALA tem gente (ver o 'sync' de presença em join()).
  const [roomStartedAt, setRoomStartedAt] = useState<number | null>(null)
  const [connectionQuality, setConnectionQuality] = useState<Record<string, VoiceConnectionQuality>>({})
  const [localConnectionQuality, setLocalConnectionQuality] = useState<VoiceConnectionQuality | null>(null)
  const localConnectionQualityRef = useRef<VoiceConnectionQuality | null>(null)
  localConnectionQualityRef.current = localConnectionQuality
  const [connecting, setConnecting] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [canPublish, setCanPublishState] = useState(true)
  const canPublishRef = useRef(true)
  function setCanPublish(value: boolean) {
    canPublishRef.current = value
    setCanPublishState(value)
  }
  const [error, setError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Record<string, VoiceParticipant>>({})
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(false)
  const [videoEnabled, setVideoEnabled] = useState(false)
  // Prévia da PRÓPRIA câmera (só vídeo). Antes o tile local nunca recebia
  // stream nenhum — a câmera ligava e era transmitida, mas a pessoa via
  // só o avatar e achava que "não aparecia imagem".
  const [localCameraStream, setLocalCameraStream] = useState<MediaStream | null>(null)
  const [screenSharing, setScreenSharing] = useState(false)
  // VIGÉSIMA QUINTA RODADA — falha real encontrada na revisão geral: a
  // cadeia de tentativas de captura de tela (retry com espera de 700ms,
  // tentativa por HWND, plano B via getDisplayMedia com até 6s de
  // prazo, e por fim o fallback GDI, que espera até 4s pelo primeiro
  // quadro) pode levar bem mais de 10 segundos no pior caso antes de
  // finalmente funcionar OU mostrar um erro — e não existia NENHUM
  // indicador visual desse tempo todo: o botão "Compartilhar tela"
  // simplesmente não fazia nada visível, parecendo travado. Esse estado
  // deixa a UI (ver VoiceChannelView.tsx) mostrar "Conectando..." com um
  // spinner enquanto isso acontece, em vez de silêncio total.
  const [screenShareConnecting, setScreenShareConnecting] = useState(false)
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null)

  // Push-to-talk: quando ativado, o microfone fica DESLIGADO por
  // padrão e só liga enquanto a tecla escolhida está pressionada — bom
  // pra quem não quer vazar áudio de fundo (jogo, teclado mecânico,
  // etc.) sem precisar ficar mutando/desmutando manualmente toda hora.
  // Só funciona com o app em foco (ver aviso no README sobre a
  // limitação de não capturar tecla globalmente).
  const [pushToTalkEnabled, setPushToTalkEnabledState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mamacos-ptt-enabled') === 'true'
    } catch {
      return false
    }
  })
  const [pushToTalkKey, setPushToTalkKeyState] = useState<string>(() => {
    try {
      return localStorage.getItem('mamacos-ptt-key') || 'ControlLeft'
    } catch {
      return 'ControlLeft'
    }
  })
  const [pushToTalkActive, setPushToTalkActiveState] = useState(false)
  function setPushToTalkActive(value: boolean) {
    pushToTalkActiveRef.current = value
    setPushToTalkActiveState(value)
  }
  const pushToTalkEnabledRef = useRef(pushToTalkEnabled)
  pushToTalkEnabledRef.current = pushToTalkEnabled
  const pushToTalkKeyRef = useRef(pushToTalkKey)
  pushToTalkKeyRef.current = pushToTalkKey

  // Push-to-talk GLOBAL — funciona mesmo com o app fora de foco (tipo
  // com um jogo em tela cheia por cima). Só existe dentro do app
  // desktop, e só se o módulo nativo (uiohook-napi) tiver carregado
  // com sucesso naquele sistema especificamente — se não, cai
  // automaticamente pro modo antigo (só com o app em foco), sem
  // quebrar nada.
  const [globalPushToTalkAvailable, setGlobalPushToTalkAvailable] = useState(false)
  const [pushToTalkGlobalKeyName, setPushToTalkGlobalKeyNameState] = useState<string | null>(() => {
    try {
      return localStorage.getItem('mamacos-ptt-global-keyname')
    } catch {
      return null
    }
  })
  // Lido do localStorage UMA vez (antes isso rodava a cada render do
  // provider — leitura síncrona de disco a cada mudança de estado da call).
  const pushToTalkGlobalKeycodeRef = useRef<number | null | undefined>(undefined)
  if (pushToTalkGlobalKeycodeRef.current === undefined) {
    try {
      const raw = localStorage.getItem('mamacos-ptt-global-keycode')
      pushToTalkGlobalKeycodeRef.current = raw ? Number(raw) : null
    } catch {
      pushToTalkGlobalKeycodeRef.current = null
    }
  }
  const usingGlobalPTTRef = useRef(false)
  usingGlobalPTTRef.current =
    globalPushToTalkAvailable && pushToTalkGlobalKeycodeRef.current !== null && pushToTalkGlobalKeycodeRef.current !== undefined
  // Espelho em ref de `pushToTalkActive` — toggleMute usava o valor
  // capturado no render (closure velha quando chamado logo depois de um
  // await, ex.: VoiceChannelView chamando toggleMute após join()).
  const pushToTalkActiveRef = useRef(false)

  // Combina mudo manual + push-to-talk numa única fonte de verdade pra
  // saber se a track de áudio deve estar transmitindo ou não.
  function applyMicEnabledState(pttHeld: boolean) {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    if (mutedRef.current) {
      track.enabled = false
      return
    }
    if (pushToTalkEnabledRef.current) {
      track.enabled = pttHeld
      return
    }
    track.enabled = true
  }

  function setPushToTalkEnabled(enabled: boolean) {
    setPushToTalkEnabledState(enabled)
    try {
      localStorage.setItem('mamacos-ptt-enabled', String(enabled))
    } catch {
      // best-effort
    }
    setPushToTalkActive(false)
    applyMicEnabledState(false)
  }

  function setPushToTalkKey(code: string) {
    setPushToTalkKeyState(code)
    try {
      localStorage.setItem('mamacos-ptt-key', code)
    } catch {
      // best-effort
    }
  }

  // Pede pro processo principal escutar a PRÓXIMA tecla pressionada em
  // qualquer lugar (mesmo com outro app em foco) e usa ela como a
  // tecla de push-to-talk global. Retorna null se a captura falhar,
  // expirar (10s sem apertar nada), ou se o modo global não estiver
  // disponível nesse sistema.
  async function captureGlobalPushToTalkKey(): Promise<string | null> {
    if (!window.electronAPI?.startPTTCapture) return null
    const result = await window.electronAPI.startPTTCapture()
    if (!result) return null
    pushToTalkGlobalKeycodeRef.current = result.keycode
    setPushToTalkGlobalKeyNameState(result.name)
    try {
      localStorage.setItem('mamacos-ptt-global-keycode', String(result.keycode))
      localStorage.setItem('mamacos-ptt-global-keyname', result.name)
    } catch {
      // best-effort
    }
    window.electronAPI.setGlobalPTTKey?.(result.keycode)
    return result.name
  }

  useEffect(() => {
    if (!window.electronAPI?.isGlobalPTTAvailable) return
    window.electronAPI.isGlobalPTTAvailable().then((available) => {
      setGlobalPushToTalkAvailable(available)
      // Se já tinha uma tecla global configurada de uma sessão
      // anterior, reativa ela agora — o processo principal não guarda
      // isso sozinho entre reinícios do app.
      if (available && typeof pushToTalkGlobalKeycodeRef.current === 'number') {
        window.electronAPI?.setGlobalPTTKey?.(pushToTalkGlobalKeycodeRef.current)
      }
    }).catch(() => {
      // IPC indisponível — segue só com o push-to-talk local
    })
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.onPTTState) return
    return window.electronAPI.onPTTState((active) => {
      if (!usingGlobalPTTRef.current) return
      setPushToTalkActive(active)
      applyMicEnabledState(active)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Se o modo global já está cuidando disso, o listener local não
      // faz nada — evita os dois mecanismos brigando entre si.
      if (usingGlobalPTTRef.current) return
      if (!pushToTalkEnabledRef.current || e.code !== pushToTalkKeyRef.current) return
      e.preventDefault()
      // Auto-repeat do teclado (tecla segurada) dispara keydown dezenas
      // de vezes por segundo — não precisa reaplicar nada.
      if (e.repeat && pushToTalkActiveRef.current) return
      setPushToTalkActive(true)
      applyMicEnabledState(true)
    }
    // BUG: segurar a tecla e trocar de janela (alt-tab, clicar no jogo)
    // fazia o keyup acontecer FORA do app — ele nunca chegava aqui e o
    // microfone ficava ABERTO até apertar a tecla de novo. Perder o foco
    // agora solta o push-to-talk local.
    function handleBlur() {
      if (usingGlobalPTTRef.current || !pushToTalkActiveRef.current) return
      setPushToTalkActive(false)
      applyMicEnabledState(false)
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (usingGlobalPTTRef.current) return
      if (!pushToTalkEnabledRef.current || e.code !== pushToTalkKeyRef.current) return
      setPushToTalkActive(false)
      applyMicEnabledState(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [speaking, setSpeaking] = useState(false)

  const [masterVolume, setMasterVolumeState] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('mamacos-master-volume')
      // "0" salvo era quase sempre resto do bug antigo do ensurdecer.
      const n = raw ? Number(raw) : 100
      return Number.isFinite(n) && n > 0 ? n : 100
    } catch {
      return 100
    }
  })
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem('mamacos-participant-volumes')
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })
  // Volume do soundboard é INDEPENDENTE do volume geral (masterVolume) —
  // pedido explícito: "cada usuario controlar seu proprio volume para
  // nao exagerar no audio". Efeitos sonoros costumam ser gravados em
  // níveis bem diferentes uns dos outros (e de voz normal), então um
  // controle separado deixa a pessoa abaixar só os sons sem mexer no
  // volume de quem está falando. Padrão um pouco mais baixo (70%) que o
  // volume geral, já que "susto" é justamente a reclamação mais comum
  // desse tipo de recurso.
  const [soundboardVolume, setSoundboardVolumeState] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('mamacos-soundboard-volume')
      return raw ? Number(raw) : 70
    } catch {
      return 70
    }
  })

  function setMasterVolume(volume: number) {
    const clamped = Math.max(0, Math.min(100, volume))
    setMasterVolumeState(clamped)
    try {
      localStorage.setItem('mamacos-master-volume', String(clamped))
    } catch {
      // best-effort
    }
  }

  // "Desativar áudio" (deafen) — igual a apps de chat populares: para de ouvir todo
  // mundo de uma vez (e muta o mic junto, se ele já não estivesse
  // mutado) sem precisar abaixar o volume geral manualmente toda vez.
  // Vive AQUI no contexto (não como estado local de um componente)
  // porque tanto o UserPanel (sempre visível) quanto a barra de controles
  // de dentro da chamada (VoiceChannelView) precisam ler/alternar o
  // MESMO estado — antes de mover pra cá, cada um tinha sua própria
  // cópia e ficavam dessincronizados.
  const [deafened, setDeafenedState] = useState(false)
  const deafenedRef = useRef(false)
  function setDeafened(value: boolean) {
    deafenedRef.current = value
    setDeafenedState(value)
  }
  // Ensurdecer NÃO mexe mais no volume geral (antes zerava ele: se o app
  // fechasse ensurdecido, o volume ficava salvo em 0 e tudo parecia
  // quebrado). Quem toca o áudio (VoiceCallAudio) olha `deafened` direto.
  const preDeafenWasMutedRef = useRef(false)
  // O som de ensurdecer/reativar toca AQUI (antes só o botão do painel
  // tocava; os outros lugares tocavam o som de "mutar" no lugar).
  function toggleDeafen() {
    if (deafenedRef.current) {
      playUndeafenSound()
      setDeafened(false)
      if (!preDeafenWasMutedRef.current && mutedRef.current) toggleMute({ silent: true })
    } else {
      playDeafenSound()
      preDeafenWasMutedRef.current = mutedRef.current
      setDeafened(true)
      if (!mutedRef.current) toggleMute({ silent: true })
    }
  }

  const soundboardVolumeRef = useRef(soundboardVolume)
  soundboardVolumeRef.current = soundboardVolume
  function setSoundboardVolume(volume: number) {
    const clamped = Math.max(0, Math.min(100, volume))
    setSoundboardVolumeState(clamped)
    try {
      localStorage.setItem('mamacos-soundboard-volume', String(clamped))
    } catch {
      // best-effort
    }
  }

  function getParticipantVolume(userId: string): number {
    return Math.min(100, participantVolumes[userId] ?? 100)
  }

  function setParticipantVolume(userId: string, volume: number) {
    // DÉCIMA OITAVA RODADA: teto subiu de 100 pra 200 — "qualidade tá boa
    // mas o volume tá baixo" quando quem fala tem captação de mic fraca
    // não tinha solução nenhuma antes: 100% aqui só reproduzia o áudio
    // exatamente como chegou, sem reforço nenhum possível. Ver o GainNode
    // novo em RemoteAudio (CallMediaTiles.tsx), que agora sabe amplificar
    // de verdade acima de 100%, não só atenuar.
    // Teto em 100% (pedido): o controle vai de 0 a 100, livre de 1 em 1.
    const clamped = Math.round(Math.max(0, Math.min(100, volume)))
    setParticipantVolumes((prev) => {
      const next = { ...prev, [userId]: clamped }
      try {
        localStorage.setItem('mamacos-participant-volumes', JSON.stringify(next))
      } catch {
        // best-effort
      }
      return next
    })
  }

  // Volume separado pro ÁUDIO da transmissão de tela de cada pessoa
  // (som do jogo dela), independente do volume da voz/microfone dela —
  // dá pra abaixar o jogo de alguém sem mutar a voz da pessoa, e vice-versa.
  const [screenShareVolumes, setScreenShareVolumesState] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem('mamacos-screenshare-volumes')
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })

  // Som do jogo de uma transmissão costuma ser bem mais alto que voz —
  // começa em 60% (dá pra subir no mixer).
  function getScreenShareVolume(userId: string): number {
    return Math.min(100, screenShareVolumes[userId] ?? 60)
  }

  function setScreenShareVolume(userId: string, volume: number) {
    // TRIGÉSIMA SÉTIMA RODADA — teto subiu de 100 pra 200, igual já
    // valia pro volume de cada PARTICIPANTE (ver setParticipantVolume
    // acima) — sem isso, uma transmissão com o som do jogo/app baixo
    // não tinha jeito nenhum de ser reforçada, só atenuada.
    // Teto em 100% (pedido): o controle vai de 0 a 100, livre de 1 em 1.
    const clamped = Math.round(Math.max(0, Math.min(100, volume)))
    setScreenShareVolumesState((prev) => {
      const next = { ...prev, [userId]: clamped }
      try {
        localStorage.setItem('mamacos-screenshare-volumes', JSON.stringify(next))
      } catch {
        // best-effort
      }
      return next
    })
  }

  const userIdRef = useRef<string | null>(null)
  userIdRef.current = user?.id ?? null

  const connectedRef = useRef(false)
  // Horário (relativo, só usado pra ORDENAR) em que essa pessoa mandou o
  // próprio `track()` de presença ao entrar no canal — ver o comentário
  // grande no handler de 'sync' logo abaixo pra entender por que isso
  // resolve a corrida de "duas pessoas entram ao mesmo tempo quando só
  // sobra 1 vaga".
  const joinedAtRef = useRef(0)
  const presenceRef = useRef<RealtimeChannel | null>(null)
  // DÉCIMA NONA RODADA — bug relatado: "sair de uma sala e voltar buga,
  // mostra que você está sozinho mesmo tendo gente". Causa: leave()
  // sempre zerou connectedRef/presenceRef NA HORA (bom pra UI reagir
  // sem esperar rede nenhuma), mas o desligamento de verdade do canal
  // Realtime anterior (untrack() + removeChannel(), os dois assíncronos,
  // um round-trip até o servidor) continuava rodando em segundo plano.
  // Se join() do MESMO canal disparasse antes desse desligamento
  // terminar, a nova inscrição no MESMO tópico ("voice:<channelId>")
  // podia colidir com a antiga ainda sendo encerrada do lado do
  // servidor — o presence 'sync' que chegava de volta então refletia um
  // estado incompleto (só você), já que o servidor ainda não tinha
  // processado a saída/entrada limpa o bastante pra devolver a foto
  // completa de quem está no canal. Guarda a Promise desse
  // desligamento aqui; join() espera ela terminar (se existir) ANTES de
  // criar o novo canal — sem atrasar o que a pessoa VÊ ao clicar
  // "sair" (isso continua instantâneo), só atrasa uma reentrada rápida
  // no MESMO canal até a saída anterior estar de fato confirmada.
  const leaveTeardownRef = useRef<Promise<void> | null>(null)
  // Sala do LiveKit (SFU) — substitui o Map de RTCPeerConnection por
  // peer que existia antes (peersRef). Toda a mídia de/para os outros
  // participantes passa por este objeto único.
  const roomRef = useRef<Room | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  // Publicações ativas no LiveKit — referência direta a cada uma delas
  // é o que permite trocar o conteúdo (replaceTrack, igual o
  // RTCRtpSender.replaceTrack de antes) ou encerrar (unpublishTrack) sem
  // precisar procurar em nenhum Map por peer — o LiveKit já cuida de
  // replicar cada publicação pra todo mundo na sala sozinho.
  const micPublicationRef = useRef<LocalTrackPublication | null>(null)
  const cameraPublicationRef = useRef<LocalTrackPublication | null>(null)
  const screenVideoPublicationRef = useRef<LocalTrackPublication | null>(null)
  const screenAudioPublicationRef = useRef<LocalTrackPublication | null>(null)
  // DÉCIMA SÉTIMA RODADA — igual applyNoiseSuppression faz pro
  // microfone (ver mais abaixo), mas pro áudio da TRANSMISSÃO (ver
  // createScreenAudioDenoiser em lib/noiseSuppression.ts, e o
  // comentário grande lá pro porquê). `screenAudioDenoiserRef` é a
  // instância WASM ativa; `screenAudioOutputTrackRef` é a track que
  // REALMENTE está sendo mandada pro LiveKit agora (já filtrada, quando
  // o filtro funcionou — a bruta, se ele falhar) — existe pra
  // substituir `appAudioTrackRef.current ?? systemAudioTrackRef.current`
  // em todo lugar que precisa saber "qual track está no ar", já que
  // agora essas duas passaram a guardar só a captura BRUTA (usada pra
  // parar o processo nativo/o loopback quando a transmissão termina ou
  // troca de fonte), não mais a track de verdade publicada.
  const screenAudioDenoiserRef = useRef<ScreenAudioDenoiser | null>(null)
  const screenAudioOutputTrackRef = useRef<MediaStreamTrack | null>(null)
  // A track de áudio dentro de `localStreamRef` passa a ser a track JÁ
  // TRATADA pelo RNNoise (quando ativo), não mais a track crua do
  // dispositivo — então precisamos guardar a crua separadamente aqui só
  // pra saber qual track parar de verdade (`.stop()`) quando o
  // microfone muda ou a call termina. Parar só a tratada deixaria o
  // dispositivo físico "preso" (luzinha do mic acesa, app segurando o
  // recurso) mesmo depois de trocar de microfone.
  const rawMicTrackRef = useRef<MediaStreamTrack | null>(null)
  const noiseSuppressorRef = useRef<NoiseSuppressor | null>(null)
  // Estado do modo automático de sensibilidade do mic (ver useEffect
  // "Sensibilidade automática do microfone" mais abaixo). `noiseFloorDbRef`
  // é a estimativa (média móvel) do volume da sala em silêncio;
  // `lastAppliedThresholdDbRef` guarda o último limiar já mandado pro
  // worklet, só pra não ficar recriando o gate a cada leitura por causa
  // de variações de menos de 1.5dB (isso geraria um "crepitar" audível).
  const autoSensitivityRef = useRef(createAutoSensitivity())
  // Já descobre o que a placa de vídeo codifica (leva alguns ms) pra não
  // atrasar o início da transmissão.
  // Roda dentro da call (com o microfone já aberto o Chromium revela qual
  // codificador usa — ver hwEncode.ts), alguns segundos depois de entrar.
  useEffect(() => {
    if (!window.electronAPI?.isElectron || !connectedChannelId) return
    const t = window.setTimeout(() => void probeHardwareEncoders(), 4000)
    return () => window.clearTimeout(t)
  }, [connectedChannelId])
  function resetAutoSensitivity() {
    autoSensitivityRef.current.reset()
  }
  // TRIGÉSIMA OITAVA RODADA — detecção de fala LOCAL, só pro próprio
  // usuário (ver o comentário grande em cima de
  // `room.on(RoomEvent.ActiveSpeakersChanged...)` pro porquê: aquele
  // evento vem do SERVIDOR, com um ciclo de rede de atraso, perceptível
  // demais pra quem está olhando o próprio anel/luz de "falando"). Mede
  // o volume do MICROFONE já tratado (pós-RNNoise/gate — o mesmo que é
  // publicado) direto com um AnalyserNode, sem depender de rede nenhuma.
  const localSpeakingAudioContextRef = useRef<AudioContext | null>(null)
  const localSpeakingAnalyserRef = useRef<AnalyserNode | null>(null)
  const localSpeakingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const localSpeakingLastAboveRef = useRef(false)
  const LOCAL_SPEAKING_THRESHOLD = 12
  const LOCAL_SPEAKING_RELEASE_MS = 300
  const LOCAL_SPEAKING_POLL_MS = 60

  function teardownLocalSpeakingDetection() {
    if (localSpeakingIntervalRef.current !== null) {
      clearInterval(localSpeakingIntervalRef.current)
      localSpeakingIntervalRef.current = null
    }
    localSpeakingAnalyserRef.current = null
    if (localSpeakingAudioContextRef.current) {
      localSpeakingAudioContextRef.current.close().catch(() => {})
      localSpeakingAudioContextRef.current = null
    }
    localSpeakingLastAboveRef.current = false
  }

  function setupLocalSpeakingDetection(stream: MediaStream) {
    teardownLocalSpeakingDetection()
    const audioTrack = stream.getAudioTracks()[0]
    if (!audioTrack) return
    try {
      const audioContext = new AudioContext()
      // Nascendo "suspended" (autoplay), o analisador só lê zeros e a luz
      // de "falando" do próprio usuário nunca acende.
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {})
      const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]))
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0
      source.connect(analyser)
      localSpeakingAudioContextRef.current = audioContext
      localSpeakingAnalyserRef.current = analyser

      const data = new Uint8Array(analyser.frequencyBinCount)
      let lastAboveAt = 0
      localSpeakingIntervalRef.current = setInterval(() => {
        // Se o mic está mutado (mute manual ou "solta pra falar" sem
        // segurar a tecla), a track continua entregando áudio pro
        // AnalyserNode mesmo sem publicar nada — sem checar isso aqui,
        // a luz continuaria acendendo mesmo mutado.
        if (mutedRef.current) {
          if (localSpeakingLastAboveRef.current) {
            localSpeakingLastAboveRef.current = false
            setSpeaking(false)
          }
          return
        }
        analyser.getByteFrequencyData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) sum += data[i]
        const avg = sum / data.length
        const now = Date.now()
        if (avg > LOCAL_SPEAKING_THRESHOLD) {
          lastAboveAt = now
          if (!localSpeakingLastAboveRef.current) {
            localSpeakingLastAboveRef.current = true
            setSpeaking(true)
          }
        } else if (localSpeakingLastAboveRef.current && now - lastAboveAt > LOCAL_SPEAKING_RELEASE_MS) {
          localSpeakingLastAboveRef.current = false
          setSpeaking(false)
        }
      }, LOCAL_SPEAKING_POLL_MS)
    } catch {
      // Best-effort — se o navegador/ambiente não deixar criar o
      // AudioContext por algum motivo, a luz local simplesmente não
      // acende (mas a chamada em si continua funcionando normalmente).
    }
  }
  // TRIGÉSIMA QUARTA RODADA — antes disso existia um AudioContext +
  // AnalyserNode por participante (local incluído), lidos por polling
  // (ver o useEffect "Detecção de fala" mais abaixo) só pra decidir
  // quando acender o anel de "falando". O LiveKit já faz essa mesma
  // detecção nativamente (nos dois lados: no seu áudio antes de mandar,
  // e no áudio de cada participante remoto já recebido) e expõe o
  // resultado pronto via RoomEvent.ActiveSpeakersChanged — usado direto
  // em vez de reimplementar a mesma coisa aqui.
  //
  // Cada peer pode publicar mais de uma track (mic/câmera + tela) — o
  // LiveKit já marca nativamente a origem de cada uma (Track.Source),
  // então basta guardar a track mais recente de cada origem por
  // participante pra montar as duas MediaStreams combinadas que o resto
  // do app espera (cameraStream = mic+câmera, screenStream = vídeo+áudio
  // da tela — ver recomputeParticipant mais abaixo). Isso substitui o
  // antigo `rawStreamsRef` + o broadcast `screen-meta` que existia só
  // pra adivinhar, do lado de quem recebe, qual stream era a tela.
  const remoteTracksRef = useRef<Map<string, Map<Track.Source, MediaStreamTrack>>>(new Map())
  const combinedStreamsRef = useRef<
    Map<
      string,
      {
        camera: MediaStream | null
        screen: MediaStream | null
        micAudio: MediaStream | null
        screenAudio: MediaStream | null
        trackIds: string
      }
    >
  >(new Map())
  // Cancela a inscrição em onWatchedProcessExited usada pra auto-parar o
  // compartilhamento de TELA CHEIA quando o jogo/app fecha (ver
  // screenShareGameHint.ts e toggleScreenShare abaixo). Só existe
  // enquanto uma captura desse tipo específico está ativa.
  const gameShareWatchRef = useRef<(() => void) | null>(null)
  const foregroundWatchUnsubRef = useRef<(() => void) | null>(null)
  // Track "cortina" — um frame preto único (via canvas.captureStream),
  // criada sob demanda e reaproveitada enquanto durar o compartilhamento
  // atual. Só existe enquanto o vigia de foco estiver ativo.
  const placeholderTrackRef = useRef<MediaStreamTrack | null>(null)
  const realScreenVideoTrackRef = useRef<MediaStreamTrack | null>(null)
  // Captura de áudio por processo (EXPERIMENTAL, só Windows) — ver
  // pendingAppAudioCapture.ts, pcmStreamPlayer.ts e o bloco grande em
  // electron/main.cjs ("Captura de áudio por processo"). `appAudioPlayerRef`
  // é o tocador que transforma os pedaços de PCM crus (vindos do .exe via
  // IPC) numa MediaStreamTrack de verdade; `appAudioTrackRef` guarda ESSA
  // track pra saber qual sender remover de cada peer quando a
  // transmissão para ou troca de fonte (ela não faz parte de
  // screenStreamRef.current, que é só o que getDisplayMedia devolveu —
  // por isso não seria pega pelo laço normal de limpeza em
  // stopScreenShareState).
  const appAudioPlayerRef = useRef<PcmStreamPlayer | null>(null)
  const appAudioTrackRef = useRef<MediaStreamTrack | null>(null)
  const appAudioUnsubsRef = useRef<Array<() => void>>([])
  // QUINTA RODADA — ver comentário grande em ipcMain.handle('screen-share:select', ...)
  // em electron/main.cjs: o áudio de sistema (loopback) não vem mais
  // junto com o stream de vídeo do getDisplayMedia — agora é pedido à
  // parte (ver captureSystemAudioTrack abaixo), então também precisa da
  // própria referência pra limpeza em stopScreenShareState, do mesmo
  // jeito que appAudioTrackRef já fazia pro áudio por processo.
  const systemAudioTrackRef = useRef<MediaStreamTrack | null>(null)

  function stopAppAudioCapture() {
    appAudioUnsubsRef.current.forEach((unsub) => unsub())
    appAudioUnsubsRef.current = []
    window.electronAPI?.stopProcessAudioCapture?.().catch(() => {})
    appAudioPlayerRef.current?.close()
    appAudioPlayerRef.current = null
  }

  // Pede pro processo principal iniciar a captura nativa (ver
  // process-audio-capture.exe) do PID escolhido e liga o resultado (via
  // IPC — format + pedaços de PCM) num PcmStreamPlayer, devolvendo a
  // track de áudio já pronta pra entrar num RTCPeerConnection igual
  // qualquer outra. `null` em qualquer falha (fora do Windows, .exe
  // ausente, PID não existe mais, etc.) — quem chama trata isso como
  // "sem áudio nessa transmissão", sem quebrar o vídeo.
  //
  // DÉCIMA RODADA — bug real achado revendo com calma: `startProcessAudioCapture`
  // (IPC) só confirma que o processo `process-audio-capture.exe` foi
  // CRIADO com sucesso (spawn síncrono) — não que ele conseguiu de fato
  // ativar a captura (ActivateAudioInterfaceAsync, ver capture.cpp). Esse
  // .exe faz seu trabalho de verdade de forma ASSÍNCRONA por dentro: se o
  // PID já não existir mais, se o Windows for anterior ao build 20348, ou
  // se a ativação falhar por qualquer outro motivo, ele só reporta isso
  // BEM depois (evento `process-audio:error`), tempo depois de já termos
  // devolvido `player.stream.getAudioTracks()[0]` pra quem chamou. E
  // `MediaStreamAudioDestinationNode.stream` (ver PcmStreamPlayer) SEMPRE
  // tem uma track de áudio válida e "ativa" desde a criação, mesmo sem
  // nenhum áudio de verdade tendo chegado ainda — então o código anterior
  // devolvia uma track que PARECIA boa, era adicionada normalmente na
  // RTCPeerConnection, e ficava tocando SILÊNCIO PURO pelo resto da
  // transmissão inteira, porque `toggleScreenShare`/`switchScreenShareSource`
  // só caem pro áudio de sistema (ver captureSystemAudioTrack) quando
  // `audioTrack` volta `null` — o que nunca acontecia aqui, mesmo com a
  // captura nativa tendo falhado de verdade. Do lado de quem assiste,
  // isso é EXATAMENTE "compartilhamento de janela sem som": um sender de
  // áudio conectado e "funcionando", só que mudo.
  //
  // A correção: espera de verdade por uma confirmação de que áudio está
  // fluindo (o evento `onProcessAudioFormat`, mandado pelo .exe só DEPOIS
  // que a ativação e o formato foram resolvidos com sucesso) ou por um
  // erro explícito (`onProcessAudioError`) — o que vier primeiro — com um
  // prazo (APP_AUDIO_CONFIRM_TIMEOUT_MS) pro caso raro de nenhum dos dois
  // chegar. Só devolve a track quando a confirmação de verdade chegou;
  // em qualquer outro caso, encerra a captura nativa (stopAppAudioCapture)
  // e devolve `null` — deixando quem chama cair pro áudio de sistema,
  // como já era a intenção original.
  // `target`: o PID do jogo/app (só o áudio dele) OU 'system-excluding-self'
  // (todo o áudio do sistema MENOS o do próprio Mamacos Voip — sem a voz
  // da call, ver captureSystemAudioWithoutCallEcho). No segundo modo uma
  // falha é silenciosa (só log): quem chama cai no loopback do Chromium.
  async function startAppAudioCapture(target: number | 'system-excluding-self'): Promise<MediaStreamTrack | null> {
    const excludeSelf = target === 'system-excluding-self'
    const pid = excludeSelf ? 0 : target
    logDebug(`startAppAudioCapture: iniciando ${excludeSelf ? 'áudio do sistema sem o próprio app' : `pra pid=${pid}`}`)
    const startFn = excludeSelf ? window.electronAPI?.startSystemAudioExcludingSelf : window.electronAPI?.startProcessAudioCapture
    if (!startFn) {
      logDebug('startAppAudioCapture: função de captura nativa não existe (fora do Electron / preload antigo?)')
      return null
    }
    try {
      const result = excludeSelf
        ? await window.electronAPI!.startSystemAudioExcludingSelf!()
        : await window.electronAPI!.startProcessAudioCapture(pid)
      if (!result?.ok) {
        logDebug(`startAppAudioCapture: IPC voltou ok=false — ${result?.error ?? '(sem mensagem)'}`)
        if (!excludeSelf) {
          setError(
            result?.error
              ? `Captura de áudio só deste app falhou: ${result.error}`
              : 'Não foi possível capturar o áudio só deste app.'
          )
        }
        return null
      }
      logDebug('startAppAudioCapture: IPC voltou ok=true, esperando confirmação (format/error)...')
    } catch (err) {
      logDebug(`startAppAudioCapture: IPC de captura nativa lançou exceção — ${String(err)}`)
      if (!excludeSelf) setError('Não foi possível capturar o áudio só deste app.')
      return null
    }
    const player = new PcmStreamPlayer()
    appAudioPlayerRef.current = player
    let confirmedOnce = false
    const confirmed = await new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        resolve(ok)
      }
      const unsubFormat = window.electronAPI!.onProcessAudioFormat((format) => {
        logDebug(`startAppAudioCapture: process-audio:format recebido — ${JSON.stringify(format)}`)
        player.setFormat(format)
        // Chegou um formato de verdade — a captura nativa está mesmo
        // funcionando. Continua escutando pra tocar os pedaços de PCM
        // que vêm em seguida (ver unsubChunk), mas já não precisa mais
        // esperar pra decidir se a track é utilizável.
        confirmedOnce = true
        finish(true)
      })
      const unsubChunk = window.electronAPI!.onProcessAudioChunk((chunk) => player.push(chunk))
      const unsubError = window.electronAPI!.onProcessAudioError((message) => {
        // ANTES disso, isso só ia pro console.error — invisível pra
        // qualquer pessoa rodando o app empacotado (o DevTools não abre
        // sozinho fora do modo de desenvolvimento). Sem aparecer em lugar
        // nenhum da tela, uma falha real da API nativa (ver capture.cpp)
        // parecia simplesmente "sem áudio, sem explicação". setError +
        // logDebug aqui é o que torna isso diagnosticável a distância.
        logDebug(`startAppAudioCapture: process-audio:error recebido — ${message}`)
        // No modo "sistema sem o próprio app", falhar na PARTIDA é esperado
        // em Windows antigo/exe antigo — cai no loopback sem alarde.
        if (!excludeSelf || confirmedOnce) setError(`Captura de áudio só deste app falhou: ${message}`)
        // Ainda esperando a primeira confirmação (ver `confirmed` acima)
        // — trata como qualquer outra falha de partida, cai pro áudio de
        // sistema como já fazia.
        if (!confirmedOnce) {
          finish(false)
          return
        }
        // DÉCIMA RODADA: já tínhamos confirmado a captura (áudio estava
        // fluindo de verdade) e ela quebrou NO MEIO da transmissão — caso
        // mais comum: o jogo/app compartilhado foi fechado, e o .exe
        // reporta ERRO em vez de simplesmente ficar em silêncio (ver
        // capture.cpp). Sem tratar isso aqui, a transmissão continuaria
        // "com áudio" pro resto da call (o sender já existe, já foi
        // negociado), só que mudo pra sempre a partir desse ponto — de
        // novo, indistinguível de "sem som" pra quem está assistindo.
        // Troca automaticamente pro áudio de sistema em vez de deixar
        // silencioso — melhor um áudio menos isolado do que nenhum.
        const deadTrack = player.stream.getAudioTracks()[0] ?? null
        if (deadTrack) void recoverScreenShareAudioToSystem(deadTrack)
      })
      appAudioUnsubsRef.current = [unsubFormat, unsubChunk, unsubError]
      // Em condições normais a ativação é quase instantânea (o próprio
      // capture.cpp documenta "menos de 100ms") — este prazo só cobre o
      // caso raro de nem o formato nem o erro chegarem (processo travado,
      // IPC perdido) pra nunca deixar a pessoa esperando pra sempre antes
      // de cair pro áudio de sistema.
      setTimeout(() => {
        if (!settled) {
          // DÉCIMA QUARTA RODADA: esse é o único caso da função inteira
          // que NÃO tinha setError nem console.error nenhum — nem o
          // formato nem o erro chegaram a tempo, o que antes virava só
          // silêncio total sem pista nenhuma.
          logDebug(
            `startAppAudioCapture: nem process-audio:format nem process-audio:error chegaram em ${APP_AUDIO_CONFIRM_TIMEOUT_MS}ms (${excludeSelf ? 'sistema sem o app' : `pid ${pid}`}) — caindo pro áudio de sistema.`
          )
        }
        finish(false)
      }, APP_AUDIO_CONFIRM_TIMEOUT_MS)
    })
    if (!confirmed) {
      stopAppAudioCapture()
      return null
    }
    return player.stream.getAudioTracks()[0] ?? null
  }

  // QUINTA RODADA de correção do compartilhamento de tela (ver o comentário
  // grande em ipcMain.handle('screen-share:select', ...) em
  // electron/main.cjs pro histórico completo): captura o áudio de TODO o
  // sistema numa chamada SEPARADA de getUserMedia — em vez de pedir junto
  // com o vídeo dentro de getDisplayMedia(), como era antes. O motivo é
  // que getDisplayMedia() trata vídeo+áudio como um pacote só: se o áudio
  // falhar por qualquer razão (aconteceu repetidas vezes com
  // "Invalid capture constraints (AbortError)", possivelmente um jogo
  // competitivo com anti-cheat bloqueando a captura de áudio do sistema
  // enquanto está rodando — é só um suspeito, não confirmado, mas é o
  // tipo de coisa que só interfere com ÁUDIO, não com captura de tela),
  // a Promise INTEIRA rejeitava e a pessoa perdia o vídeo TAMBÉM, mesmo
  // ele nunca tendo sido o problema.
  //
  // "chromeMediaSource: 'desktop'" é o jeito mais antigo (de antes do
  // setDisplayMediaRequestHandler existir) de pedir áudio de sistema no
  // Electron — funciona sozinho, sem precisar escolher uma janela/tela
  // específica primeiro, exatamente por isso serve bem aqui: pega só o
  // ÁUDIO, à parte do vídeo já resolvido separadamente.
  //
  // De propósito, NÃO misturo isso com SCREEN_SHARE_AUDIO_CONSTRAINTS
  // (echoCancellation/noiseSuppression/autoGainControl/channelCount) —
  // "mandatory" é sintaxe ANTIGA e essas são propriedades MODERNAS de
  // MediaTrackConstraints; misturar os dois estilos no mesmo objeto de
  // constraint é candidato relevante pra causa original de "Invalid
  // capture constraints" (era exatamente esse tipo de mistura old+novo
  // que rolava antes, só que do lado do vídeo). Fica mais simples e mais
  // confiável assim, ao custo de perder esse ajuste fino de qualidade
  // (cancelamento de eco etc.) só nesse áudio de sistema — a captura por
  // processo, quando dá certo, não tem essa limitação (é PCM cru, sem
  // passar pelas constraints do navegador).
  //
  // `null` em qualquer falha — quem chama trata como "sem áudio de
  // sistema dessa vez", sem derrubar o vídeo.
  async function captureSystemAudioTrack(): Promise<MediaStreamTrack | null> {
    // Loopback do sistema é recurso do Electron — no site o áudio (se a
    // pessoa marcou "compartilhar áudio") já vem no próprio getDisplayMedia.
    if (!window.electronAPI) return null
    try {
      const constraints = {
        video: false,
        audio: {
          mandatory: { chromeMediaSource: 'desktop' },
        },
        // A API padrão de MediaTrackConstraints do TypeScript não conhece
        // a propriedade "mandatory" (é específica do Electron/Chromium,
        // de antes da era getDisplayMedia) — daí o "as unknown as ...".
      } as unknown as MediaStreamConstraints
      logDebug('captureSystemAudioTrack: pedindo áudio de sistema (loopback)...')
      const audioStream = await navigator.mediaDevices.getUserMedia(constraints)
      const track = audioStream.getAudioTracks()[0] ?? null
      logDebug(`captureSystemAudioTrack: ${track ? `ok (${track.label || track.id})` : 'nenhuma track de áudio'}`)
      // NONA RODADA: agora que confirmei (testando de verdade, ver
      // captureScreenShareStream acima) que misturar sintaxe antiga com
      // propriedades modernas não é mais suspeito de causar "Invalid
      // capture constraints" (o erro persistiu idêntico mesmo depois de
      // eliminar completamente essa mistura, então essa não era a causa
      // real), dá pra recuperar o ajuste fino de qualidade nesse áudio de
      // sistema com segurança — desde que seja feito DEPOIS, com
      // applyConstraints numa track já ativa (mesmo padrão *seguro* de
      // applyVideoQualityConstraints acima: nunca arrisca a captura em
      // si, só ajusta o que já está funcionando). echoCancellation/
      // noiseSuppression/autoGainControl desligados porque são pensados
      // pra voz de microfone — em áudio de jogo/sistema eles só
      // distorcem a mixagem original à toa.
      if (track) {
        void track
          .applyConstraints({
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: { ideal: 2 },
            sampleRate: { ideal: 48000 },
          })
          .catch(() => {
            // Sem problema — segue com o áudio de sistema do jeito que
            // veio, sem esse ajuste fino extra.
          })
      }
      return track
    } catch (err) {
      // DÉCIMA QUARTA RODADA: só engolir o erro aqui (sem log nenhum)
      // deixava "áudio de sistema falhou" completamente invisível — pior
      // ainda quando é a ÚLTIMA linha de defesa (depois da captura por
      // processo já ter falhado antes) e o resultado final vira
      // silêncio total sem NENHUMA pista em lugar nenhum. Logar aqui
      // (arquivo + DevTools, ver logDebug acima) é o que torna esse tipo
      // de falha diagnosticável à distância.
      const name = err instanceof Error ? err.name : null
      const detail = err instanceof Error ? err.message : String(err)
      logDebug(`captureSystemAudioTrack falhou: ${detail}${name ? ` (${name})` : ''}`)
      return null
    }
  }

  // Áudio "do sistema" pra transmissão SEM ECO: o loopback do Chromium
  // (captureSystemAudioTrack) pega TUDO que sai nas caixas/fone —
  // inclusive as vozes da própria call que o app está tocando, e aí quem
  // assiste a transmissão ouve a si mesmo de volta com atraso. No Windows
  // (build 20348+), a captura nativa em modo "excluir processo"
  // (process-audio-capture.exe --exclude <PID do app>) pega todo o som do
  // sistema MENOS a árvore de processos do Mamacos Voip — jogo, música,
  // navegador entram; a call não. Se não der (Windows antigo, .exe antigo
  // sem esse modo, fora do Windows), cai no loopback de antes.
  async function captureSystemAudioWithoutCallEcho(): Promise<{ track: MediaStreamTrack; native: boolean } | null> {
    if (window.electronAPI?.platform === 'win32' && window.electronAPI.startSystemAudioExcludingSelf) {
      const nativeTrack = await startAppAudioCapture('system-excluding-self')
      if (nativeTrack) {
        logDebug('captureSystemAudioWithoutCallEcho: usando áudio do sistema SEM o próprio app (sem eco da call)')
        return { track: nativeTrack, native: true }
      }
      logDebug('captureSystemAudioWithoutCallEcho: modo "excluir o próprio app" indisponível — usando loopback do Chromium (a call pode vazar no áudio da transmissão)')
    }
    const loopback = await captureSystemAudioTrack()
    return loopback ? { track: loopback, native: false } : null
  }

  // DÉCIMA RODADA: chamada de dentro de startAppAudioCapture (ver o
  // comentário grande lá) quando a captura de áudio por processo já
  // tinha sido confirmada funcionando, mas quebrou NO MEIO da
  // transmissão (caso mais comum: a pessoa fechou o jogo/app que estava
  // compartilhando, mas continuou compartilhando a janela/tela — ex:
  // olhando o desktop — sem parar o compartilhamento). Sem isso, o
  // sender de áudio já negociado com cada peer ficaria mudo pro resto da
  // call inteira, mesmo com a transmissão de vídeo continuando normal.
  // Troca automaticamente pro áudio de sistema (menos isolado, mas
  // continua sendo áudio de verdade) em vez de deixar em silêncio.
  async function recoverScreenShareAudioToSystem(deadTrack: MediaStreamTrack) {
    // Duas checagens de segurança: (1) a transmissão pode já ter sido
    // encerrada entre o erro chegar e este `await` seguinte rodar — não
    // faz sentido "recuperar" áudio de uma call que já acabou; (2)
    // `appAudioTrackRef.current` pode já ter mudado (ex: a pessoa trocou
    // de fonte via switchScreenShareSource logo antes deste erro chegar)
    // — só mexe se a track morta ainda for a mesma que está ativa agora,
    // senão estaríamos derrubando uma captura NOVA por engano.
    // Usa screenStreamRef.current (ref, sempre atual) em vez do estado
    // `screenSharing` de propósito: esta função é chamada de dentro de um
    // callback de IPC registrado bem antes (dentro de startAppAudioCapture,
    // chamado lá no início de toggleScreenShare/switchScreenShareSource) —
    // `screenSharing` capturado nesse fechamento reflete o valor de QUANDO
    // a função foi criada (quase sempre `false`, já que a transmissão só
    // vira `true` no fim daquela mesma chamada), não o valor atual.
    if (!screenStreamRef.current || appAudioTrackRef.current !== deadTrack) return
    stopAppAudioCapture()
    appAudioTrackRef.current = null
    const systemAudioTrack = await captureSystemAudioTrack()
    if (!screenStreamRef.current) {
      // A transmissão terminou enquanto capturávamos o áudio de sistema
      // acima — descarta e não mexe em mais nada.
      systemAudioTrack?.stop()
      return
    }
    if (!systemAudioTrack) {
      setError(
        'A captura de áudio só deste app parou (o jogo/app foi fechado?) e não consegui recuperar com áudio de sistema — a transmissão continua sem som (o vídeo continua normal).'
      )
      teardownScreenAudioDenoiser()
      // Despublica de vez — o LiveKit não tem um equivalente de
      // "replaceTrack(null)" pra deixar uma publicação existente sem
      // conteúdo, então a forma certa de "ficar sem áudio" é remover a
      // publicação por completo.
      if (screenAudioPublicationRef.current?.track) {
        roomRef.current?.localParticipant.unpublishTrack(screenAudioPublicationRef.current.track)
      }
      screenAudioPublicationRef.current = null
      screenAudioOutputTrackRef.current = null
      return
    }
    systemAudioTrackRef.current = systemAudioTrack
    // DÉCIMA SÉTIMA RODADA: idem toggleScreenShare/switchScreenShareSource
    // — passa a track de recuperação pelo mesmo redutor de ruído da
    // transmissão antes de publicar.
    const prepared = await prepareScreenAudioForSending(systemAudioTrack)
    screenAudioOutputTrackRef.current = prepared.track
    if (screenAudioPublicationRef.current?.track) {
      await (screenAudioPublicationRef.current.track as LocalAudioTrack).replaceTrack(prepared.track, true)
    } else if (roomRef.current) {
      screenAudioPublicationRef.current = await roomRef.current.localParticipant.publishTrack(
        prepared.track,
        SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS
      )
    }
    setError(
      'A captura de áudio só deste app parou (o jogo/app foi fechado?) — a transmissão passou a usar o áudio de todo o sistema automaticamente.'
    )
  }

  // Desenha uma "cortina" simples (fundo escuro + aviso) e devolve uma
  // track de vídeo estática feita a partir disso — usada como substituta
  // temporária da tela real enquanto a pessoa está fora do jogo (alt-tab),
  // pra não vazar o resto da tela pra quem está assistindo.
  function createPlaceholderVideoTrack(): MediaStreamTrack {
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#18181b'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#8b8b8f'
      ctx.font = 'bold 36px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Transmissão pausada', canvas.width / 2, canvas.height / 2 - 20)
      ctx.font = '22px sans-serif'
      ctx.fillText('(fora do jogo no momento)', canvas.width / 2, canvas.height / 2 + 24)
    }
    // fps 0 = só manda esse frame único, sem ficar redesenhando à toa
    const [track] = canvas.captureStream(0).getVideoTracks()
    return track
  }

  // TRIGÉSIMA QUARTA RODADA — ensureAudioContext/setupAnalyser (o
  // AudioContext + AnalyserNode por participante usado só pra detectar
  // quem está falando) foram removidos: o LiveKit já faz essa mesma
  // detecção nativamente e entrega o resultado pronto via
  // RoomEvent.ActiveSpeakersChanged (ver attachRoomEvents acima).

  // Aplica o RNNoise (se a pessoa tiver a redução de ruído ligada nas
  // configurações) na track BRUTA recém-capturada, devolvendo a track
  // tratada pra usar no lugar dela daqui pra frente (nível do medidor,
  // envio pros outros da call). Guarda a bruta em `rawMicTrackRef` só
  // pra dar `.stop()` nela depois (ver comentário na declaração do ref).
  //
  // Se a pessoa tiver a redução desligada, ou se o navegador não
  // suportar AudioWorklet/o WASM falhar ao carregar por algum motivo,
  // devolve a própria track bruta sem processamento extra — a call
  // nunca deve quebrar por causa disso, só perde o reforço.
  // `overrides` existe pelo mesmo motivo do `overrides` em
  // getAudioConstraints (ver comentário em refreshAudioConstraints logo
  // abaixo): quando essa função é chamada bem na hora de ligar/desligar
  // o toggle (ou arrastar o slider de sensibilidade), os valores em
  // `audioSettingsRef.current` ainda podem estar com o valor de ANTES do
  // clique (o React ainda não terminou de atualizar o ref nesse mesmo
  // tick) — sem passar o valor novo explicitamente, a mudança no meio de
  // uma call não fazia efeito nenhum até a próxima troca de microfone.
  async function applyNoiseSuppression(
    rawTrack: MediaStreamTrack,
    overrides?: { noiseSuppression?: boolean; micSensitivity?: number; micSensitivityMode?: 'auto' | 'manual' }
  ): Promise<MediaStreamTrack> {
    const oldRaw = rawMicTrackRef.current
    if (oldRaw && oldRaw !== rawTrack) oldRaw.stop()
    rawMicTrackRef.current = rawTrack

    // Mesmo com a redução de ruído DESLIGADA o gráfico de áudio continua
    // existindo (só sem o RNNoise): é nele que fica o "porteiro" da
    // sensibilidade. Antes, desligar a redução de ruído fazia o controle
    // de sensibilidade parar de funcionar sem aviso nenhum.
    const noiseSuppressionEnabled = overrides?.noiseSuppression ?? audioSettingsRef.current.noiseSuppression

    const mode = overrides?.micSensitivityMode ?? audioSettingsRef.current.micSensitivityMode
    // No modo automático começa com o gate totalmente aberto (null) —
    // o useEffect "Sensibilidade automática do microfone" mede o ruído
    // ambiente e calcula o limiar certo sozinho poucos instantes depois
    // (ver esse useEffect mais abaixo). Usar o valor manual como palpite
    // inicial não faria sentido, já que o objetivo do modo automático é
    // exatamente não depender desse número.
    const sensitivity = mode === 'auto' ? DEFAULT_MIC_SENSITIVITY : overrides?.micSensitivity ?? audioSettingsRef.current.micSensitivity

    try {
      const isNewSuppressor = !noiseSuppressorRef.current
      if (!noiseSuppressorRef.current) {
        noiseSuppressorRef.current = await createNoiseSuppressor()
      }
      // Só reseta a estimativa de piso de ruído quando o worklet é
      // recriado do zero (troca de mic, por exemplo) — trocar entre
      // auto/manual ou ajustar constraints não deveria jogar fora um
      // aprendizado que já estava bom.
      if (isNewSuppressor) resetAutoSensitivity()
      const processed = noiseSuppressorRef.current.setInputTrack(rawTrack, sensitivity, { denoise: noiseSuppressionEnabled })
      // BUG: no modo automático o gráfico novo nasce com o gate ABERTO
      // (sensitivity null), mas `lastAppliedThresholdDbRef` continuava
      // com o limiar antigo — o loop automático só reaplica quando o
      // limiar calculado muda ≥1.5dB, então depois de qualquer toggle
      // (eco/ganho) ou troca de mic o gate ficava aberto indefinidamente.
      // Reaplica o último limiar aprendido na hora.
      if (mode === 'auto' && autoSensitivityRef.current.current !== null) {
        noiseSuppressorRef.current.setSensitivityDb(autoSensitivityRef.current.current)
      }
      return processed
    } catch (err) {
      console.error('[VoiceContext] Redutor de ruído (RNNoise) indisponível, seguindo sem ele:', err)
      noiseSuppressorRef.current = null
      return rawTrack
    }
  }

  // DÉCIMA SÉTIMA RODADA — equivalente de applyNoiseSuppression acima,
  // só que pro áudio da TRANSMISSÃO DE TELA em vez do microfone (ver
  // createScreenAudioDenoiser em lib/noiseSuppression.ts). Recebe a
  // track BRUTA (já resolvida por startAppAudioCapture ou
  // captureSystemAudioTrack) e devolve a versão filtrada — junto com
  // uma MediaStream própria pra ela (msid estável, sempre um objeto
  // NOVO por chamada, já que isso só roda uma vez por início/troca de
  // transmissão, nunca por frame). Se o WASM falhar por qualquer
  // motivo, cai pra bruta sem filtro — a transmissão nunca deve quebrar
  // por causa disso, só perde o reforço.
  async function prepareScreenAudioForSending(rawTrack: MediaStreamTrack): Promise<{ track: MediaStreamTrack; stream: MediaStream }> {
    // DÉCIMA NONA RODADA: opt-in agora (ver screenAudioNoiseSuppression
    // em useAudioSettings.ts) — desligado por padrão, porque o RNNoise
    // isola VOZ e trata qualquer som não-vocal do jogo (tiro, explosão,
    // música) como "ruído" a cortar. Sem a pessoa pedir explicitamente,
    // manda a track crua sem passar pelo denoiser.
    if (!audioSettingsRef.current.screenAudioNoiseSuppression) {
      teardownScreenAudioDenoiser()
      return { track: rawTrack, stream: new MediaStream([rawTrack]) }
    }
    try {
      screenAudioDenoiserRef.current?.destroy()
      screenAudioDenoiserRef.current = await createScreenAudioDenoiser()
      const processed = screenAudioDenoiserRef.current.setInputTrack(rawTrack)
      return { track: processed, stream: new MediaStream([processed]) }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      logDebug(`prepareScreenAudioForSending: redutor de ruído da transmissão indisponível, seguindo sem ele — ${detail}`)
      screenAudioDenoiserRef.current = null
      return { track: rawTrack, stream: new MediaStream([rawTrack]) }
    }
  }

  function teardownScreenAudioDenoiser() {
    screenAudioDenoiserRef.current?.destroy()
    screenAudioDenoiserRef.current = null
  }

  // Toca um efeito do soundboard localmente — igual a apps de chat populares, o áudio
  // é reproduzido direto pelo alto-falante de cada um (não é misturado
  // no microfone/mídia publicada). Usa o volume PRÓPRIO do soundboard
  // (soundboardVolume), não o volume geral da call — cada pessoa que
  // ESCUTA controla o quanto os efeitos tocam pra ela, sem depender de
  // quem enviou o som.
  // TRIGÉSIMA SÉTIMA RODADA — bug relatado: mexer no slider de "Volume
  // dos efeitos" enquanto um som JÁ estava tocando não tinha efeito
  // nenhum nele (só valia pro PRÓXIMO som a tocar) — porque o volume só
  // era lido uma vez, na hora de criar o elemento <audio>. Este Set
  // guarda todo elemento de áudio de efeito sonoro ATIVO agora; o
  // useEffect logo abaixo, que reage a mudanças em `soundboardVolume`,
  // atualiza o `.volume` de todos eles em tempo real.
  const activeSoundboardAudiosRef = useRef<Set<HTMLAudioElement>>(new Set())

  function playLocalSoundboardAudio(url: string) {
    if (!isAllowedSoundboardUrl(url)) {
      logDebug('playLocalSoundboardAudio: URL fora do bucket do soundboard recusada')
      return
    }
    // Anti-spam: com muitos efeitos já tocando, ignora os novos.
    if (activeSoundboardAudiosRef.current.size >= MAX_CONCURRENT_SOUNDBOARD) return
    try {
      const audio = new Audio(url)
      // Ref, não o estado: esta função é chamada pelo handler do Realtime
      // registrado dentro de join() — com o estado, os sons vindos dos
      // OUTROS tocavam sempre com o volume de quando você entrou na call.
      audio.volume = deafenedRef.current ? 0 : soundboardVolumeRef.current / 100
      // Respeita o alto-falante escolhido nas configurações (antes os
      // efeitos iam sempre pro dispositivo padrão do sistema).
      const sinkId = audioSettingsRef.current.speakerId
      const withSink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
      if (sinkId && withSink.setSinkId) withSink.setSinkId(sinkId).catch(() => {})
      activeSoundboardAudiosRef.current.add(audio)
      const forget = () => {
        activeSoundboardAudiosRef.current.delete(audio)
        // Solta o buffer do arquivo já tocado.
        audio.removeAttribute('src')
        audio.load()
      }
      audio.addEventListener('ended', forget, { once: true })
      audio.addEventListener('error', forget, { once: true })
      audio.play().catch(() => {
        // navegador pode bloquear play() sem interação recente — sem
        // problema, quem clicou no botão do som É a interação
        forget()
      })
    } catch {
      // fonte de áudio inválida/indisponível — não deveria travar a call
    }
  }

  // Ver o comentário grande em activeSoundboardAudiosRef acima — isso é
  // o que faz o slider de "Volume dos efeitos" valer NA HORA pra som que
  // já está tocando, não só pro próximo.
  useEffect(() => {
    activeSoundboardAudiosRef.current.forEach((audio) => {
      audio.volume = deafened ? 0 : soundboardVolume / 100
    })
  }, [soundboardVolume, deafened])

  // Toca o som pra MIM e avisa todo mundo mais no canal de voz pra
  // tocarem o mesmo som aí também — cada um busca e reproduz localmente,
  // em vez de misturar no stream de voz (senão quem está ouvindo o eco do
  // RNNoise/gate ouviria o som distorcido/cortado).
  //
  // Antes o aviso ia por um broadcast do Realtime com a URL no payload —
  // qualquer um que soubesse o id do canal (mesmo de fora do servidor)
  // conseguia mandar tocar qualquer arquivo do bucket pra todo mundo. Agora
  // passa pela RPC play_soundboard_sound (migration 016), que valida
  // acesso ao canal, castigo (timeout) e se o som é do MESMO servidor, e
  // grava em soundboard_plays; os outros recebem via postgres_changes (que
  // respeita a RLS) e resolvem a URL pelo id do som (ver o efeito logo
  // abaixo) — nada vindo do cliente de outra pessoa vira URL.
  async function playSoundboardSound(sound: SoundboardSoundRef): Promise<{ error: string | null }> {
    const channelId = connectedChannelIdRef.current
    if (!channelId || !connectedRef.current) return { error: 'Entre num canal de voz primeiro.' }
    const url = soundboardUrlFor(sound.storage_path)
    if (!isAllowedSoundboardUrl(url)) return { error: 'Som inválido.' }
    const rpcAny = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>
    const { error } = await rpcAny('play_soundboard_sound', { p_channel_id: channelId, p_sound_id: sound.id })
    if (error) return { error: error.message }
    playLocalSoundboardAudio(url)
    return { error: null }
  }

  // Sons tocados pelos OUTROS no canal de voz atual (soundboard_plays,
  // migration 016). O filtro por channel_id é só otimização — quem decide
  // se a linha chega é a RLS de SELECT da tabela.
  const connectedChannelIdRef = useRef<string | null>(null)
  connectedChannelIdRef.current = connectedChannelId
  useEffect(() => {
    if (!connectedChannelId || !connectedServerId) return
    const channelId = connectedChannelId
    const serverId = connectedServerId
    let cancelled = false
    let rt: RealtimeChannel | null = null
    void ensureRealtimeAuth().then(() => {
      if (cancelled) return
      rt = changesChannel(`soundboard_plays:${channelId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'soundboard_plays', filter: `channel_id=eq.${channelId}` },
          (payload) => {
            const row = payload.new as { sound_id?: unknown; played_by?: unknown; channel_id?: unknown }
            if (row.channel_id !== channelId || typeof row.sound_id !== 'string') return
            // Quem tocou já ouviu localmente.
            if (row.played_by === userIdRef.current) return
            void supabase
              .from('soundboard_sounds')
              .select('storage_path, server_id')
              .eq('id', row.sound_id)
              .maybeSingle()
              .then(({ data }) => {
                if (cancelled || !data || data.server_id !== serverId) return
                playLocalSoundboardAudio(soundboardUrlFor(data.storage_path))
              })
          }
        )
        .subscribe()
    })
    return () => {
      cancelled = true
      if (rt) void supabase.removeChannel(rt)
    }
    // playLocalSoundboardAudio só lê refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedChannelId, connectedServerId])

  // TRIGÉSIMA QUARTA RODADA — recalcula cameraStream/screenStream de um
  // participante remoto a partir das tracks mais recentes recebidas dele
  // por origem (Track.Source, ver remoteTracksRef acima). Isso substitui
  // de vez o antigo combineScreenStream + recomputeParticipant (que
  // dependiam de adivinhar, via um broadcast próprio, qual stream.id era
  // a tela) — o LiveKit já entrega essa informação pronta em cada
  // publicação, então não existe mais ambiguidade nenhuma pra resolver
  // aqui, só montar as duas MediaStreams combinadas que o resto do app
  // (CallMediaTiles.tsx) já espera.
  function recomputeParticipant(participantId: string) {
    const tracks = remoteTracksRef.current.get(participantId)
    if (!tracks) return
    const micTrack = tracks.get(Track.Source.Microphone) ?? null
    const cameraTrack = tracks.get(Track.Source.Camera) ?? null
    const screenVideoTrack = tracks.get(Track.Source.ScreenShare) ?? null
    const screenAudioTrack = tracks.get(Track.Source.ScreenShareAudio) ?? null

    // Memoiza pelos IDs das tracks atuais — sem isso, `recomputeParticipant`
    // rodando de novo sem nada ter mudado de verdade criaria uma
    // MediaStream NOVA a cada chamada, e com ela reiniciaria qualquer
    // elemento <video>/<audio> que dependa da identidade do objeto (ver
    // CallMediaTiles.tsx).
    const trackIds = `${micTrack?.id ?? ''}|${cameraTrack?.id ?? ''}|${screenVideoTrack?.id ?? ''}|${screenAudioTrack?.id ?? ''}`
    const cached = combinedStreamsRef.current.get(participantId)
    if (cached && cached.trackIds === trackIds) return

    // cameraStream carrega o áudio do MICROFONE (sempre, se a pessoa
    // estiver com o mic publicado) + o vídeo da CÂMERA quando ligada —
    // mantém o mesmo nome/formato que o resto do app (CallMediaTiles.tsx,
    // VoiceChannelView.tsx) já espera, apesar do nome sugerir só vídeo:
    // era assim mesmo antes da migração (a mesma MediaStream do
    // getUserMedia carregava as duas).
    const cameraTracks = [micTrack, cameraTrack].filter((t): t is MediaStreamTrack => Boolean(t))
    const camera = cameraTracks.length > 0 ? new MediaStream(cameraTracks) : null

    const screenTracks = [screenVideoTrack, screenAudioTrack].filter((t): t is MediaStreamTrack => Boolean(t))
    const screen = screenTracks.length > 0 ? new MediaStream(screenTracks) : null

    // Reaproveita a stream só-áudio anterior se a track de áudio não
    // mudou (ver VoiceParticipant.micAudioStream).
    const reuseAudio = (prevStream: MediaStream | null | undefined, track: MediaStreamTrack | null) => {
      if (!track) return null
      if (prevStream && prevStream.getAudioTracks()[0] === track) return prevStream
      return new MediaStream([track])
    }
    const micAudio = reuseAudio(cached?.micAudio, micTrack)
    const screenAudio = reuseAudio(cached?.screenAudio, screenAudioTrack)

    combinedStreamsRef.current.set(participantId, { camera, screen, micAudio, screenAudio, trackIds })
    setParticipants((prev) => ({
      ...prev,
      [participantId]: {
        userId: participantId,
        speaking: prev[participantId]?.speaking ?? false,
        cameraStream: camera,
        screenStream: screen,
        micAudioStream: micAudio,
        screenAudioStream: screenAudio,
      },
    }))
  }

  function setRemoteTrack(participantId: string, source: Track.Source, track: MediaStreamTrack | null) {
    if (!remoteTracksRef.current.has(participantId)) remoteTracksRef.current.set(participantId, new Map())
    const tracks = remoteTracksRef.current.get(participantId)!
    if (track) tracks.set(source, track)
    else tracks.delete(source)
    recomputeParticipant(participantId)
  }

  // TRIGÉSIMA SEXTA RODADA — bug relatado: às vezes duas pessoas na
  // call simplesmente não se ouviam. Causa provável: antes (mesh de
  // RTCPeerConnection), o sender de ÁUDIO do microfone tinha
  // `priority`/`networkPriority` = 'high' setado na mão em cada peer
  // (ver o comentário grande que existia em createPeerConnection) —
  // isso pede pro navegador tratar pacotes de voz como mais urgentes
  // que outros tipos de tráfego (ex.: vídeo da transmissão de tela)
  // quando o upload está congestionado. Na migração pro LiveKit isso
  // ficou de fora sem querer — o TrackPublishOptions do LiveKit não
  // tem um campo direto pra isso, mas a publicação AINDA usa um
  // RTCRtpSender de verdade por baixo (exposto via `track.sender`),
  // então dá pra aplicar o mesmo ajuste na mão, só que uma vez, aqui.
  // Sem isso, numa call com transmissão de tela ativa e upload
  // apertado, os pacotes de voz podiam ficar competindo com os de
  // vídeo e chegando atrasados/perdidos — o que bate exatamente com
  // "às vezes não se ouvem".
  function applyMicSenderPriority() {
    const sender = (micPublicationRef.current?.track as LocalAudioTrack | undefined)?.sender
    if (!sender) return
    try {
      const params = sender.getParameters()
      params.encodings = params.encodings?.length ? params.encodings : [{}]
      if ('priority' in params.encodings[0]) {
        ;(params.encodings[0] as RTCRtpEncodingParameters & { priority?: string }).priority = 'high'
      }
      if ('networkPriority' in params.encodings[0]) {
        ;(params.encodings[0] as RTCRtpEncodingParameters & { networkPriority?: string }).networkPriority = 'high'
      }
      sender.setParameters(params).catch(() => {})
    } catch {
      // navegador sem suporte a esse ajuste — sem problema, só não aplica
    }
  }

  function mapConnectionQuality(quality: LiveKitConnectionQuality): VoiceConnectionQuality {
    switch (quality) {
      case LiveKitConnectionQuality.Excellent:
        return 'excellent'
      case LiveKitConnectionQuality.Good:
        return 'good'
      case LiveKitConnectionQuality.Poor:
        return 'poor'
      default:
        return 'lost'
    }
  }

  // Liga todos os eventos da sala do LiveKit numa conexão nova — chamado
  // uma vez, dentro de join(), logo depois do `room.connect()`. Substitui
  // de vez a sinalização manual que existia antes (handleSignal,
  // createPeerConnection, ensurePeer, cleanupPeer): o LiveKit já entrega
  // "fulano entrou", "fulano saiu", "chegou uma track nova de fulano" e
  // "fulano está falando" prontos, sem precisar negociar nada na mão.
  function attachRoomEvents(room: Room, myId: string) {
    // AUDITORIA DE VOZ — todo handler abaixo ignora eventos de uma sala
    // que já não é a atual. Motivo real: `room.disconnect()` (chamado por
    // leave()) é assíncrono e, ao terminar, o LiveKit emite
    // TrackUnsubscribed pra cada track remota — isso chegava DEPOIS de
    // leave() ter zerado `participants`, e `setRemoteTrack` recriava
    // participantes "fantasma" (sem stream) no estado. Na call seguinte
    // eles apareciam como se estivessem na sala nova. Idem pra uma sala
    // de uma tentativa de join() abortada: o evento Disconnected dela
    // podia chamar leave() e derrubar a call NOVA.
    const isCurrent = () => roomRef.current === room

    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      if (!isCurrent() || participant.identity === myId) return
      playUserJoinSound()
    })

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      if (!isCurrent()) return
      remoteTracksRef.current.delete(participant.identity)
      combinedStreamsRef.current.delete(participant.identity)
      setParticipants((prev) => {
        if (!(participant.identity in prev)) return prev
        const next = { ...prev }
        delete next[participant.identity]
        return next
      })
      setConnectionQuality((prev) => {
        if (!(participant.identity in prev)) return prev
        const next = { ...prev }
        delete next[participant.identity]
        return next
      })
      playUserLeaveSound()
    })

    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (!isCurrent()) return
        // Log só no console (não no arquivo de debug via logDebug, que é
        // console.error + IPC síncrono de escrita em disco a cada track).
        console.debug(`[VoiceContext] TrackSubscribed de ${participant.identity}: source=${track.source}, kind=${track.kind}`)
        setRemoteTrack(participant.identity, track.source, track.mediaStreamTrack)
      }
    )

    room.on(
      RoomEvent.TrackUnsubscribed,
      (_track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (!isCurrent()) return
        setRemoteTrack(participant.identity, publication.source, null)
      }
    )

    // Substitui o antigo polling de AnalyserNode por participante (ver o
    // comentário grande em remoteTracksRef acima) — o LiveKit já faz essa
    // detecção nativamente e manda a lista de quem está falando AGORA,
    // sempre que ela muda.
    //
    // TRIGÉSIMA OITAVA RODADA — bug relatado: a "luz" de quem está
    // falando demorava pra acender pro PRÓPRIO usuário. Causa: esse
    // evento do LiveKit é calculado em cima do áudio que já chegou no
    // servidor (viaja rede até lá, servidor processa, e só então volta
    // o aviso pra todo mundo, incluindo quem falou) — um ciclo de rede
    // inteiro de atraso, perceptível mesmo em conexão boa. Pros
    // participantes REMOTOS não tem jeito melhor (a única forma de saber
    // se o outro está falando é o servidor avisar), mas pro usuário
    // LOCAL dá pra medir o próprio microfone na hora, sem esperar
    // ninguém — é o que `setupLocalSpeakingDetection` faz mais abaixo,
    // lendo o volume direto do AnalyserNode local. Por isso aqui ignora
    // `myId`: o estado do usuário local passa a ser controlado só por
    // aquela detecção local (instantânea), nunca mais por este evento
    // de rede (que ficaria brigando com ela e reintroduzindo o atraso).
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      if (!isCurrent()) return
      const speakingIds = new Set(speakers.map((s) => s.identity))
      setParticipants((prev) => {
        let changed = false
        const next: typeof prev = { ...prev }
        for (const id of Object.keys(next)) {
          const isSpeaking = speakingIds.has(id)
          if (next[id].speaking !== isSpeaking) {
            next[id] = { ...next[id], speaking: isSpeaking }
            changed = true
          }
        }
        return changed ? next : prev
      })
    })

    // Ver VoiceConnectionQuality acima pro porquê disso não ser mais um
    // número de latência em milissegundos — com um SFU, a única latência
    // que faz sentido medir é a de cada um até o SERVIDOR, não "até
    // fulano".
    room.on(
      RoomEvent.ConnectionQualityChanged,
      (quality: LiveKitConnectionQuality, participant: Participant) => {
        if (!isCurrent()) return
        if (participant.identity === myId) {
          setLocalConnectionQuality(mapConnectionQuality(quality))
          return
        }
        setConnectionQuality((prev) => ({ ...prev, [participant.identity]: mapConnectionQuality(quality) }))
      }
    )

    // Queda breve de rede: o LiveKit tenta se reconectar sozinho (ICE
    // restart / resume) antes de desistir. Antes nada disso aparecia na
    // tela — a call simplesmente "congelava" em silêncio por alguns
    // segundos sem explicação.
    room.on(RoomEvent.Reconnecting, () => {
      if (!isCurrent()) return
      logDebug('LiveKit: reconectando...')
      setReconnecting(true)
      setLocalConnectionQuality('lost')
    })
    room.on(RoomEvent.Reconnected, () => {
      if (!isCurrent()) return
      logDebug('LiveKit: reconectado')
      setReconnecting(false)
      setLocalConnectionQuality(mapConnectionQuality(room.localParticipant.connectionQuality))
      // Uma reconexão completa recria o RTCRtpSender do microfone — a
      // prioridade alta de rede aplicada na mão precisa ser refeita.
      applyMicSenderPriority()
    })

    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      // Desconexão vinda do SERVIDOR (não de um leave() nosso — esse já
      // chama room.disconnect() e limpa tudo por conta própria antes
      // disso disparar) — ex.: LiveKit derrubou a sessão, ou a rede caiu
      // de vez. Trata como uma saída normal pra não deixar a UI presa
      // num estado "conectado" que não reflete mais a realidade.
      if (!isCurrent() || !connectedRef.current) return
      logDebug(`LiveKit: desconectado pelo servidor/rede (motivo=${reason ?? 'desconhecido'})`)
      const message =
        reason === DisconnectReason.DUPLICATE_IDENTITY
          ? 'Você entrou nesse canal de voz em outro dispositivo/janela — esta conexão foi encerrada.'
          : reason === DisconnectReason.PARTICIPANT_REMOVED
            ? 'Você foi removido do canal de voz.'
            : reason === DisconnectReason.ROOM_DELETED
              ? 'O canal de voz foi encerrado.'
              : 'A conexão com o canal de voz caiu. Verifique sua internet e entre de novo.'
      leave()
      setError(message)
    })
  }

  // AUDITORIA DE VOZ — controle de concorrência do join():
  //  - `joinInFlightRef` impede DOIS join() em paralelo (duplo clique,
  //    clicar em outro canal enquanto o primeiro ainda conecta, AFK +
  //    clique manual). Antes só `connectedRef` era checado, que só vira
  //    true no FIM do join — dois cliques rápidos capturavam o microfone
  //    duas vezes e abriam duas salas do LiveKit, e uma delas vazava
  //    (mic aceso, sala conectada sem ninguém saber).
  //  - `joinSeqRef` é um "número da tentativa": leave() incrementa, e o
  //    join() em andamento confere depois de cada `await` se ainda é a
  //    tentativa atual. Antes, clicar em "Sair" durante o "Conectando..."
  //    não cancelava nada: o join terminava sozinho logo depois e a
  //    pessoa acabava CONECTADA mesmo tendo saído.
  const joinSeqRef = useRef(0)
  const joinInFlightRef = useRef(false)

  const join = useCallback(async (channelId: string, serverId: string | null, options?: { displayName?: string; userLimit?: number }) => {
    if (!user || connectedRef.current || joinInFlightRef.current) return
    joinInFlightRef.current = true
    const seq = ++joinSeqRef.current
    const isStale = () => joinSeqRef.current !== seq
    // `abandoned`: esta tentativa já falhou (caiu no catch) — etapas
    // paralelas que ainda estão rodando (ex.: a presença, cujo timeout
    // venceu) não devem mais criar nada.
    let abandoned = false
    const assertActive = () => {
      if (isStale() || abandoned) throw new JoinAbortedError()
    }

    // Avisa a UI (a lista de canais) IMEDIATAMENTE que estamos prestes a
    // entrar nesse canal, antes de qualquer trabalho assíncrono — isso dá
    // tempo do observador de presença na barra lateral (useVoicePresence)
    // se desinscrever do mesmo canal Realtime ANTES da gente tentar se
    // inscrever de verdade nele.
    setJoiningChannelId(channelId)
    setConnecting(true)
    setError(null)
    // Garante que não sobra nenhum participante/qualidade de uma call
    // anterior (ver o comentário em attachRoomEvents sobre "fantasmas").
    setParticipants({})
    setConnectionQuality({})
    remoteTracksRef.current.clear()
    combinedStreamsRef.current.clear()
    joinedAtRef.current = Date.now()

    // Recursos criados por ESTA tentativa — só vão pros refs globais no
    // "commit" (depois que tudo deu certo). Assim uma tentativa abortada
    // limpa só o que é dela, sem risco de derrubar uma tentativa NOVA.
    type MicResult = {
      stream: MediaStream
      raw: MediaStreamTrack
      processed: MediaStreamTrack
      suppressor: NoiseSuppressor | null
      usedFallback: boolean
    }
    const presence: { channel: RealtimeChannel | null } = { channel: null }
    let room: Room | null = null
    let micCommitted = false

    // Microfone + RNNoise montados LOCALMENTE (sem tocar em
    // rawMicTrackRef/noiseSuppressorRef até o commit).
    const micInner: Promise<MicResult> = (async () => {
      logDebug(`join(${channelId}): pedindo microfone...`)
      const { stream, usedFallback } = await getMicStreamWithFallback(audioSettingsRef.current.getAudioConstraints())
      const raw = stream.getAudioTracks()[0]
      let processed = raw
      let suppressor: NoiseSuppressor | null = null
      {
        try {
          suppressor = await createNoiseSuppressor()
          const mode = audioSettingsRef.current.micSensitivityMode
          processed = suppressor.setInputTrack(raw, mode === 'auto' ? DEFAULT_MIC_SENSITIVITY : audioSettingsRef.current.micSensitivity, {
            denoise: audioSettingsRef.current.noiseSuppression,
          })
        } catch (err) {
          console.error('[VoiceContext] Redutor de ruído (RNNoise) indisponível, seguindo sem ele:', err)
          suppressor?.destroy()
          suppressor = null
          processed = raw
        }
      }
      if (processed !== raw) {
        stream.removeTrack(raw)
        stream.addTrack(processed)
      }
      logDebug(`join(${channelId}): microfone pronto.`)
      return { stream, raw, processed, suppressor, usedFallback }
    })()
    const disposeMic = (mic: MicResult) => {
      mic.stream.getTracks().forEach((t) => t.stop())
      mic.raw.stop()
      mic.suppressor?.destroy()
      if (rawMicTrackRef.current === mic.raw) rawMicTrackRef.current = null
      if (noiseSuppressorRef.current === mic.suppressor) noiseSuppressorRef.current = null
      if (localStreamRef.current === mic.stream) {
        localStreamRef.current = null
        teardownLocalSpeakingDetection()
      }
    }

    try {
      // Ver o comentário grande em leaveTeardownRef — espera o
      // desligamento em segundo plano de uma saída recente terminar antes
      // de assinar o MESMO tópico Realtime de novo (o mic já está sendo
      // pedido em paralelo acima, então isso não atrasa a entrada).
      if (leaveTeardownRef.current) await leaveTeardownRef.current
      assertActive()

      // Nome/limite do canal — em paralelo com mic e presença; só o
      // pedido de token depende dele. (Antes gravava num ref global
      // `channelUserLimitRef`, que uma tentativa concorrente podia
      // sobrescrever.) Se a RLS bloquear (expulso/banido), falha JÁ AQUI
      // com uma mensagem clara.
      const channelInfoPromise = (async () => {
        if (serverId) {
          const { data: channelRow, error: channelErr } = await supabase
            .from('channels')
            .select('user_limit, name')
            .eq('id', channelId)
            .single()
          if (channelErr || !channelRow) {
            throw new Error('Você não tem mais acesso a esse canal de voz.')
          }
          if (!isStale()) setConnectedChannelName(channelRow.name ?? null)
          return { userLimit: channelRow.user_limit ?? 0 }
        }
        if (!isStale()) setConnectedChannelName(options?.displayName ?? null)
        return { userLimit: options?.userLimit ?? 0 }
      })()

      const micPromise = withTimeout(micInner, 20_000, 'acesso ao microfone')

      // Canal Realtime do Supabase — hoje serve só pra (1) anunciar "estou
      // nesse canal de voz" pra sidebar (ver useVoicePresence.ts) e (2) o
      // broadcast do soundboard. Precisa ser um canal 100% NOVO com nossa
      // própria key de presença (`user.id`) — o da sidebar usa uma key
      // `observer-...` e reaproveitá-lo nos esconderia da lista. Como o
      // cliente Realtime reaproveita o objeto de canal por tópico (e
      // `.subscribe()` num canal já inscrito é NO-OP silencioso — era a
      // causa do "Conectando..." eterno), remove o duplicado antes.
      const topic = `voice:${channelId}`
      logDebug(`join(${channelId}): inscrevendo no canal de presença...`)
      const presencePromise = withTimeout(
        (async () => {
          const existingChannel = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
          if (existingChannel && existingChannel.state !== 'closed') {
            logDebug(`join(${channelId}): removendo canal de presença duplicado (estado anterior: ${existingChannel.state})...`)
            await supabase.removeChannel(existingChannel)
          }
          assertActive()
          // Canal PRIVADO (migration 016): o Realtime só aceita quem pode
          // ver este canal de voz (ou participa do grupo/DM). O soundboard
          // não passa mais por aqui (ver playSoundboardSound).
          await ensureRealtimeAuth()
          assertActive()
          const rt = supabase.channel(topic, privateChannelParams({ config: { presence: { key: user.id } } }))
          presence.channel = rt

          // Tempo da SALA (não o seu): cada pessoa anuncia o "início da
          // sala" que conhece; quem entra herda o menor entre os presentes.
          // Assim o tempo conta desde a primeira pessoa que chegou e só
          // zera quando TODO mundo sair.
          let myRoomStart = joinedAtRef.current
          rt.on('presence', { event: 'sync' }, () => {
            if (isStale()) return
            const state = rt.presenceState() as Record<string, { room_started_at?: number; joined_at?: number }[]>
            let min = myRoomStart
            for (const [key, metas] of Object.entries(state)) {
              if (key.startsWith('observer-')) continue
              for (const m of metas) {
                const t = Number(m.room_started_at ?? m.joined_at)
                if (Number.isFinite(t) && t > 0 && t < min) min = t
              }
            }
            if (min < myRoomStart) {
              myRoomStart = min
              void rt.track({ user_id: user.id, joined_at: joinedAtRef.current, room_started_at: myRoomStart }).catch(() => {})
            }
            setRoomStartedAt(myRoomStart)
          })

          await new Promise<void>((resolve, reject) => {
            rt.subscribe((status) => {
              logDebug(`join(${channelId}): status do canal de presença = ${status}`)
              if (status === 'SUBSCRIBED') {
                rt.track({ user_id: user.id, joined_at: joinedAtRef.current, room_started_at: myRoomStart })
                  .then(() => {
                    logDebug(`join(${channelId}): presença anunciada.`)
                    resolve()
                  })
                  .catch(reject)
              }
              if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                reject(new Error('Falha ao conectar ao canal de voz.'))
              }
            })
          })
        })(),
        15_000,
        'canal de presença'
      )

      // Token do LiveKit — o servidor confere acesso, limite de vagas e
      // permissão de falar (canal Palco). `name` não é mais enviado: era
      // `options.displayName`, que numa DM é o nome da OUTRA pessoa (o
      // título da conversa), não o seu — a identidade já é o user.id.
      // DESEMPENHO: não espera mais a consulta do canal — pra canal de
      // servidor a Edge Function lê o limite de vagas direto do banco, e
      // pra DM/grupo o limite já vem em `options`. A consulta do canal
      // continua em paralelo (nome na tela + mensagem clara se a pessoa
      // perdeu o acesso).
      logDebug(`join(${channelId}): pedindo token do LiveKit...`)
      const tokenPromise = withTimeout(
        takeLiveKitToken(channelId, serverId ? 0 : (options?.userLimit ?? 0)),
        15_000,
        'pedido de token do LiveKit'
      )

      // Pré-aquecimento da conexão (docs/PING.md): assim que o token chega —
      // em paralelo com microfone e presença — a sala resolve DNS/TLS e, no
      // LiveKit Cloud, escolhe o data center mais próximo (São Paulo, pra
      // quem está no Brasil). O connect() abaixo já começa "quente".
      const preparedRoom = createVoiceRoom()
      const preparePromise = tokenPromise
        .then((tok) => {
          rememberLiveKitUrl(tok.url)
          return preparedRoom.prepareConnection(tok.url, tok.token)
        })
        .catch(() => {})

      // DESEMPENHO: a presença (sidebar "quem está na sala") não segura
      // mais a entrada — só microfone, acesso ao canal e token. Se ela
      // falhar depois, a call continua e o erro fica no log.
      presencePromise.catch((err) => {
        logDebug(`join(${channelId}): presença falhou (a call segue) — ${err instanceof Error ? err.message : String(err)}`)
      })
      // DESEMPENHO: conecta na sala assim que acesso + token estiverem ok —
      // o microfone (permissão + redutor de ruído) termina de preparar EM
      // PARALELO com a conexão, e só é esperado depois dela.
      const [, tokenResult] = await Promise.all([channelInfoPromise, tokenPromise])
      assertActive()
      logDebug(`join(${channelId}): mic + presença + token todos prontos, conectando na sala LiveKit (${tokenResult.url})...`)

      // (Opções da sala em createVoiceRoom.) adaptiveStream DESLIGADO de propósito (era `true`): o
      // adaptiveStream do LiveKit decide a qualidade/pausa de cada vídeo
      // remoto observando os elementos <video> ligados via
      // `track.attach()` — só que este app usa a MediaStreamTrack crua
      // (ver recomputeParticipant/CallMediaTiles.tsx), nunca attach().
      // Sem nenhum elemento "visível" registrado, o LiveKit considerava
      // TODO vídeo remoto invisível e pedia pro servidor PAUSAR o envio
      // (documentado no próprio `mediaStreamTrack` do RemoteVideoTrack:
      // "your video tracks might never start") — câmera/tela dos outros
      // podiam simplesmente não aparecer ou congelar. `dynacast`
      // continua: ele é do lado de quem PUBLICA (para de codificar
      // camadas que ninguém está assistindo) e não depende disso.
      // Criada lá em cima (createVoiceRoom), assim que o token chegou, pra
      // já ter feito o prepareConnection — ver docs/PING.md.
      room = preparedRoom
      // Dá até 300ms pro pré-aquecimento terminar (normalmente já terminou);
      // não trava a entrada além disso.
      await Promise.race([preparePromise, new Promise((resolve) => setTimeout(resolve, 300))])
      assertActive()
      // roomRef recebe a sala ANTES do connect: assim um leave() durante
      // o handshake desconecta ESTA sala (connect rejeita na hora) em vez
      // de esperar os 15s do timeout, e os handlers de evento já sabem
      // que ela é a "atual".
      roomRef.current = room
      attachRoomEvents(room, user.id)
      await withTimeout(room.connect(tokenResult.url, tokenResult.token), 15_000, 'conexão com o servidor de voz')
      assertActive()
      setActiveVoiceRoom(room)
      const mic = await micPromise
      assertActive()

      // Commit do microfone nos refs globais.
      micCommitted = true
      localStreamRef.current = mic.stream
      rawMicTrackRef.current = mic.raw
      noiseSuppressorRef.current?.destroy()
      noiseSuppressorRef.current = mic.suppressor
      resetAutoSensitivity()
      watchRawMicTrack(mic.raw)
      // O mudo escolhido ANTES de entrar (ou na call anterior) continua
      // valendo — antes entrar na sala sempre desmutava sozinho.
      // A presença pode ainda estar se inscrevendo: o canal é criado de
      // forma síncrona depois do ensureRealtimeAuth(), então registra
      // quando ficar pronto (e descarta se esta entrada já foi cancelada).
      if (presence.channel) presenceRef.current = presence.channel
      else
        void presencePromise.then(
          () => {
            if (!presence.channel) return
            if (isStale() || abandoned) {
              void supabase.removeChannel(presence.channel).catch(() => {})
            } else {
              presenceRef.current = presence.channel
            }
          },
          () => {}
        )


      const allowedToPublish = tokenResult.canPublish && room.localParticipant.permissions?.canPublish !== false
      setCanPublish(allowedToPublish)
      if (allowedToPublish) {
        logDebug(`join(${channelId}): conectado na sala LiveKit, publicando microfone...`)
        setupLocalSpeakingDetection(mic.stream)
        // Publica o microfone (já tratado pelo RNNoise/gate).
        micPublicationRef.current = await withTimeout(
          room.localParticipant.publishTrack(mic.processed, {
            name: 'microphone',
            source: Track.Source.Microphone,
            audioPreset: { maxBitrate: MIC_MAX_BITRATE },
          }),
          15_000,
          'publicação do microfone'
        )
        assertActive()
        // O LiveKit reescreve `track.enabled` ao publicar/trocar track
        // (sincroniza com o próprio estado de mute dele) — reaplica o
        // estado real (mute + push-to-talk) DEPOIS, senão com
        // push-to-talk ligado o mic começava ABERTO até a 1ª tecla.
        applyMicEnabledState(pushToTalkActiveRef.current)
        if (mutedRef.current) {
          ;(micPublicationRef.current?.track as LocalAudioTrack | undefined)?.mute().catch(() => {})
        }
        applyMicSenderPriority()
      } else {
        // Ouvinte (canal Palco sem permissão de falar): não precisa do
        // microfone — solta o dispositivo (luz do mic apaga) e entra mudo.
        logDebug(`join(${channelId}): conectado como OUVINTE (sem permissão de publicar).`)
        disposeMic(mic)
        localStreamRef.current = new MediaStream()
        mutedRef.current = true
        setMuted(true)
      }
      logDebug(`join(${channelId}): entrada concluída.`)

      connectedRef.current = true
      setConnectedChannelId(channelId)
      setConnectedServerId(serverId)
      setConnectedAt(Date.now())
      setReconnecting(false)
      if (mic.usedFallback && allowedToPublish) {
        setError('O microfone escolhido nas configurações não está disponível — usando o microfone padrão do sistema.')
      }
      playConnectSound()
    } catch (err) {
      abandoned = true
      const aborted = err instanceof JoinAbortedError || isStale()
      const isRoomFull = err instanceof Error && err.name === 'RoomFullError'
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      logDebug(`join(${channelId}): ${aborted ? 'cancelado' : 'falhou'} — ${detail}`)
      if (!aborted) {
        setError(
          isRoomFull
            ? 'Esse canal de voz já está cheio.'
            : (describeMicError(err) ??
                // Mostra a mensagem REAL (ex.: vinda da Edge Function, ver
                // lib/livekit.ts) em vez de um texto genérico.
                (err instanceof Error && err.message ? err.message : 'Não foi possível entrar no canal de voz.'))
        )
      }
      // Limpa SÓ o que esta tentativa criou.
      if (room) {
        if (roomRef.current === room) {
          roomRef.current = null
          micPublicationRef.current = null
          setActiveVoiceRoom(null)
        }
        void room.disconnect()
      }
      if (presence.channel) {
        const channelToRemove = presence.channel
        if (presenceRef.current === channelToRemove) presenceRef.current = null
        void supabase.removeChannel(channelToRemove).catch(() => {})
      }
      // O microfone pode ainda nem ter chegado (ex.: o token falhou
      // primeiro) — quando chegar, é descartado; antes ele ficava ABERTO
      // pra sempre (luz do mic acesa sem call nenhuma).
      micInner.then(disposeMic, () => {})
      if (micCommitted && !isStale()) {
        // Falhou DEPOIS do commit (ex.: connect/publish) — solta também o
        // que já estava nos refs globais (inclui o stream vazio de ouvinte).
        localStreamRef.current?.getTracks().forEach((t) => t.stop())
        localStreamRef.current = null
        teardownLocalSpeakingDetection()
        setCanPublish(true)
      }
      if (!aborted) {
        mutedRef.current = false
        setMuted(false)
      }
    } finally {
      if (!isStale()) {
        joinInFlightRef.current = false
        setConnecting(false)
        setJoiningChannelId(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const leave = useCallback(() => {
    const wasConnected = connectedRef.current
    // Cancela qualquer join() em andamento (ver joinSeqRef).
    joinSeqRef.current++
    joinInFlightRef.current = false
    // Encerra a transmissão de tela ANTES de soltar a sala — antes, sair
    // da call compartilhando tela só parava o vídeo: o processo nativo de
    // captura de áudio por app continuava rodando, o loopback de áudio do
    // sistema continuava aberto (indicador do Windows aceso), o
    // AudioContext do redutor de ruído da transmissão vazava e o vigia de
    // foco/fechamento do jogo continuava ativo.
    if (screenStreamRef.current || appAudioPlayerRef.current || systemAudioTrackRef.current) {
      stopScreenShareState()
    }
    screenShareOpRef.current = false
    setScreenShareConnecting(false)
    if (roomRef.current) {
      // Desconecta a sala do LiveKit — isso já para/despublica todas as
      // tracks locais sozinho (mic, câmera, tela), mas paramos elas
      // explicitamente também logo abaixo (idempotente, sem custo) pra
      // garantir que o dispositivo físico (luzinha do mic/câmera) seja
      // liberado mesmo se a desconexão em si falhar por algum motivo.
      // roomRef é zerado ANTES do disconnect: os eventos que o LiveKit
      // emite durante o disconnect são ignorados (ver attachRoomEvents).
      const roomToClose = roomRef.current
      roomRef.current = null
      setActiveVoiceRoom(null)
      void roomToClose.disconnect().finally(() => roomToClose.removeAllListeners())
    }
    micPublicationRef.current = null
    cameraPublicationRef.current = null
    screenVideoPublicationRef.current = null
    screenAudioPublicationRef.current = null
    remoteTracksRef.current.clear()
    combinedStreamsRef.current.clear()
    teardownLocalSpeakingDetection()
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    // A track dentro de localStreamRef pode ser a SAÍDA do RNNoise, não
    // o microfone físico em si — sem parar a track bruta separadamente
    // aqui, o dispositivo continuaria "preso" (luzinha do mic acesa)
    // mesmo depois de sair da call.
    rawMicTrackRef.current?.stop()
    rawMicTrackRef.current = null
    noiseSuppressorRef.current?.destroy()
    noiseSuppressorRef.current = null
    resetAutoSensitivity()
    gameShareWatchRef.current?.()
    gameShareWatchRef.current = null
    setLocalScreenStream(null)
    if (presenceRef.current) {
      const channelToLeave = presenceRef.current
      // Ver o comentário grande em leaveTeardownRef acima — o
      // desligamento de verdade (dois round-trips até o servidor) roda
      // em segundo plano, sem atrasar nada do que a UI mostra aqui
      // embaixo (tudo isso continua síncrono); só uma reentrada rápida
      // no MESMO canal (join()) espera essa Promise terminar antes de
      // assinar o tópico de novo.
      const teardown = (async () => {
        try {
          await channelToLeave.untrack()
        } catch {
          // best-effort — segue pro removeChannel de qualquer jeito
        }
        try {
          await supabase.removeChannel(channelToLeave)
        } catch {
          // best-effort — pior caso, o canal fica orfão até o socket cair sozinho
        }
      })()
      leaveTeardownRef.current = teardown
      teardown.finally(() => {
        if (leaveTeardownRef.current === teardown) leaveTeardownRef.current = null
      })
      presenceRef.current = null
    }
    setParticipants({})
    setConnectionQuality({})
    setLocalConnectionQuality(null)
    setReconnecting(false)
    setCanPublish(true)
    connectedRef.current = false
    setConnectedChannelId(null)
    setConnectedChannelName(null)
    setConnectedServerId(null)
    setConnectedAt(null)
    setRoomStartedAt(null)
    setConnecting(false)
    setJoiningChannelId(null)
    // Mudo e "áudio desativado" continuam como a pessoa deixou (igual
    // apps de chat populares) — valem pra próxima call também.
    setVideoEnabled(false)
    setLocalCameraStream(null)
    setScreenSharing(false)
    setSpeaking(false)
    setPushToTalkActive(false)
    if (wasConnected) playDisconnectSound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Só desconecta quando o Provider inteiro desmonta (ex: logout) —
  // NÃO reage a troca de canal/servidor visualizado, que é exatamente o
  // comportamento que corrige o bug de "sair da call ao trocar de tela".
  useEffect(() => {
    return () => {
      // Também cancela uma entrada AINDA em andamento (logout durante o
      // "Conectando...") — antes ela terminava sozinha depois do
      // provider desmontado, deixando mic e sala do LiveKit abertos.
      if (connectedRef.current || joinInFlightRef.current) leave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // TRIGÉSIMA QUARTA RODADA — o polling de getStats() por peer que
  // existia aqui foi removido: com o LiveKit, a qualidade de conexão de
  // cada participante já chega pronta via RoomEvent.ConnectionQualityChanged
  // (ligado em attachRoomEvents, dentro de join()) sempre que muda, sem
  // precisar perguntar de 5 em 5 segundos.

  // --- Sensibilidade automática do microfone --------------------------
  // Só faz alguma coisa quando o modo é 'auto' (ver useAudioSettings.ts
  // e o toggle em SettingsModal.tsx). A cada segundo, lê o nível de
  // áudio já tratado pelo RNNoise mas ainda ANTES do gate
  // (`sampleLevelDb()` — ver o comentário sobre esse ponto de leitura em
  // noiseSuppression.ts, escolhido de propósito pra não entrar num loop
  // onde um gate fechado faz o nível parecer silêncio total) e mantém
  // uma estimativa do "piso de ruído" da sala com uma média móvel
  // assimétrica: quando a leitura é MENOR que o piso atual, o piso desce
  // rápido (reconhece rápido um ambiente mais silencioso); quando é
  // MAIOR, o piso sobe bem devagar (fala normal — que é bem mais alta
  // que o ruído de fundo — não deveria "convencer" o piso de que o
  // ambiente ficou mais barulhento). O limiar do gate vira sempre
  // `piso + margem fixa de 12dB`, clampado num intervalo razoável.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!connectedRef.current) return
      if (audioSettingsRef.current.micSensitivityMode !== 'auto') return
      const suppressor = noiseSuppressorRef.current
      if (!suppressor) return
      const level = suppressor.sampleLevelDb()
      if (level === null) return

      const threshold = autoSensitivityRef.current.push(level)
      if (threshold !== null) suppressor.setSensitivityDb(threshold)
    }, AUTO_SENSITIVITY_TICK_MS)
    return () => clearInterval(interval)
  }, [])

  // --- Canal AFK: move automaticamente quem fica inativo -------------
  const afkConfigRef = useRef<{ channelId: string | null; timeoutMinutes: number } | null>(null)
  const lastActivityRef = useRef(Date.now())

  // Quem entra na sala AFK (sozinho ou mandado pelo app) fica mudo. Ao
  // sair dela pra outra sala, o microfone volta como estava antes.
  const afkForcedMuteRef = useRef<{ wasMuted: boolean } | null>(null)
  const enforceAfkMute = useCallback(() => {
    const afkId = afkConfigRef.current?.channelId
    const inAfk = Boolean(afkId && connectedChannelIdRef.current === afkId)
    if (inAfk) {
      if (!afkForcedMuteRef.current) afkForcedMuteRef.current = { wasMuted: mutedRef.current }
      if (!mutedRef.current) toggleMuteRef.current?.({ silent: true })
    } else if (afkForcedMuteRef.current && connectedChannelIdRef.current) {
      const { wasMuted } = afkForcedMuteRef.current
      afkForcedMuteRef.current = null
      if (!wasMuted && mutedRef.current) toggleMuteRef.current?.({ silent: true })
    }
  }, [])
  const toggleMuteRef = useRef<((opts?: { silent?: boolean }) => void) | null>(null)

  useEffect(() => {
    if (!connectedServerId) {
      afkConfigRef.current = null
      afkForcedMuteRef.current = null
      return
    }
    supabase
      .from('servers')
      .select('afk_channel_id, afk_timeout_minutes')
      .eq('id', connectedServerId)
      .single()
      .then(({ data }) => {
        afkConfigRef.current = data
          ? { channelId: data.afk_channel_id, timeoutMinutes: data.afk_timeout_minutes }
          : null
        enforceAfkMute()
      })
  }, [connectedServerId, enforceAfkMute])

  useEffect(() => {
    function markActive() {
      lastActivityRef.current = Date.now()
    }
    window.addEventListener('mousemove', markActive)
    window.addEventListener('mousedown', markActive)
    window.addEventListener('keydown', markActive)
    return () => {
      window.removeEventListener('mousemove', markActive)
      window.removeEventListener('mousedown', markActive)
      window.removeEventListener('keydown', markActive)
    }
  }, [])

  // Falar também conta como atividade (quem está jogando e conversando
  // não mexe no app, e antes ia parar no AFK mesmo falando).
  useEffect(() => {
    if (speaking) lastActivityRef.current = Date.now()
  }, [speaking])

  useEffect(() => {
    enforceAfkMute()
  }, [connectedChannelId, enforceAfkMute])

  // De onde a pessoa foi tirada pelo AFK — volta pra lá quando ela voltar.
  const afkReturnRef = useRef<{ channelId: string; serverId: string; wasMuted: boolean } | null>(null)

  useEffect(() => {
    let busy = false
    const interval = setInterval(async () => {
      enforceAfkMute()
      const config = afkConfigRef.current
      if (busy || !connectedRef.current || !config?.channelId || !connectedChannelId || !connectedServerId) return
      // Inatividade = sem mexer no app, sem falar E (no app de computador)
      // sem usar o computador — mouse/teclado em QUALQUER programa, jogo
      // incluso (tempo ocioso do sistema).
      let idleMs = Date.now() - lastActivityRef.current
      const systemIdleSec = await window.electronAPI?.getSystemIdleSeconds?.().catch(() => null)
      if (typeof systemIdleSec === 'number') idleMs = Math.min(idleMs, systemIdleSec * 1000)

      if (connectedChannelId === config.channelId) {
        // Está no AFK: voltou a usar o computador → volta pra sala de antes.
        const back = afkReturnRef.current
        if (back && back.serverId === connectedServerId && idleMs < 20_000) {
          busy = true
          afkReturnRef.current = null
          leave()
          setTimeout(() => {
            void join(back.channelId, back.serverId).then(() => {
              if (!back.wasMuted && mutedRef.current) toggleMute()
              busy = false
            }, () => {
              busy = false
            })
          }, 300)
        }
        return
      }
      if (idleMs >= config.timeoutMinutes * 60_000) {
        busy = true
        afkReturnRef.current = { channelId: connectedChannelId, serverId: connectedServerId, wasMuted: mutedRef.current }
        const afkChannelId = config.channelId
        const serverId = connectedServerId
        leave()
        setTimeout(() => {
          // No AFK fica mudo (ninguém ouve barulho de quem saiu de perto).
          void join(afkChannelId, serverId).then(() => {
            if (!mutedRef.current) toggleMute()
            busy = false
          }, () => {
            busy = false
          })
        }, 300)
      }
    }, 15_000)
    return () => clearInterval(interval)
  }, [connectedChannelId, connectedServerId, leave, join, enforceAfkMute])

  // Operações que trocam o microfone (trocar dispositivo, reaplicar
  // constraints, recuperar de um mic desplugado) rodam em FILA, uma por
  // vez. Antes, mexer rápido em dois toggles (ex.: eco + ruído) disparava
  // duas recapturas em paralelo, que brigavam pelos mesmos refs — uma
  // delas deixava a track bruta ABERTA sem ninguém pra pará-la.
  const micOpChainRef = useRef<Promise<void>>(Promise.resolve())
  function runMicOp(op: () => Promise<void>): Promise<void> {
    const next = micOpChainRef.current.then(op, op)
    micOpChainRef.current = next.catch(() => {})
    return next
  }

  // Recaptura o microfone com `constraints`, passa pelo RNNoise/gate e
  // troca a track publicada sem renegociar nada.
  async function swapMicrophone(
    constraints: MediaTrackConstraints,
    nsOverrides?: { noiseSuppression?: boolean; micSensitivity?: number; micSensitivityMode?: 'auto' | 'manual' }
  ): Promise<{ usedFallback: boolean }> {
    const { stream: newStream, usedFallback } = await getMicStreamWithFallback(constraints, 1)
    const rawTrack = newStream.getAudioTracks()[0]
    // Saiu da call (ou virou ouvinte) enquanto o mic era capturado.
    if (!connectedRef.current || !canPublishRef.current || !localStreamRef.current) {
      newStream.getTracks().forEach((t) => t.stop())
      return { usedFallback }
    }
    const newTrack = await applyNoiseSuppression(rawTrack, nsOverrides)
    if (!connectedRef.current || !localStreamRef.current) {
      // Saiu durante o carregamento do RNNoise — leave() já limpou o
      // resto; solta só o que acabou de ser criado aqui.
      rawTrack.stop()
      newTrack.stop()
      if (rawMicTrackRef.current === rawTrack) rawMicTrackRef.current = null
      noiseSuppressorRef.current?.destroy()
      noiseSuppressorRef.current = null
      return { usedFallback }
    }
    watchRawMicTrack(rawTrack)

    const stream = localStreamRef.current
    const oldTrack = stream.getAudioTracks()[0]
    if (oldTrack && oldTrack !== newTrack) stream.removeTrack(oldTrack)
    if (!stream.getAudioTracks().includes(newTrack)) stream.addTrack(newTrack)
    // A troca de dispositivo cria uma track NOVA — o AnalyserNode da
    // detecção local de fala precisa ser religado nela, senão a luz de
    // "falando" para de acender.
    setupLocalSpeakingDetection(stream)

    // `true` marca a track como "fornecida pelo usuário" pro LiveKit —
    // ele não tenta gerenciar/recriar essa track sozinho (o que
    // ignoraria todo o pipeline de RNNoise/gate acima).
    const micTrack = micPublicationRef.current?.track as LocalAudioTrack | undefined
    if (micTrack) await micTrack.replaceTrack(newTrack, true)
    // Só para a track antiga DEPOIS da troca no sender — parar antes
    // deixava um buraco de silêncio (e o sender com uma track encerrada).
    if (oldTrack && oldTrack !== newTrack) oldTrack.stop()
    // O LiveKit reescreve `enabled` na troca (com o mute DELE, que não
    // conhece push-to-talk) — antes isto usava só `!muted` (do render), e
    // trocar de mic com push-to-talk ligado deixava o mic ABERTO.
    applyMicEnabledState(pushToTalkActiveRef.current)
    applyMicSenderPriority()
    return { usedFallback }
  }

  // Microfone físico desplugado/desativado no meio da call: a track
  // bruta dispara 'ended' (o que NÃO acontece num .stop() nosso) — antes
  // a call seguia muda sem aviso nenhum. Tenta o microfone padrão.
  // Fone/microfone conectado ou desconectado no meio da call:
  //  - escolheu um microfone específico e ele VOLTOU → passa a usar ele;
  //  - está no "Padrão do sistema" e o padrão do Windows mudou (ex.: plugou
  //    um headset) → troca pro novo padrão.
  // (Se o microfone em uso SUMIR, watchRawMicTrack abaixo já cai pro padrão.)
  useEffect(() => {
    let timer: number | null = null
    const check = async () => {
      if (!connectedRef.current || !canPublishRef.current) return
      const raw = rawMicTrackRef.current
      if (!raw || raw.readyState !== 'live') return
      const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])
      if (!devices?.length) return
      const inputs = devices.filter((d) => d.kind === 'audioinput')
      const current = raw.getSettings()
      const wanted = audioSettingsRef.current.micId
      let shouldSwap = false
      if (wanted && wanted !== 'default') {
        shouldSwap = inputs.some((d) => d.deviceId === wanted) && current.deviceId !== wanted
      } else {
        const def = inputs.find((d) => d.deviceId === 'default')
        shouldSwap = Boolean(def?.groupId && current.groupId && def.groupId !== current.groupId)
      }
      if (shouldSwap) {
        logDebug('microfone: dispositivo mudou (conectado/desconectado) — trocando')
        void refreshAudioConstraints()
      }
    }
    const onChange = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => void check(), 800)
    }
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange)
    return () => {
      if (timer) window.clearTimeout(timer)
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange)
    }
    // refreshAudioConstraints/refs: sempre a versão atual via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function watchRawMicTrack(track: MediaStreamTrack) {
    track.addEventListener(
      'ended',
      () => {
        if (rawMicTrackRef.current !== track || !connectedRef.current) return
        logDebug('microfone encerrado pelo sistema (desplugado?) — tentando o microfone padrão')
        void runMicOp(async () => {
          if (rawMicTrackRef.current !== track || !connectedRef.current) return
          try {
            await swapMicrophone(audioSettingsRef.current.getAudioConstraints(''))
            setError('O microfone foi desconectado — passamos a usar o microfone padrão do sistema.')
          } catch (err) {
            logDebug(`recuperação do microfone falhou — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`)
            setError('O microfone foi desconectado e nenhum outro microfone foi encontrado. Conecte um microfone e escolha-o nas configurações de voz.')
          }
        })
      },
      { once: true }
    )
  }

  async function changeMicrophone(deviceId: string) {
    // "" representa "Padrão do sistema" no <select> — normaliza pra null
    // pra bater com o tipo que StoredSettings.micId realmente usa (ver
    // useAudioSettings.ts).
    audioSettingsRef.current.setMicId(deviceId || null)
    if (!connectedRef.current) return
    await runMicOp(async () => {
      if (!connectedRef.current) return
      try {
        const { usedFallback } = await swapMicrophone(audioSettingsRef.current.getAudioConstraints(deviceId))
        if (usedFallback) setError('O microfone escolhido não está disponível — usando o microfone padrão do sistema.')
      } catch (err) {
        logDebug(`changeMicrophone falhou — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`)
        setError(describeMicError(err) ?? 'Não foi possível trocar de microfone.')
      }
    })
  }

  // Reaplica as configurações de áudio atuais (cancelamento de eco,
  // redução de ruído, ganho automático, sensibilidade) no microfone já
  // conectado — usado pelos toggles (ao lado do perfil e em
  // Configurações → Áudio), pra a mudança valer na call em andamento
  // sem precisar reconectar.
  //
  // `overrides` existe só pra evitar uma corrida com o React: quem chama
  // normalmente acabou de chamar setNoiseSuppression/etc. um instante
  // antes, mas `audioSettingsRef.current` ainda reflete o valor ANTIGO
  // nesse mesmo tick.
  async function refreshAudioConstraints(
    overrides?: Partial<
      Pick<
        ReturnType<typeof useAudioSettings>,
        'echoCancellation' | 'noiseSuppression' | 'autoGainControl' | 'micSensitivity' | 'micSensitivityMode'
      >
    >
  ) {
    if (!connectedRef.current) return
    // Caminho RÁPIDO: se só mudou a sensibilidade (slider ou auto/manual)
    // e o RNNoise já está rodando, basta reconfigurar o gate — antes isso
    // recapturava o microfone inteiro (getUserMedia + gráfico novo +
    // replaceTrack), com um corte audível na voz a cada ajuste do slider.
    const onlyGateChanged =
      overrides !== undefined &&
      Object.keys(overrides).length > 0 &&
      Object.keys(overrides).every((k) => k === 'micSensitivity' || k === 'micSensitivityMode')
    if (onlyGateChanged && noiseSuppressorRef.current) {
      const mode = overrides.micSensitivityMode ?? audioSettingsRef.current.micSensitivityMode
      if (mode === 'auto') {
        // Recomeça o auto-ajuste com o gate aberto; o loop de
        // sensibilidade automática recalcula o limiar em ~1s.
        autoSensitivityRef.current.reset()
        noiseSuppressorRef.current.setSensitivity(DEFAULT_MIC_SENSITIVITY)
      } else {
        noiseSuppressorRef.current.setSensitivity(overrides.micSensitivity ?? audioSettingsRef.current.micSensitivity)
      }
      return
    }
    await runMicOp(async () => {
      if (!connectedRef.current) return
      try {
        await swapMicrophone(audioSettingsRef.current.getAudioConstraints(undefined, overrides), {
          noiseSuppression: overrides?.noiseSuppression,
          micSensitivity: overrides?.micSensitivity,
          micSensitivityMode: overrides?.micSensitivityMode,
        })
      } catch (err) {
        // Se falhar, o microfone atual continua funcionando com as configs antigas.
        logDebug(`refreshAudioConstraints falhou — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`)
      }
    })
  }

  toggleMuteRef.current = toggleMute
  function toggleMute(opts?: { silent?: boolean }) {
    // Clicar no MICROFONE com o áudio desativado: reativa o áudio e o
    // microfone juntos (antes ligava o mic e a tela continuava mostrando
    // mudo — a pessoa falava sem saber).
    if (deafenedRef.current && !opts?.silent) {
      playUndeafenSound()
      setDeafened(false)
      if (!mutedRef.current) return
    }
    // Funciona também fora da call (fica valendo quando entrar) e no meio
    // de uma troca de microfone — antes, sem track no momento, o clique
    // não fazia nada.
    // Lê dos REFS, não do estado capturado no render: quem chama logo
    // depois de um await (ex.: VoiceChannelView faz `await join(); if
    // (!isSpeaker) toggleMute()`) tinha nas mãos uma versão velha desta
    // função, com `muted` de ANTES do join — e o "mutar ouvinte do palco"
    // podia acabar DESmutando.
    const newMuted = !mutedRef.current
    // Na sala AFK o microfone fica sempre desligado.
    const afkId = afkConfigRef.current?.channelId
    if (!newMuted && afkId && connectedChannelIdRef.current === afkId) {
      setError('Na sala AFK o microfone fica desligado. Entre em outra sala para falar.')
      return
    }
    // Ouvinte (sem permissão de publicar) não tem o que desmutar.
    if (!newMuted && !canPublishRef.current) {
      setError(NO_PUBLISH_PERMISSION_MESSAGE)
      return
    }
    mutedRef.current = newMuted
    setMuted(newMuted)
    applyMicEnabledState(pushToTalkActiveRef.current)
    // TRIGÉSIMA OITAVA RODADA — bug relatado: clicar em mutar às vezes
    // não fazia efeito nenhum pra quem está ouvindo. Antes disso, o
    // mute só mexia direto em `track.enabled` — o LiveKit nunca ficava
    // sabendo que a track tinha sido mutada "por fora" da própria API
    // dele, então o próprio bookkeeping interno dele (isMuted) continuava
    // achando que a track estava ativa, e podia reaplicar esse estado
    // (ex.: numa reconexão) e desfazer o mute sem avisar ninguém. Chamar
    // `.mute()/.unmute()` da PRÓPRIA publicação usa o canal oficial —
    // atualiza o mesmo `track.enabled` por baixo, mas também avisa o
    // servidor (silencia de vez do lado do SFU) e mantém o bookkeeping
    // do LiveKit sincronizado com a realidade.
    const micTrack = micPublicationRef.current?.track as LocalAudioTrack | undefined
    if (micTrack) {
      if (newMuted) micTrack.mute().catch(() => {})
      // `unmute()` do LiveKit força `enabled = true` — com push-to-talk
      // ligado isso abria o microfone sem a tecla pressionada. Reaplica o
      // estado real depois que ele termina.
      else
        micTrack
          .unmute()
          .then(() => applyMicEnabledState(pushToTalkActiveRef.current))
          .catch(() => {})
    }
    if (!opts?.silent) {
      if (newMuted) playMuteSound()
      else playUnmuteSound()
    }
  }

  // Trava contra duplo clique na câmera: antes, dois cliques rápidos
  // enquanto o getUserMedia ainda resolvia abriam DUAS câmeras e
  // publicavam as duas (a segunda ficava órfã, com a luz acesa).
  const cameraOpRef = useRef(false)
  async function toggleVideo() {
    if (cameraOpRef.current) return
    cameraOpRef.current = true
    try {
      await toggleVideoInner()
    } finally {
      cameraOpRef.current = false
    }
  }

  async function toggleVideoInner() {
    if (videoEnabled) {
      const track = localStreamRef.current?.getVideoTracks()[0]
      if (track) {
        if (cameraPublicationRef.current) {
          await roomRef.current?.localParticipant.unpublishTrack(track).catch(() => {})
          cameraPublicationRef.current = null
        }
        track.stop()
        localStreamRef.current?.removeTrack(track)
      }
      setVideoEnabled(false)
      setLocalCameraStream(null)
      return
    }
    if (!connectedRef.current) return
    if (!canPublishRef.current) {
      setError(NO_PUBLISH_PERMISSION_MESSAGE)
      return
    }
    let camTrack: MediaStreamTrack | null = null
    try {
      // VIGÉSIMA QUARTA RODADA — ver StoredSettings.cameraId
      // (useAudioSettings.ts) pro porquê: deixa escolher uma câmera
      // virtual (ex.: "OBS Virtual Camera") em vez da webcam de
      // verdade. `exact` faz falhar explicitamente se o dispositivo
      // escolhido não existir mais (ex.: OBS fechado) em vez de cair
      // silenciosamente na webcam padrão sem avisar ninguém.
      const cameraId = audioSettingsRef.current.cameraId
      // Pede 720p/30 como IDEAL (não obrigatório): sem isso o Chromium
      // abre a webcam no padrão dele, 640×480 — imagem pior do que a
      // câmera entrega de graça. O LiveKit já gera as camadas de
      // simulcast menores a partir daqui pra quem tem conexão fraca.
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(cameraId ? { deviceId: { exact: cameraId } } : {}),
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      })
      const track = camStream.getVideoTracks()[0]
      camTrack = track
      // Saiu da call enquanto a câmera abria — não publica nada.
      if (!connectedRef.current || !roomRef.current || !localStreamRef.current) {
        track.stop()
        return
      }
      track.contentHint = 'motion'
      localStreamRef.current.addTrack(track)
      cameraPublicationRef.current = await roomRef.current.localParticipant.publishTrack(track, {
        name: 'camera',
        source: Track.Source.Camera,
        simulcast: true,
      })
      setVideoEnabled(true)
      setLocalCameraStream(new MediaStream([track]))
    } catch (err) {
      // Falhou DEPOIS de abrir a câmera (ex.: publish recusado) — solta o
      // dispositivo em vez de deixar a luz da câmera acesa.
      if (camTrack) {
        camTrack.stop()
        localStreamRef.current?.removeTrack(camTrack)
        cameraPublicationRef.current = null
      }
      // TRIGÉSIMA RODADA — "Não foi possível acessar a câmera" sozinho,
      // sem mais detalhe nenhum, é inútil pra diagnosticar à distância
      // (é literalmente a MESMA mensagem pra "câmera virtual do OBS
      // fechada", "outro programa já está usando a câmera" e "permissão
      // negada" — três causas com soluções completamente diferentes).
      // Loga o erro de verdade (nome + mensagem) e, quando o nome dá pra
      // reconhecer, mostra uma mensagem específica o suficiente pra
      // apontar a causa provável sem precisar abrir o log.
      const name = err instanceof Error ? err.name : String(err)
      const message = err instanceof Error ? err.message : ''
      logDebug(`toggleVideo: getUserMedia falhou (cameraId=${audioSettingsRef.current.cameraId ?? '(padrão)'}) — ${name}: ${message}`)
      const usingCustomCamera = Boolean(audioSettingsRef.current.cameraId)
      if ((name === 'OverconstrainedError' || name === 'NotFoundError') && usingCustomCamera) {
        setError(
          'A câmera escolhida nas Configurações não foi encontrada — se for uma câmera virtual (ex.: OBS), confirme que o programa está aberto e a câmera virtual está ativa.'
        )
      } else if (name === 'NotReadableError') {
        setError(
          usingCustomCamera
            ? 'Não foi possível abrir a câmera escolhida — ela pode estar sendo usada por outro programa, ou a captura de tela associada a ela (ex.: OBS) pode não estar realmente ativa no momento.'
            : 'Não foi possível abrir a câmera — ela pode estar sendo usada por outro programa no momento.'
        )
      } else if (name === 'NotAllowedError') {
        setError('Permissão de câmera negada. Habilite o acesso à câmera nas configurações do Windows/navegador e tente de novo.')
      } else {
        setError(`Não foi possível acessar a câmera${message ? `: ${message}` : '.'}`)
      }
    }
  }

  // Some sozinho pros dois casos de fim de compartilhamento de tela: a
  // pessoa clicou pra parar, OU (novo, pro caso de tela cheia) o jogo que
  // estava sendo compartilhado foi fechado — ver o watch de
  // onGameStatusChanged logo abaixo em toggleScreenShare. Para as
  // tracks de verdade (vídeo E áudio) e tira elas dos peers antes de
  // limpar o estado — sem isso a captura continuaria rodando por baixo
  // (indicador do sistema aceso, peers ainda recebendo frames) mesmo com
  // a UI já mostrando "parou".
  function stopScreenShareState() {
    setScreenSharePresetLabel(null)
    if (screenVideoPublicationRef.current) {
      playStreamStopSound()
      const publishedTrack = screenVideoPublicationRef.current.track
      if (publishedTrack) roomRef.current?.localParticipant.unpublishTrack(publishedTrack)
      screenVideoPublicationRef.current = null
    }
    screenStreamRef.current?.getTracks().forEach((track) => track.stop())
    gameShareWatchRef.current?.()
    gameShareWatchRef.current = null
    window.electronAPI?.stopWatchProcessExit?.().catch(() => {})
    // DÉCIMA SÉTIMA RODADA: usa a publicação de áudio da tela diretamente
    // (o LocalAudioTrack real que está publicado agora, mesmo que já
    // tenha passado por replaceTrack várias vezes — ver
    // switchScreenShareSource/recoverScreenShareAudioToSystem) em vez de
    // tentar casar por referência de MediaStreamTrack.
    if (screenAudioPublicationRef.current) {
      const publishedTrack = screenAudioPublicationRef.current.track
      if (publishedTrack) roomRef.current?.localParticipant.unpublishTrack(publishedTrack)
      screenAudioPublicationRef.current = null
      screenAudioOutputTrackRef.current = null
    }
    teardownScreenAudioDenoiser()
    // A captura BRUTA (quando ativa) não faz parte de
    // screenStreamRef.current — vem de um MediaStream próprio dentro do
    // PcmStreamPlayer (ver startAppAudioCapture acima) — por isso
    // precisa ser encerrada aqui à parte (a publicação que a carregava,
    // já filtrada, foi removida acima).
    appAudioTrackRef.current = null
    stopAppAudioCapture()
    // QUINTA RODADA: mesma lógica acima, agora pro áudio de SISTEMA
    // (ver captureSystemAudioTrack) — desde que vídeo e áudio viraram
    // duas chamadas separadas, esse áudio também vem de um MediaStream
    // próprio, fora de screenStreamRef.current, então precisa da própria
    // limpeza aqui, senão o indicador "compartilhando microfone/tela" do
    // Windows continuaria aceso e o processo WASAPI de loopback
    // continuaria aberto à toa.
    if (systemAudioTrackRef.current) {
      systemAudioTrackRef.current.stop()
      systemAudioTrackRef.current = null
    }
    screenStreamRef.current = null
    setLocalScreenStream(null)
    setScreenSharing(false)

    // Desliga o vigia de foco do jogo (se estava ativo) e limpa tudo que
    // ele usava — senão o processo do PowerShell continuaria rodando à
    // toa até a próxima call.
    foregroundWatchUnsubRef.current?.()
    foregroundWatchUnsubRef.current = null
    window.electronAPI?.stopForegroundWatch?.().catch(() => {})
    realScreenVideoTrackRef.current = null
    if (placeholderTrackRef.current) {
      placeholderTrackRef.current.stop()
      placeholderTrackRef.current = null
    }
  }

  // Vigia de foco do jogo (troca o vídeo por uma "cortina" quando a
  // pessoa dá alt-tab) — era o MESMO bloco copiado em toggleScreenShare e
  // switchScreenShareSource. Agora também confere, quando o vigia termina
  // de iniciar (é assíncrono), se a transmissão ainda é a mesma: antes,
  // parar/trocar a transmissão nesse meio-tempo deixava um listener de
  // IPC órfão ligado pra sempre.
  function startGameForegroundWatch(processNames: string[], forVideoTrack: MediaStreamTrack) {
    if (!window.electronAPI?.startForegroundWatch) return
    window.electronAPI
      .startForegroundWatch(processNames)
      .then((started) => {
        if (!started || !window.electronAPI) return
        if (realScreenVideoTrackRef.current !== forVideoTrack) {
          window.electronAPI.stopForegroundWatch?.().catch(() => {})
          return
        }
        foregroundWatchUnsubRef.current?.()
        foregroundWatchUnsubRef.current = window.electronAPI.onGameForegroundChanged((focused) => {
          const realTrack = realScreenVideoTrackRef.current
          const publishedTrack = screenVideoPublicationRef.current?.track as LocalVideoTrack | undefined
          if (!realTrack || !publishedTrack) return
          if (focused) {
            // Voltou pro jogo — restaura o vídeo de verdade e descarta
            // a cortina (não precisa mais dela até a próxima vez que a
            // pessoa alternar pra fora).
            publishedTrack.replaceTrack(realTrack, true).catch(() => {})
            if (placeholderTrackRef.current) {
              placeholderTrackRef.current.stop()
              placeholderTrackRef.current = null
            }
          } else {
            // Saiu do jogo (alt-tab) — troca pela cortina antes que
            // qualquer frame do resto da tela chegue a ser enviado.
            if (!placeholderTrackRef.current) placeholderTrackRef.current = createPlaceholderVideoTrack()
            publishedTrack.replaceTrack(placeholderTrackRef.current, true).catch(() => {})
          }
        })
      })
      .catch(() => {
        // Sem sorte iniciando o vigia (PowerShell bloqueado por política
        // do sistema, por exemplo) — segue sem essa camada extra.
      })
  }

  // Trava contra duplo clique/cliques concorrentes em compartilhar tela
  // (a cadeia de captura pode levar vários segundos) — antes, clicar de
  // novo durante o "Conectando..." abria uma SEGUNDA captura em paralelo.
  const screenShareOpRef = useRef(false)

  // Preset EFETIVO de uma captura, decidido assim que a pessoa escolhe a
  // fonte (ver captureScreenShareStream): o das configurações, ou o preset
  // automático "Jogo" quando a fonte é um jogo detectado. Rede fraca = a
  // SUA conexão com o servidor está "ruim"/"perdida" agora.
  function effectiveScreenSharePreset(isGame: boolean): QualityPreset {
    const quality = localConnectionQualityRef.current
    return resolveScreenSharePreset(screenShareQualityRef.current, {
      isGame,
      gameAuto: screenShareGameAutoRef.current,
      weakNetwork: quality === 'poor' || quality === 'lost',
    })
  }

  // Ajusta bitrate/fps/prioridade/degradação do sender do vídeo da tela já
  // publicado (usado ao trocar de fonte — replaceTrack mantém os
  // parâmetros antigos). Best-effort: falha só fica no log.
  function applyScreenSenderEncoding(track: LocalVideoTrack, preset: QualityPreset) {
    const sender = track.sender
    if (!sender) return
    try {
      const params = sender.getParameters()
      if (!params.encodings?.length) return
      const enc = params.encodings[0] as RTCRtpEncodingParameters & { priority?: string; networkPriority?: string }
      enc.maxBitrate = preset.maxBitrate
      enc.maxFramerate = preset.frameRate
      if ('priority' in enc) enc.priority = 'high'
      if ('networkPriority' in enc) enc.networkPriority = 'high'
      ;(params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = preset.degradationPreference
      sender.setParameters(params).catch((err) => {
        logDebug(`applyScreenSenderEncoding: setParameters falhou — ${err instanceof Error ? err.message : String(err)}`)
      })
    } catch (err) {
      logDebug(`applyScreenSenderEncoding: falhou — ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Estatísticas REAIS do vídeo que está saindo (RTCRtpSender.getStats) —
  // lidas pelo indicador discreto de quem transmite (VoiceChannelView.tsx,
  // ver lib/screenShareStats.ts). null fora de uma transmissão.
  const getScreenShareStatsReport = useCallback(async (): Promise<RTCStatsReport | null> => {
    const sender = (screenVideoPublicationRef.current?.track as LocalVideoTrack | undefined)?.sender
    if (!sender) return null
    try {
      return await sender.getStats()
    } catch {
      return null
    }
  }, [])

  // Rede de segurança da transmissão pela GPU: a placa pode DIZER que
  // codifica um formato e o WebRTC mesmo assim usar o processador. Com
  // vídeo saindo de verdade, confere o codificador real (getStats); se
  // for software, guarda esse formato como "ruim neste computador" e
  // republica no próximo que a placa codifica (VP9/AV1). Uma piscada de
  // ~1s pra quem assiste, uma vez só — da próxima já começa no certo.
  async function watchForSoftwareEncoder(
    videoTrack: MediaStreamTrack,
    codec: ScreenCodec,
    buildOpts: (codec: ScreenCodec) => Parameters<NonNullable<Room['localParticipant']>['publishTrack']>[1]
  ) {
    let current = codec
    let prev: OutboundVideoSample | null = null
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      if (screenStreamRef.current?.getVideoTracks()[0] !== videoTrack || videoTrack.readyState !== 'live') return
      const report = await getScreenShareStatsReport()
      const sample = pickOutboundVideo(report ? (Array.from(report.values()) as Record<string, unknown>[]) : null)
      if (!sample) continue
      const stats = prev ? computeScreenShareStats(prev, sample) : null
      prev = sample
      // Só decide com vídeo saindo (sem ninguém assistindo o envio pausa).
      if (!stats || !stats.bitrateKbps || stats.hardwareEncoder === null) continue
      if (stats.hardwareEncoder) {
        logDebug(`transmissão: codificando pela placa de vídeo (${current}, ${sample.encoderImplementation ?? '?'})`)
        return
      }
      if (current !== 'h264' && current !== 'vp9' && current !== 'av1') return
      markCodecSoftwareOnly(current)
      resetHardwareProbe()
      const next = chooseScreenCodec(await probeHardwareEncoders(), true)
      logDebug(`transmissão: ${current} caiu no processador (${sample.encoderImplementation ?? '?'}) — próximo pela placa: ${next}`)
      const room = roomRef.current
      if (next === current || next === 'h264' || !room) return
      try {
        await room.localParticipant.unpublishTrack(videoTrack, false)
        if (screenStreamRef.current?.getVideoTracks()[0] !== videoTrack) return
        screenVideoPublicationRef.current = await room.localParticipant.publishTrack(videoTrack, buildOpts(next))
        current = next
        prev = null
      } catch (err) {
        logDebug(`transmissão: troca de formato falhou — ${err instanceof Error ? err.message : String(err)}`)
        return
      }
    }
  }

  async function toggleScreenShare(opts?: { auto?: boolean }) {
    if (screenShareOpRef.current) return
    if (screenSharing) {
      stopScreenShareState()
      return
    }
    if (!connectedRef.current) return
    if (!canPublishRef.current) {
      setError(NO_PUBLISH_PERMISSION_MESSAGE)
      return
    }
    screenShareOpRef.current = true
    setScreenShareConnecting(true)
    let stream: MediaStream | null = null
    let started = false
    // A call acabou (leave) em algum ponto da cadeia assíncrona abaixo?
    const callEnded = () => !connectedRef.current || !roomRef.current
    try {
      // OITAVA RODADA: getDisplayMedia() foi abandonado — ver o
      // comentário grande em captureScreenShareStream acima pro
      // raciocínio completo. A qualidade (resolução/taxa de quadros)
      // continua sendo ajustada DEPOIS, na track já ativa.
      // Preset efetivo: o escolhido nas configurações, ou o "Jogo"
      // (1080p60/720p60) quando a fonte é um jogo detectado.
      const captureInfo = { preset: screenShareQualityRef.current, isGame: false }
      stream = await captureScreenShareStream(screenShareQualityRef.current, opts, effectiveScreenSharePreset, captureInfo)
      const preset = captureInfo.preset
      // Recado deixado pelo ScreenSharePicker.tsx quando a pessoa clicou
      // no atalho "Compartilhar seu jogo/janela" E caiu no caso de tela
      // cheia (sem janela própria pra detectar o fechamento sozinha) — ver
      // screenShareGameHint.ts. Só dá pra ler DEPOIS do getDisplayMedia
      // acima resolver — é só nesse momento (a pessoa já escolheu algo no
      // seletor) que o picker teria tido a chance de deixar esse recado;
      // lendo antes (como era antes dessa correção) sempre pegava o
      // recado vazio/velho de uma vez anterior, porque o seletor nem
      // tinha aberto ainda.
      const gameShareHint = takePendingGameShareHint()
      // Ver pendingAppAudioCapture.ts — automático (sem checkbox) pra
      // "Jogo"/Janela com PID resolvido (ver ScreenSharePicker.tsx).
      // `isWindowChoice` é só diagnóstico: se era mesmo uma janela mas
      // não veio PID, avisa em vez de ficar silenciosamente sem áudio
      // sem pista nenhuma do motivo.
      const appAudioChoice = takePendingAppAudioPid()
      const appAudioPid = appAudioChoice?.pid ?? null
      logDebug(`toggleScreenShare: appAudioChoice=${JSON.stringify(appAudioChoice)}`)
      if (callEnded()) {
        // Saiu da call enquanto escolhia a fonte — não deixa a captura
        // (e o indicador de "compartilhando" do sistema) ligada à toa.
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      screenStreamRef.current = stream
      setLocalScreenStream(stream)
      const videoTrack = stream.getVideoTracks()[0]
      if (!videoTrack) throw new DOMException('A captura não retornou nenhum vídeo.', 'NotReadableError')
      // Teto de resolução/fps ANTES de publicar (antes era `void`, sem
      // esperar — o encoder começava com o quadro do monitor inteiro). Ver
      // applyVideoQualityConstraints acima. Nunca lança: se falhar, segue.
      const finalVideoSettings = await applyVideoQualityConstraints(videoTrack, preset, 'toggleScreenShare')
      // Formato pela PLACA DE VÍDEO de quem transmite: se ela não codifica
      // H.264 por hardware (comum em AMD/Intel no Chromium do Windows),
      // usa VP9/AV1 por hardware em vez de cair no processador.
      let screenVideoCodec: ScreenCodec = pickScreenShareCodec(finalVideoSettings, 'toggleScreenShare')
      if (screenVideoCodec === 'h264') {
        const [hw, encodeSettings] = await Promise.all([
          // O teste da placa roda ao abrir o app; se ainda não terminou,
          // não segura o início da transmissão — começa em H.264 e o
          // watchForSoftwareEncoder troca depois, se precisar.
          Promise.race([
            probeHardwareEncoders(),
            new Promise<{ h264: boolean; vp9: boolean; av1: boolean }>((r) =>
              setTimeout(() => r({ h264: true, vp9: false, av1: false }), 1500)
            ),
          ]),
          window.electronAPI?.getVideoEncodeSettings?.().catch(() => null) ?? Promise.resolve(null),
        ])
        const preferGpu = encodeSettings ? encodeSettings.preferGpu : true
        screenVideoCodec = chooseScreenCodec(hw, preferGpu)
        logDebug(
          `toggleScreenShare: codificador de hardware — H264=${hw.h264} VP9=${hw.vp9} AV1=${hw.av1} (preferir GPU=${preferGpu}) → ${screenVideoCodec}`
        )
      }
      // Codec: H.264/VP9/AV1 conforme a placa (acima); VP8 só quando o
      // quadro passa do limite do H.264. `priority: 'high'` = mesmo nível
      // do microfone na fila de envio. Sem simulcast/backupCodec (não
      // codifica duas vezes).
      const buildScreenVideoOpts = (codec: ScreenCodec) => ({
        name: 'screen',
        source: Track.Source.ScreenShare,
        videoCodec: codec,
        backupCodec: false,
        // VP9/AV1 no LiveKit pedem um modo de camadas; L1T3 = uma
        // resolução só (sem codificar duas vezes), igual o H.264.
        ...(codec === 'vp9' || codec === 'av1' ? { scalabilityMode: 'L1T3' as const } : {}),
        screenShareEncoding: {
          maxBitrate: preset.maxBitrate,
          maxFramerate: preset.frameRate,
          priority: 'high' as const,
        },
        degradationPreference: preset.degradationPreference,
        simulcast: false,
      })
      // QUINTA RODADA: vídeo e áudio agora são COMPLETAMENTE
      // independentes — `stream` (acima) só tem vídeo. Tenta primeiro a
      // captura por processo (isola só o som do jogo, quando o PID foi
      // resolvido); se não der, cai pro áudio de todo o sistema via
      // captureSystemAudioTrack (chamada separada, então uma falha aqui
      // NUNCA mais derruba o vídeo, que já está garantido acima). Só na
      // pior hipótese (as duas falharem) é que a transmissão fica sem
      // áudio nenhum — mas o vídeo já foi, de qualquer forma.
      //
      // DÉCIMA PRIMEIRA RODADA: no Linux, `stream` já pode vir com uma
      // track de áudio DENTRO dela — o seletor NATIVO do sistema (ver o
      // branch de Linux em captureScreenShareStream acima) tem seu
      // próprio toggle de "compartilhar também o áudio", e quando a
      // pessoa marca isso, getDisplayMedia() já devolve vídeo+áudio
      // juntos no mesmo MediaStream, exatamente como o Chrome
      // fazem. Usar essa track direto (em vez de tentar as duas
      // capturas Windows-only abaixo, que nem se aplicam aqui) significa
      // reaproveitar o áudio que o PRÓPRIO SISTEMA já isolou pra área
      // escolhida — evita duplicar captura à toa e evita cair no áudio
      // de sistema inteiro sem necessidade.
      let audioTrack: MediaStreamTrack | null = stream.getAudioTracks()[0] ?? null
      if (!audioTrack && appAudioPid) {
        const appAudioTrack = await startAppAudioCapture(appAudioPid)
        if (appAudioTrack) {
          audioTrack = appAudioTrack
          appAudioTrackRef.current = appAudioTrack
        }
      }
      if (!audioTrack) {
        const systemAudio = await captureSystemAudioWithoutCallEcho()
        if (systemAudio) {
          audioTrack = systemAudio.track
          if (systemAudio.native) appAudioTrackRef.current = systemAudio.track
          else systemAudioTrackRef.current = systemAudio.track
        }
      }
      logDebug(`toggleScreenShare: resultado final do áudio — ${audioTrack ? `track ok (${audioTrack.label || audioTrack.id})` : 'NENHUMA track de áudio (transmissão vai muda)'}`)
      // Só avisa sobre o áudio depois de saber o resultado FINAL das duas
      // tentativas acima — dizer isso antes seria um chute (poderia dar
      // certo no áudio de sistema mesmo sem o PID da janela).
      if (appAudioChoice?.isWindowChoice && !appAudioPid) {
        setError(
          audioTrack
            ? 'Não consegui identificar o processo do app/jogo — a transmissão vai com o áudio de todo o sistema em vez de só o dele (o vídeo continua normal).'
            : 'Não consegui identificar o processo do app/jogo, e também não consegui capturar o áudio de sistema — a transmissão vai sem áudio (o vídeo continua normal).'
        )
      }
      // DÉCIMA SÉTIMA RODADA: passa a track de áudio resolvida (seja
      // qual for a origem) pelo redutor de ruído da transmissão antes de
      // publicar no LiveKit — ver prepareScreenAudioForSending /
      // createScreenAudioDenoiser. `audioTrack` passa a apontar pra
      // versão FILTRADA daqui em diante.
      if (audioTrack) {
        const prepared = await prepareScreenAudioForSending(audioTrack)
        audioTrack = prepared.track
      } else {
        teardownScreenAudioDenoiser()
      }
      screenAudioOutputTrackRef.current = audioTrack
      if (callEnded() || screenStreamRef.current !== stream) {
        // Saiu da call durante a captura de áudio — leave() já chamou
        // stopScreenShareState, mas a track de áudio pode ter chegado
        // DEPOIS disso: limpa de novo o que sobrou.
        stopScreenShareState()
        return
      }
      // "motion" prioriza fluidez (jogo/vídeo); "detail" prioriza
      // nitidez de texto (15fps — documento/código). Ver
      // contentHintForPreset em useScreenShareQuality.ts.
      videoTrack.contentHint = contentHintForPreset(preset)
      videoTrack.onended = () => {
        stopScreenShareState()
      }

      // Caso especial: captura de TELA CHEIA usada como substituto de
      // "compartilhar o jogo/janela" (jogo em modo exclusivo, sem janela
      // própria pro sistema capturar separadamente). Diferente de uma
      // janela — que dispara `onended` sozinha quando é fechada — a
      // tela em si nunca "fecha", então sem isto aqui a transmissão
      // continuaria mostrando o desktop vazio mesmo depois do jogo ser
      // fechado. Pede pro processo principal vigiar os processos do
      // recado (funciona pra qualquer jogo/app, não só os cadastrados em
      // KNOWN_GAMES — ver electron/main.cjs) e encerra sozinho assim que
      // eles não estiverem mais rodando.
      if (gameShareHint && window.electronAPI) {
        window.electronAPI.watchProcessExit?.(gameShareHint.processNames).catch(() => {})
        gameShareWatchRef.current = window.electronAPI.onWatchedProcessExited(() => {
          stopScreenShareState()
        })
      }

      realScreenVideoTrackRef.current = videoTrack
      if (roomRef.current) {
        // Publica o vídeo da tela — `screenShareEncoding` é o
        // equivalente, no LiveKit, do `params.encodings[0].maxBitrate` +
        // `degradationPreference` que antes eram setados na mão em cada
        // RTCRtpSender de cada peer (ver o comentário grande no preset
        // em useScreenShareQuality.ts). Como o LiveKit é um SFU, isso é
        // configurado UMA vez aqui — não precisa mais repetir por peer.
        //
        // TRIGÉSIMA SEXTA RODADA — bug relatado: compartilhar tela
        // pesava/travava o JOGO em si, não só a qualidade pra quem
        // assiste. Causa provável: sem `videoCodec` explícito, o
        // navegador/Electron escolhe o codec sozinho — e o padrão
        // (VP8) só tem encoder por SOFTWARE na maioria dos sistemas
        // (sem aceleração de GPU), disputando a CPU diretamente com o
        // jogo. H.264 já tem encoder por HARDWARE na maioria das
        // placas de vídeo (Intel Quick Sync, NVENC da Nvidia, VCE da
        // AMD) — pedindo ele explicitamente, o Chromium usa esse
        // caminho acelerado por GPU quando disponível, tirando quase
        // todo esse trabalho da CPU (que o jogo continua usando à
        // vontade). `backupCodec: false` evita que o LiveKit publique
        // uma SEGUNDA versão da transmissão codificada num codec
        // alternativo "por garantia" — sem isso, em alguns casos o
        // navegador acaba codificando duas vezes ao mesmo tempo, o
        // dobro de trabalho de CPU/GPU à toa.
        // TRIGÉSIMA OITAVA RODADA — bug relatado: a janela de
        // compartilhamento demorava pra aparecer pros outros depois de
        // clicar em transmitir. Causa: vídeo e áudio da tela eram
        // publicados em SÉRIE (um `await` esperando o outro terminar) —
        // igual ao mic/presença/token corrigido na RODADA 37, cada
        // `publishTrack` é uma negociação própria com o servidor
        // (ida-e-volta de rede), e nenhum dos dois depende do resultado
        // do outro. Rodando os dois ao mesmo tempo com Promise.all, o
        // tempo total vira o do mais lento dos dois, não a soma.
        logDebug(
          `toggleScreenShare: publicando vídeo (${screenVideoCodec}, até ${preset.maxBitrate}bps) e áudio (${audioTrack ? 'sim' : 'não'})...`
        )
        const [videoPublication, audioPublication] = await Promise.all([
          // Codec: H.264 (encoder de hardware na grande maioria das GPUs —
          // NVENC/AMF/Quick Sync — e decodificado por qualquer um que
          // assista); VP8 só quando o quadro passa do limite do H.264 (ver
          // pickScreenShareCodec). VP9/AV1 ficaram de fora de propósito:
          // encoder de hardware deles ainda é raro no Chromium do Windows
          // (cairia em software, disputando CPU com o jogo) e exigiriam
          // SVC/backupCodec (codificar duas vezes). `scalabilityMode` só
          // vale pra VP9/AV1 — com H.264/VP8 sem simulcast é sempre uma
          // camada só (L1T1), então não é passado.
          // `priority: 'high'` marca os pacotes do vídeo como prioritários
          // na fila de envio (mesmo nível do microfone, ver
          // applyMicSenderPriority) — a voz continua minúscula (64kbps) e
          // não perde pro vídeo.
          roomRef.current.localParticipant.publishTrack(videoTrack, buildScreenVideoOpts(screenVideoCodec)),
          // Mesmo ajuste de antes — o áudio da transmissão precisa do
          // PRÓPRIO teto de bitrate (pensado pra som de jogo/música,
          // bem maior que o do microfone) e estéreo de verdade
          // (forceStereo substitui o antigo SDP munging manual de
          // sdpStereo.ts — o LiveKit já negocia isso nativamente).
          audioTrack
            ? roomRef.current.localParticipant.publishTrack(audioTrack, SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS)
            : Promise.resolve(null),
        ])
        screenVideoPublicationRef.current = videoPublication
        if (audioPublication) screenAudioPublicationRef.current = audioPublication
        logDebug(`toggleScreenShare: publicação concluída (preset ${preset.label}${captureInfo.isGame ? ', fonte = jogo' : ''})`)
      }
      started = true
      setScreenSharing(true)
      if (window.electronAPI?.isElectron) void watchForSoftwareEncoder(videoTrack, screenVideoCodec, buildScreenVideoOpts)
      playStreamStartSound()
      setScreenSharePresetLabel(preset.label)

      // Mitigação de vazamento pro caso "compartilhar seu jogo" em tela
      // cheia (sem janela própria — ver comentário grande acima e em
      // ScreenSharePicker.tsx): enquanto isso estiver ativo, o processo
      // principal (só Windows, best-effort — ver electron/main.cjs)
      // avisa quando a pessoa alterna pra fora do jogo, e a gente troca
      // o vídeo enviado pelos peers por uma "cortina" preta até ela
      // voltar. Em Mac/Linux, ou se o vigia não conseguir iniciar (volta
      // `false`), simplesmente não faz nada — o compartilhamento
      // continua igual ao de antes (sempre visível), sem quebrar nada.
      if (gameShareHint) startGameForegroundWatch(gameShareHint.processNames, videoTrack)
      // No app desktop, capturar uma janela específica faz o Windows
      // trazer ela pra frente sozinho (comportamento do sistema, não do
      // nosso código) — a pessoa clica em "compartilhar tela" e se vê
      // jogada pra fora do app. O processo principal já tenta devolver o
      // foco uma vez assim que a fonte é escolhida (ver
      // electron/main.cjs), mas chama de novo aqui, agora que o stream
      // já está de fato fluindo, cobre o caso do foco mudar de novo nesse
      // meio-tempo.
      window.electronAPI?.focusAppWindow?.()
    } catch (err) {
      // TERCEIRA RODADA de correção nesse fluxo: clicar em "Cancelar" no
      // seletor (ScreenSharePicker.tsx) ou clicar fora dele chama
      // choose(null), que no processo principal responde ao pedido do
      // Electron com um objeto vazio (ver ipcMain.handle('screen-share:select', ...)
      // em electron/main.cjs) — é assim que a API pede pra gente NEGAR o
      // pedido. Isso faz getDisplayMedia() REJEITAR a Promise com
      // DOMException "NotAllowedError", exatamente como quando o
      // microfone é negado (ver o catch de joinChannel acima, que já
      // trata esse mesmo nome de erro). Antes dessa correção, cancelar o
      // seletor SEMPRE caía aqui e mostrava "Não foi possível
      // compartilhar a tela." — só que isso ficava invisível até a
      // correção anterior (o banner de erro em VoiceChannelView.tsx), daí
      // parecer um bug NOVO quando na verdade sempre existiu, só que
      // mudo. Cancelamento não é uma falha real, então não deve gerar
      // aviso nenhum. Pra qualquer outro erro de verdade, agora inclui a
      // mensagem original na tela — antes esse catch não guardava o erro
      // (`catch {}`, sem variável nenhuma), então uma falha real nesse
      // trecho (ex.: pc.addTrack, sender.setParameters) virava sempre o
      // mesmo aviso genérico, sem pista nenhuma de qual foi o motivo de
      // verdade — impossível de diagnosticar à distância.
      // Falhou DEPOIS da captura já ter começado (ex.: publishTrack
      // recusou/caiu) — antes a captura continuava rodando (indicador do
      // sistema aceso, processo de áudio nativo vivo) com a UI dizendo
      // "não está compartilhando". Desfaz tudo.
      if (stream && !started) {
        if (screenStreamRef.current === stream) stopScreenShareState()
        else stream.getTracks().forEach((t) => t.stop())
      }
      if (err instanceof Error && err.name === 'NotAllowedError') return
      // QUARTA RODADA: "Invalid capture constraints" continuou aparecendo
      // mesmo depois de tirar o "max" do frameRate — ou seja, a causa era
      // outra (ver a correção em pendingDisplayMediaSources, no
      // electron/main.cjs: as duas chamadas separadas de
      // desktopCapturer.getSources() — uma pra montar a lista, outra pra
      // resolver o clique — foram unificadas numa só). Pra não ficar
      // adivinhando de novo se essa também não for a causa completa,
      // inclui aqui TODO detalhe que o navegador expuser: além da
      // mensagem, o nome do erro (err.name) e, se for OverconstrainedError
      // (erro específico de constraint de vídeo/áudio inválida), o nome
      // exato da propriedade que falhou (err.constraint — ex.: "frameRate",
      // "channelCount") — informação que a mensagem sozinha não mostra.
      const name = err instanceof Error ? err.name : null
      const constraint =
        err && typeof err === 'object' && 'constraint' in err ? String((err as { constraint: unknown }).constraint) : null
      const detail = err instanceof Error ? err.message : String(err)
      const parts = [detail, name && name !== 'Error' ? `(${name}${constraint ? `: ${constraint}` : ''})` : null].filter(
        Boolean
      )
      // VIGÉSIMA RODADA: NotReadableError em cima de uma fonte de TELA
      // (mesmo depois da tentativa automática de novo, acima) quase
      // sempre é o jogo estando em modo EXCLUSIVO de tela cheia (ver o
      // comentário grande em captureScreenShareStream) — a pessoa não
      // tem como adivinhar isso só pela mensagem técnica do navegador,
      // então junto com o detalhe técnico (mantido pra quem for
      // diagnosticar à distância) mostra também o motivo provável e a
      // solução que resolve a mesma limitação no OBS/Zoom.
      const likelyExclusiveFullscreen = name === 'NotReadableError'
      const base = parts.length ? `Não foi possível compartilhar a tela: ${parts.join(' ')}` : 'Não foi possível compartilhar a tela.'
      setError(
        likelyExclusiveFullscreen
          ? `${base} — o jogo provavelmente está em modo de tela cheia EXCLUSIVA. Troque pra "tela cheia sem bordas" (borderless) nas configurações de vídeo do jogo e tente compartilhar de novo.`
          : base
      )
    } finally {
      screenShareOpRef.current = false
      setScreenShareConnecting(false)
    }
  }

  // Troca a fonte (janela/tela) de uma transmissão que já está rolando,
  // sem precisar parar e começar outra do zero. Abre o mesmo seletor de
  // sempre (getDisplayMedia — no app desktop isso mostra de novo o
  // ScreenSharePicker.tsx, com o mesmo atalho "compartilhar seu
  // jogo/janela" se fizer sentido) e, assim que a pessoa escolhe algo
  // novo, troca só o CONTEÚDO sendo enviado pra cada peer via
  // replaceTrack — como isso não mexe no "canal" (m-line) já negociado,
  // não dispara uma renegociação nem um piscar de "parou/começou de novo"
  // pra quem está assistindo, diferente de um stop+start completo.
  async function switchScreenShareSource() {
    if (!screenSharing || !screenStreamRef.current || screenShareOpRef.current) return
    screenShareOpRef.current = true
    setScreenShareConnecting(true)
    let newStream: MediaStream | null = null
    let adopted = false
    try {
      // OITAVA RODADA: idem toggleScreenShare acima — ver
      // captureScreenShareStream (inclusive o preset automático "Jogo").
      const captureInfo = { preset: screenShareQualityRef.current, isGame: false }
      newStream = await captureScreenShareStream(screenShareQualityRef.current, undefined, effectiveScreenSharePreset, captureInfo)
      const preset = captureInfo.preset
      // A transmissão (ou a call) acabou enquanto o seletor estava aberto.
      if (!screenStreamRef.current || !connectedRef.current) {
        newStream.getTracks().forEach((t) => t.stop())
        return
      }
      // Mesma lógica de toggleScreenShare acima — só dá pra ler o recado
      // do picker DEPOIS do getDisplayMedia resolver.
      const gameShareHint = takePendingGameShareHint()
      const appAudioChoice = takePendingAppAudioPid()
      const appAudioPid = appAudioChoice?.pid ?? null

      const newVideoTrack = newStream.getVideoTracks()[0]
      if (!newVideoTrack) {
        newStream.getTracks().forEach((t) => t.stop())
        return
      }
      // Teto de resolução/fps ANTES do replaceTrack — ver
      // applyVideoQualityConstraints acima (mesmo motivo do toggleScreenShare).
      // replaceTrack mantém o codec já negociado; se esta fonte nova ficou
      // grande demais pro H.264 mesmo depois do teto, só dá pra registrar.
      const newVideoSettings = await applyVideoQualityConstraints(newVideoTrack, preset, 'switchScreenShareSource')
      if (exceedsH264FrameLimits(newVideoSettings.width, newVideoSettings.height)) {
        logDebug('switchScreenShareSource: ATENÇÃO — fonte nova acima do limite do H.264 e a redução não pegou')
      }
      // DÉCIMA PRIMEIRA RODADA: idem toggleScreenShare acima — no Linux
      // `newStream` já pode vir com a track de áudio embutida (seletor
      // nativo do sistema, ver captureScreenShareStream).
      let newAudioTrack: MediaStreamTrack | null = newStream.getAudioTracks()[0] ?? null
      newVideoTrack.contentHint = contentHintForPreset(preset)

      const oldVideoTrack = realScreenVideoTrackRef.current

      // Cancela o vigia de foco/fechamento da fonte ANTERIOR antes de
      // trocar — senão, se a fonte antiga fosse o caso especial "tela
      // cheia substituindo o jogo" e aquele jogo fechasse depois da
      // troca, o vigia antigo ainda ativo ia encerrar a transmissão NOVA
      // por engano, achando que ainda era sobre o jogo velho.
      gameShareWatchRef.current?.()
      gameShareWatchRef.current = null
      window.electronAPI?.stopWatchProcessExit?.().catch(() => {})
      foregroundWatchUnsubRef.current?.()
      foregroundWatchUnsubRef.current = null
      window.electronAPI?.stopForegroundWatch?.().catch(() => {})
      if (placeholderTrackRef.current) {
        placeholderTrackRef.current.stop()
        placeholderTrackRef.current = null
      }
      // Idem pra captura de áudio por processo (EXPERIMENTAL) da fonte
      // ANTERIOR — precisa encerrar o processo nativo velho antes de
      // (talvez) iniciar um novo pro PID recém-escolhido. `oldAudioTrackId`
      // acima já guardou o que precisa (o ID, não o objeto) pra achar o
      // sender certo daqui pra baixo, então pode parar com segurança.
      stopAppAudioCapture()
      appAudioTrackRef.current = null
      // QUINTA RODADA: idem — encerra o áudio de SISTEMA da fonte
      // ANTERIOR (se tinha) antes de (talvez) capturar um novo pra fonte
      // nova. Ver captureSystemAudioTrack acima e o comentário grande em
      // stopScreenShareState pro porquê dessa referência à parte existir.
      systemAudioTrackRef.current?.stop()
      systemAudioTrackRef.current = null
      if (!newAudioTrack && appAudioPid) {
        const appAudioTrack = await startAppAudioCapture(appAudioPid)
        if (appAudioTrack) {
          newAudioTrack = appAudioTrack
          appAudioTrackRef.current = appAudioTrack
        }
      }
      if (!newAudioTrack) {
        const systemAudio = await captureSystemAudioWithoutCallEcho()
        if (systemAudio) {
          newAudioTrack = systemAudio.track
          if (systemAudio.native) appAudioTrackRef.current = systemAudio.track
          else systemAudioTrackRef.current = systemAudio.track
        }
      }
      if (appAudioChoice?.isWindowChoice && !appAudioPid) {
        setError(
          newAudioTrack
            ? 'Não consegui identificar o processo do app/jogo — a transmissão vai com o áudio de todo o sistema em vez de só o dele (o vídeo continua normal).'
            : 'Não consegui identificar o processo do app/jogo, e também não consegui capturar o áudio de sistema — a transmissão vai sem áudio (o vídeo continua normal).'
        )
      }

      // DÉCIMA SÉTIMA RODADA: idem toggleScreenShare acima — filtra a
      // track de áudio da fonte NOVA antes de publicar.
      if (newAudioTrack) {
        const prepared = await prepareScreenAudioForSending(newAudioTrack)
        newAudioTrack = prepared.track
      } else {
        teardownScreenAudioDenoiser()
      }

      // Troca só o CONTEÚDO da publicação já existente via replaceTrack —
      // como isso não republica nem renegocia nada, não dispara nenhum
      // piscar de "parou/começou de novo" pra quem está assistindo,
      // exatamente como o replaceTrack em cada RTCRtpSender fazia antes.
      const videoPublishedTrack = screenVideoPublicationRef.current?.track as LocalVideoTrack | undefined
      if (videoPublishedTrack) {
        await videoPublishedTrack.replaceTrack(newVideoTrack, true)
        // A fonte nova pode ter outro preset (ex.: trocou de uma janela
        // qualquer pro jogo → "Jogo · 1080p60"): ajusta bitrate/fps/
        // prioridade do sender já negociado, sem republicar.
        applyScreenSenderEncoding(videoPublishedTrack, preset)
        setScreenSharePresetLabel(preset.label)
      }

      if (newAudioTrack && screenAudioPublicationRef.current?.track) {
        // Já existia áudio publicado antes — só troca o conteúdo.
        await (screenAudioPublicationRef.current.track as LocalAudioTrack).replaceTrack(newAudioTrack, true)
      } else if (newAudioTrack && !screenAudioPublicationRef.current && roomRef.current) {
        // Ganhou áudio que não existia antes (ex: trocou de "só uma
        // janela" pra "tela inteira" com o áudio do sistema marcado) —
        // precisa de uma publicação nova.
        screenAudioPublicationRef.current = await roomRef.current.localParticipant.publishTrack(
          newAudioTrack,
          SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS
        )
      } else if (!newAudioTrack && screenAudioPublicationRef.current) {
        // Perdeu o áudio que existia antes (ex: trocou de "tela inteira
        // com áudio do sistema" pra "só uma janela específica", que nunca
        // tem essa opção) — despublica de vez, replaceTrack(null) não é
        // suportado pra remover uma publicação no LiveKit.
        const oldAudioPublished = screenAudioPublicationRef.current.track
        if (oldAudioPublished) roomRef.current?.localParticipant.unpublishTrack(oldAudioPublished)
        screenAudioPublicationRef.current = null
      }

      // Só agora encerra a captura ANTIGA de verdade (indicador do
      // sistema apaga, recursos liberados) — e limpa o onended dela
      // ANTES de parar, senão ele ainda dispararia stopScreenShareState()
      // e derrubaria a transmissão NOVA que acabou de assumir o lugar.
      if (oldVideoTrack) oldVideoTrack.onended = null
      screenStreamRef.current?.getTracks().forEach((t) => t.stop())

      adopted = true
      screenStreamRef.current = newStream
      setLocalScreenStream(newStream)
      realScreenVideoTrackRef.current = newVideoTrack
      screenAudioOutputTrackRef.current = newAudioTrack
      newVideoTrack.onended = () => {
        stopScreenShareState()
      }

      // Mesmo par de mitigações de "compartilhar seu jogo" em tela cheia
      // do toggleScreenShare acima, agora pra a fonte NOVA — ver os
      // comentários grandes lá pra entender o esquema completo.
      if (gameShareHint && window.electronAPI) {
        window.electronAPI.watchProcessExit?.(gameShareHint.processNames).catch(() => {})
        gameShareWatchRef.current = window.electronAPI.onWatchedProcessExited(() => {
          stopScreenShareState()
        })
      }
      if (gameShareHint) startGameForegroundWatch(gameShareHint.processNames, newVideoTrack)
      window.electronAPI?.focusAppWindow?.()
    } catch (err) {
      // Cancelou o seletor, ou algo deu errado — mantém a transmissão
      // ATUAL rodando normalmente, sem interromper nada por causa de uma
      // troca que não deu certo. Mas a captura NOVA (se chegou a abrir)
      // precisa ser solta — antes ela ficava rodando órfã.
      if (newStream && !adopted) newStream.getTracks().forEach((t) => t.stop())
      if (!(err instanceof Error && err.name === 'NotAllowedError')) {
        logDebug(`switchScreenShareSource falhou — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`)
        setError('Não foi possível trocar a fonte da transmissão — a transmissão anterior continua no ar.')
      }
    } finally {
      screenShareOpRef.current = false
      setScreenShareConnecting(false)
    }
  }

  const clearError = useCallback(() => setError(null), [])

  // TRIGÉSIMA QUARTA RODADA — o polling de "quem está falando" (analyser
  // por participante, a cada 100ms) foi removido: já é tratado dentro de
  // attachRoomEvents, via RoomEvent.ActiveSpeakersChanged, que o LiveKit
  // dispara sozinho sempre que muda.

  // Valor dividido em "core" estável + "atividade" de alta frequência —
  // ver o comentário grande em voiceSplit.tsx (lentidão geral dos cliques
  // durante uma call). A lista de campos abaixo continua sendo a API
  // completa de useVoice().
  const splitValue = useSplitVoiceValue(
    {
        connectedChannelId,
        connectedChannelName,
        joiningChannelId,
        connectedAt,
        roomStartedAt,
        connectionQuality,
        localConnectionQuality,
        connectedServerId,
        connecting,
        reconnecting,
        canPublish,
        error,
        clearError,
        participants,
        muted,
        deafened,
        toggleDeafen,
        videoEnabled,
        localCameraStream,
        screenSharing,
        screenShareConnecting,
        localScreenStream,
        speaking,
        join,
        leave,
        toggleMute,
        pushToTalkEnabled,
        setPushToTalkEnabled,
        pushToTalkKey,
        setPushToTalkKey,
        pushToTalkActive,
        globalPushToTalkAvailable,
        pushToTalkGlobalKeyName,
        captureGlobalPushToTalkKey,
        toggleVideo,
        toggleScreenShare,
        switchScreenShareSource,
        screenSharePresetLabel,
        getScreenShareStatsReport,
        playSoundboardSound,
        changeMicrophone,
        refreshAudioConstraints,
        audioSettings,
        screenShareQuality,
        maxParticipants: MAX_PARTICIPANTS,
        masterVolume,
        setMasterVolume,
        soundboardVolume,
        setSoundboardVolume,
        getParticipantVolume,
        setParticipantVolume,
        getScreenShareVolume,
        setScreenShareVolume,
    },
    user?.id ?? null,
    // getParticipantVolume/getScreenShareVolume leem estes estados, que
    // não são campos do valor — força um "core" novo quando mudam.
    `${JSON.stringify(participantVolumes)}|${JSON.stringify(screenShareVolumes)}`
  )

  return (
    <VoiceActivityContext.Provider value={splitValue.store}>
      <VoiceCoreContext.Provider value={splitValue.core}>
        <VoiceContext.Provider value={splitValue.full}>{children}</VoiceContext.Provider>
      </VoiceCoreContext.Provider>
    </VoiceActivityContext.Provider>
  )
}
