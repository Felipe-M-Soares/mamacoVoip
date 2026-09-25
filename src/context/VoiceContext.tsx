import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  ConnectionQuality as LiveKitConnectionQuality,
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
import { fetchLiveKitToken } from '../lib/livekit'
import { useAuth } from '../hooks/useAuth'
import { useAudioSettings } from '../hooks/useAudioSettings'
import { useScreenShareQuality, type QualityPreset } from '../hooks/useScreenShareQuality'
import { createNoiseSuppressor, type NoiseSuppressor, createScreenAudioDenoiser, type ScreenAudioDenoiser } from '../lib/noiseSuppression'
import { takePendingGameShareHint } from '../lib/screenShareGameHint'
import { takePendingAppAudioPid } from '../lib/pendingAppAudioCapture'
import { openScreenSharePicker } from '../lib/screenSharePickerBridge'
import { armScreenShareChoice } from '../lib/chooseScreenShareSource'
import { PcmStreamPlayer } from '../lib/pcmStreamPlayer'
import {
  playConnectSound,
  playDisconnectSound,
  playMuteSound,
  playUnmuteSound,
  playUserJoinSound,
  playUserLeaveSound,
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
const MIC_MAX_BITRATE = 128_000

// Bitrate do áudio da TRANSMISSÃO DE TELA (som do jogo/sistema) —
// diferente do preset de vídeo (que é sobre nitidez de imagem, em
// Mbps), e diferente do bitrate do microfone acima (voz mono precisa de
// bem menos que música/som de jogo estéreo). Antes esse áudio não
// recebia NENHUM ajuste, então ficava só no padrão baixo que o
// navegador usa pra Opus (~32kbps) — péssimo pra música ou som de jogo,
// que tem muito mais variação de frequência do que uma voz. 256kbps é
// próximo do que serviços de streaming de música chamam de "qualidade
// muito alta" (Opus estéreo satura a qualidade audível bem antes de
// 256kbps) — dá pra considerar isso o teto prático de "o máximo que
// vale a pena".
const SCREEN_SHARE_AUDIO_MAX_BITRATE = 256_000

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
async function applyVideoQualityConstraints(track: MediaStreamTrack, preset: QualityPreset) {
  try {
    await track.applyConstraints({
      width: preset.capResolution ? { ideal: preset.width, max: preset.width } : { ideal: preset.width },
      height: preset.capResolution ? { ideal: preset.height, max: preset.height } : { ideal: preset.height },
      frameRate: { ideal: preset.frameRate },
    })
  } catch {
    // Sem problema — a transmissão já está rolando com a resolução/taxa
    // nativa da captura (quase sempre já é boa o bastante sozinha); só
    // não conseguiu o ajuste fino extra dessa vez.
  }
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

  const unsubFormat = api.onFormat(({ width, height }) => {
    canvas.width = width
    canvas.height = height
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
    createImageBitmap(new Blob([frame.slice().buffer], { type: 'image/jpeg' }))
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

async function captureScreenShareStream(preset: QualityPreset, opts?: { auto?: boolean }): Promise<MediaStream> {
  if (!window.electronAPI) {
    throw new DOMException('Compartilhamento de tela só funciona no app desktop.', 'NotAllowedError')
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
  // É exatamente esse portal nativo que o Discord/OBS/Chrome usam no
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
        // como o Discord usam pra "Compartilhar uma janela" funcionar em
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

interface VoiceContextValue {
  connectedChannelId: string | null
  connectedChannelName: string | null
  joiningChannelId: string | null
  connectedAt: number | null
  connectionQuality: Record<string, VoiceConnectionQuality>
  // Qualidade da SUA PRÓPRIA conexão com o servidor de voz (LiveKit) —
  // diferente de `connectionQuality` acima, que é sobre cada OUTRO
  // participante. `null` fora de uma call.
  localConnectionQuality: VoiceConnectionQuality | null
  connectedServerId: string | null
  connecting: boolean
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
  playSoundboardSound: (url: string) => void
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
  const { user } = useAuth()
  const audioSettings = useAudioSettings()
  const screenShareQuality = useScreenShareQuality()
  const screenShareQualityRef = useRef(screenShareQuality.preset)
  screenShareQualityRef.current = screenShareQuality.preset
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
  const [connectionQuality, setConnectionQuality] = useState<Record<string, VoiceConnectionQuality>>({})
  const [localConnectionQuality, setLocalConnectionQuality] = useState<VoiceConnectionQuality | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Record<string, VoiceParticipant>>({})
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(false)
  const [videoEnabled, setVideoEnabled] = useState(false)
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
  const [pushToTalkActive, setPushToTalkActive] = useState(false)
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
  const pushToTalkGlobalKeycodeRef = useRef<number | null>(null)
  try {
    const raw = localStorage.getItem('mamacos-ptt-global-keycode')
    pushToTalkGlobalKeycodeRef.current = raw ? Number(raw) : null
  } catch {
    pushToTalkGlobalKeycodeRef.current = null
  }
  const usingGlobalPTTRef = useRef(false)
  usingGlobalPTTRef.current = globalPushToTalkAvailable && pushToTalkGlobalKeycodeRef.current !== null

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
      if (available && pushToTalkGlobalKeycodeRef.current !== null) {
        window.electronAPI?.setGlobalPTTKey?.(pushToTalkGlobalKeycodeRef.current)
      }
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
      setPushToTalkActive(true)
      applyMicEnabledState(true)
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (usingGlobalPTTRef.current) return
      if (!pushToTalkEnabledRef.current || e.code !== pushToTalkKeyRef.current) return
      setPushToTalkActive(false)
      applyMicEnabledState(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [speaking, setSpeaking] = useState(false)

  const [masterVolume, setMasterVolumeState] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('mamacos-master-volume')
      return raw ? Number(raw) : 100
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

  // "Desativar áudio" (deafen) — igual o Discord: para de ouvir todo
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
  const preDeafenVolumeRef = useRef(100)
  const preDeafenWasMutedRef = useRef(false)
  function toggleDeafen() {
    if (deafenedRef.current) {
      setMasterVolume(preDeafenVolumeRef.current)
      if (!preDeafenWasMutedRef.current && mutedRef.current) toggleMute()
      setDeafened(false)
    } else {
      preDeafenVolumeRef.current = masterVolume
      preDeafenWasMutedRef.current = mutedRef.current
      setMasterVolume(0)
      if (!mutedRef.current) toggleMute()
      setDeafened(true)
    }
  }

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
    return participantVolumes[userId] ?? 100
  }

  function setParticipantVolume(userId: string, volume: number) {
    // DÉCIMA OITAVA RODADA: teto subiu de 100 pra 200 — "qualidade tá boa
    // mas o volume tá baixo" quando quem fala tem captação de mic fraca
    // não tinha solução nenhuma antes: 100% aqui só reproduzia o áudio
    // exatamente como chegou, sem reforço nenhum possível. Ver o GainNode
    // novo em RemoteAudio (CallMediaTiles.tsx), que agora sabe amplificar
    // de verdade acima de 100%, não só atenuar.
    const clamped = Math.max(0, Math.min(200, volume))
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

  function getScreenShareVolume(userId: string): number {
    return screenShareVolumes[userId] ?? 100
  }

  function setScreenShareVolume(userId: string, volume: number) {
    const clamped = Math.max(0, Math.min(100, volume))
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
  const channelUserLimitRef = useRef(0)
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
  const noiseFloorDbRef = useRef<number | null>(null)
  const lastAppliedThresholdDbRef = useRef<number | null>(null)
  function resetAutoSensitivity() {
    noiseFloorDbRef.current = null
    lastAppliedThresholdDbRef.current = null
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
    Map<string, { camera: MediaStream | null; screen: MediaStream | null; trackIds: string }>
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
  async function startAppAudioCapture(pid: number): Promise<MediaStreamTrack | null> {
    logDebug(`startAppAudioCapture: iniciando pra pid=${pid}`)
    if (!window.electronAPI?.startProcessAudioCapture) {
      logDebug('startAppAudioCapture: window.electronAPI.startProcessAudioCapture não existe (fora do Electron?)')
      return null
    }
    try {
      const result = await window.electronAPI.startProcessAudioCapture(pid)
      if (!result?.ok) {
        logDebug(`startAppAudioCapture: IPC voltou ok=false — ${result?.error ?? '(sem mensagem)'}`)
        setError(
          result?.error
            ? `Captura de áudio só deste app falhou: ${result.error}`
            : 'Não foi possível capturar o áudio só deste app.'
        )
        return null
      }
      logDebug('startAppAudioCapture: IPC voltou ok=true, esperando confirmação (format/error)...')
    } catch (err) {
      logDebug(`startAppAudioCapture: IPC startProcessAudioCapture lançou exceção — ${String(err)}`)
      setError('Não foi possível capturar o áudio só deste app.')
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
        setError(`Captura de áudio só deste app falhou: ${message}`)
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
            `startAppAudioCapture: nem process-audio:format nem process-audio:error chegaram em ${APP_AUDIO_CONFIRM_TIMEOUT_MS}ms (pid ${pid}) — caindo pro áudio de sistema.`
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
      const audioStream = await navigator.mediaDevices.getUserMedia(constraints)
      const track = audioStream.getAudioTracks()[0] ?? null
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
      screenAudioPublicationRef.current = await roomRef.current.localParticipant.publishTrack(prepared.track, {
        name: 'screen-audio',
        source: Track.Source.ScreenShareAudio,
        audioPreset: { maxBitrate: SCREEN_SHARE_AUDIO_MAX_BITRATE },
        forceStereo: true,
        dtx: false,
      })
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

    const noiseSuppressionEnabled = overrides?.noiseSuppression ?? audioSettingsRef.current.noiseSuppression
    if (!noiseSuppressionEnabled) {
      noiseSuppressorRef.current?.destroy()
      noiseSuppressorRef.current = null
      resetAutoSensitivity()
      return rawTrack
    }

    const mode = overrides?.micSensitivityMode ?? audioSettingsRef.current.micSensitivityMode
    // No modo automático começa com o gate totalmente aberto (null) —
    // o useEffect "Sensibilidade automática do microfone" mede o ruído
    // ambiente e calcula o limiar certo sozinho poucos instantes depois
    // (ver esse useEffect mais abaixo). Usar o valor manual como palpite
    // inicial não faria sentido, já que o objetivo do modo automático é
    // exatamente não depender desse número.
    const sensitivity = mode === 'auto' ? null : overrides?.micSensitivity ?? audioSettingsRef.current.micSensitivity

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
      return noiseSuppressorRef.current.setInputTrack(rawTrack, sensitivity)
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

  // Toca um efeito do soundboard localmente — igual o Discord, o áudio
  // é reproduzido direto pelo alto-falante de cada um (não é misturado
  // no microfone/mídia publicada). Usa o volume PRÓPRIO do soundboard
  // (soundboardVolume), não o volume geral da call — cada pessoa que
  // ESCUTA controla o quanto os efeitos tocam pra ela, sem depender de
  // quem enviou o som.
  function playLocalSoundboardAudio(url: string) {
    try {
      const audio = new Audio(url)
      audio.volume = soundboardVolume / 100
      audio.play().catch(() => {
        // navegador pode bloquear play() sem interação recente — sem
        // problema, quem clicou no botão do som É a interação
      })
    } catch {
      // fonte de áudio inválida/indisponível — não deveria travar a call
    }
  }

  // Toca o som pra MIM (na hora) e avisa todo mundo mais no canal de voz
  // pra tocarem a mesma URL aí também — cada um busca e reproduz
  // localmente, em vez de misturar no stream de voz (senão quem está
  // ouvindo o eco do RNNoise/gate ouviria o som distorcido/cortado).
  // Continua indo pelo canal Realtime do Supabase (ver joinPresenceChannel
  // logo abaixo) — o LiveKit também tem um jeito de mandar dados
  // (publishData), mas trocar isso não traria nenhum benefício aqui e só
  // aumentaria o escopo da migração sem necessidade.
  function playSoundboardSound(url: string) {
    playLocalSoundboardAudio(url)
    const from = userIdRef.current
    if (presenceRef.current && from) {
      presenceRef.current.send({ type: 'broadcast', event: 'soundboard-play', payload: { from, url } })
    }
  }

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

    combinedStreamsRef.current.set(participantId, { camera, screen, trackIds })
    setParticipants((prev) => ({
      ...prev,
      [participantId]: {
        userId: participantId,
        speaking: prev[participantId]?.speaking ?? false,
        cameraStream: camera,
        screenStream: screen,
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
    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      if (participant.identity === myId) return
      playUserJoinSound()
    })

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
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
        logDebug(
          `TrackSubscribed de ${participant.identity}: source=${track.source}, kind=${track.kind}`
        )
        setRemoteTrack(participant.identity, track.source, track.mediaStreamTrack)
      }
    )

    room.on(
      RoomEvent.TrackUnsubscribed,
      (_track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        setRemoteTrack(participant.identity, publication.source, null)
      }
    )

    // Substitui o antigo polling de AnalyserNode por participante (ver o
    // comentário grande em remoteTracksRef acima) — o LiveKit já faz essa
    // detecção nativamente e manda a lista de quem está falando AGORA,
    // sempre que ela muda (inclui o participante local também).
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      const speakingIds = new Set(speakers.map((s) => s.identity))
      setSpeaking(speakingIds.has(myId))
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
        if (participant.identity === myId) {
          setLocalConnectionQuality(mapConnectionQuality(quality))
          return
        }
        setConnectionQuality((prev) => ({ ...prev, [participant.identity]: mapConnectionQuality(quality) }))
      }
    )

    room.on(RoomEvent.Disconnected, () => {
      // Desconexão vinda do SERVIDOR (não de um leave() nosso — esse já
      // chama room.disconnect() e limpa tudo por conta própria antes
      // disso disparar) — ex.: LiveKit derrubou a sessão, ou a rede caiu
      // de vez. Trata como uma saída normal pra não deixar a UI presa
      // num estado "conectado" que não reflete mais a realidade.
      if (connectedRef.current) {
        setError('A conexão com o canal de voz caiu.')
        leave()
      }
    })
  }

  const join = useCallback(async (channelId: string, serverId: string | null, options?: { displayName?: string; userLimit?: number }) => {
    if (!user || connectedRef.current) return
    // Ver o comentário grande em leaveTeardownRef — espera o
    // desligamento em segundo plano de uma saída recente terminar antes
    // de assinar o MESMO tópico Realtime de novo, senão o presence
    // 'sync' que volta pode vir incompleto.
    if (leaveTeardownRef.current) {
      await leaveTeardownRef.current
    }
    // Avisa a UI (a lista de canais) IMEDIATAMENTE que estamos prestes a
    // entrar nesse canal, antes de qualquer trabalho assíncrono (pedir
    // microfone, etc.) — isso dá tempo do observador de presença na
    // barra lateral (useVoicePresence) se desinscrever do mesmo canal
    // Realtime ANTES da gente tentar se inscrever de verdade nele.
    // Sem isso, a primeira tentativa de entrar sempre colidia com essa
    // inscrição de observação já existente.
    setJoiningChannelId(channelId)
    setConnecting(true)
    setError(null)
    channelUserLimitRef.current = 0
    joinedAtRef.current = Date.now()

    // Chamada em DM/grupo (serverId null) não tem linha na tabela
    // channels pra buscar — nome e limite vêm de `options` (o valor já
    // resolvido do lado de quem chamou join(), ex.: nome da outra
    // pessoa na DM ou nome do grupo).
    if (serverId) {
      const { data: channelRow } = await supabase.from('channels').select('user_limit, name').eq('id', channelId).single()
      channelUserLimitRef.current = channelRow?.user_limit ?? 0
      setConnectedChannelName(channelRow?.name ?? null)
    } else {
      channelUserLimitRef.current = options?.userLimit ?? 0
      setConnectedChannelName(options?.displayName ?? null)
    }

    let room: Room | null = null
    try {
      const stream = await getUserMediaWithRetry({ audio: audioSettingsRef.current.getAudioConstraints() })
      const rawTrack = stream.getAudioTracks()[0]
      const processedTrack = await applyNoiseSuppression(rawTrack)
      if (processedTrack !== rawTrack) {
        stream.removeTrack(rawTrack)
        stream.addTrack(processedTrack)
      }
      localStreamRef.current = stream
      mutedRef.current = false
      applyMicEnabledState(false)

      // Canal Realtime do Supabase — hoje serve só pra DUAS coisas, bem
      // mais simples do que antes: (1) anunciar "estou nesse canal de
      // voz" pra sidebar conseguir mostrar quem está numa call sem
      // precisar entrar nela (ver useVoicePresence.ts, que observa esse
      // MESMO tópico de fora); (2) o broadcast do soundboard. Tudo o
      // mais que esse canal fazia antes (sinalização WebRTC, meta de
      // compartilhamento de tela, e a checagem de limite de vagas) foi
      // pro LiveKit — a mídia em si nem passa mais por aqui, e o limite
      // de vagas agora é checado do lado do SERVIDOR (ver
      // supabase/functions/livekit-token), sem risco de corrida entre
      // dois cliques quase simultâneos.
      const rt = supabase.channel(`voice:${channelId}`, {
        config: { broadcast: { self: false }, presence: { key: user.id } },
      })
      presenceRef.current = rt

      rt.on('broadcast', { event: 'soundboard-play' }, ({ payload }) => {
        const { url } = payload as { from: string; url: string }
        playLocalSoundboardAudio(url)
      })

      await new Promise<void>((resolve, reject) => {
        rt.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await rt.track({ user_id: user.id, joined_at: joinedAtRef.current })
            resolve()
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            reject(new Error('Falha ao conectar ao canal de voz'))
          }
        })
      })

      // Conecta de verdade na sala do LiveKit (a mídia em si) — o token
      // já vem com a checagem de limite de vagas feita do lado do
      // servidor (ver supabase/functions/livekit-token); `RoomFullError`
      // é o sinal específico disso, tratado no catch abaixo pra mostrar
      // a mesma mensagem de antes ("Esse canal de voz já está cheio.").
      const { token, url: livekitUrl } = await fetchLiveKitToken({
        room: channelId,
        name: options?.displayName,
        userLimit: channelUserLimitRef.current,
      })

      room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          dtx: true,
          red: true,
        },
      })
      attachRoomEvents(room, user.id)
      await room.connect(livekitUrl, token)
      roomRef.current = room

      // Publica o microfone (já tratado pelo RNNoise/gate — ver
      // applyNoiseSuppression acima) e guarda a publicação, usada
      // depois por toggleMute/changeMicrophone/refreshAudioConstraints
      // pra trocar/mutar a track sem precisar procurar em lugar nenhum.
      micPublicationRef.current = await room.localParticipant.publishTrack(processedTrack, {
        name: 'microphone',
        source: Track.Source.Microphone,
        audioPreset: { maxBitrate: MIC_MAX_BITRATE },
      })

      connectedRef.current = true
      setConnectedChannelId(channelId)
      setConnectedServerId(serverId)
      setConnectedAt(Date.now())
      playConnectSound()
    } catch (err) {
      const isRoomFull = err instanceof Error && err.name === 'RoomFullError'
      setError(
        isRoomFull
          ? 'Esse canal de voz já está cheio.'
          : err instanceof Error && err.name === 'NotAllowedError'
            ? 'Permissão de microfone negada. Habilite o acesso ao microfone e tente de novo.'
            : 'Não foi possível entrar no canal de voz.'
      )
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
      rawMicTrackRef.current?.stop()
      rawMicTrackRef.current = null
      noiseSuppressorRef.current?.destroy()
      noiseSuppressorRef.current = null
      micPublicationRef.current = null
      if (room) {
        room.disconnect()
        roomRef.current = null
      }
      if (presenceRef.current) {
        supabase.removeChannel(presenceRef.current)
        presenceRef.current = null
      }
    } finally {
      setConnecting(false)
      setJoiningChannelId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const leave = useCallback(() => {
    const wasConnected = connectedRef.current
    if (roomRef.current) {
      // Desconecta a sala do LiveKit — isso já para/despublica todas as
      // tracks locais sozinho (mic, câmera, tela), mas paramos elas
      // explicitamente também logo abaixo (idempotente, sem custo) pra
      // garantir que o dispositivo físico (luzinha do mic/câmera) seja
      // liberado mesmo se a desconexão em si falhar por algum motivo.
      roomRef.current.disconnect()
      roomRef.current = null
    }
    micPublicationRef.current = null
    cameraPublicationRef.current = null
    screenVideoPublicationRef.current = null
    screenAudioPublicationRef.current = null
    remoteTracksRef.current.clear()
    combinedStreamsRef.current.clear()
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
    screenStreamRef.current?.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
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
    connectedRef.current = false
    setConnectedChannelId(null)
    setConnectedChannelName(null)
    setConnectedServerId(null)
    setConnectedAt(null)
    setConnecting(false)
    setMuted(false)
    // Se a pessoa saiu da call já "desativada" (deafened), o volume geral
    // ficou em 0 — sem isso aqui, a próxima call começaria sem áudio
    // nenhum sem nenhuma pista visual do porquê.
    if (deafenedRef.current) setMasterVolume(preDeafenVolumeRef.current)
    setDeafened(false)
    setVideoEnabled(false)
    setScreenSharing(false)
    setSpeaking(false)
    if (wasConnected) playDisconnectSound()
  }, [])

  // Só desconecta quando o Provider inteiro desmonta (ex: logout) —
  // NÃO reage a troca de canal/servidor visualizado, que é exatamente o
  // comportamento que corrige o bug de "sair da call ao trocar de tela".
  useEffect(() => {
    return () => {
      if (connectedRef.current) leave()
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

      const floor = noiseFloorDbRef.current
      if (floor === null) {
        noiseFloorDbRef.current = level
        return
      }
      noiseFloorDbRef.current = level < floor ? floor * 0.7 + level * 0.3 : floor * 0.98 + level * 0.02

      const AUTO_SENSITIVITY_MARGIN_DB = 12
      const threshold = Math.max(-80, Math.min(-20, noiseFloorDbRef.current + AUTO_SENSITIVITY_MARGIN_DB))

      // Só reaplica se mudou de verdade (>=1.5dB) — o gate é recriado a
      // cada chamada de setSensitivityDb, então reaplicar a cada segundo
      // por causa de flutuações mínimas geraria um "clique" audível toda
      // hora à toa.
      const last = lastAppliedThresholdDbRef.current
      if (last === null || Math.abs(threshold - last) >= 1.5) {
        lastAppliedThresholdDbRef.current = threshold
        suppressor.setSensitivityDb(threshold)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // --- Canal AFK: move automaticamente quem fica inativo -------------
  const afkConfigRef = useRef<{ channelId: string | null; timeoutMinutes: number } | null>(null)
  const lastActivityRef = useRef(Date.now())

  useEffect(() => {
    if (!connectedServerId) {
      afkConfigRef.current = null
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
      })
  }, [connectedServerId])

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

  useEffect(() => {
    const interval = setInterval(() => {
      const config = afkConfigRef.current
      if (!connectedRef.current || !config?.channelId || !connectedChannelId || !connectedServerId) return
      if (connectedChannelId === config.channelId) return // já está no canal AFK
      const idleMs = Date.now() - lastActivityRef.current
      if (idleMs >= config.timeoutMinutes * 60_000) {
        const afkChannelId = config.channelId
        const serverId = connectedServerId
        leave()
        setTimeout(() => join(afkChannelId, serverId), 300)
      }
    }, 30_000)
    return () => clearInterval(interval)
  }, [connectedChannelId, connectedServerId, leave, join])

  async function changeMicrophone(deviceId: string) {
    // "" representa "Padrão do sistema" no <select> — normaliza pra null
    // pra bater com o tipo que StoredSettings.micId realmente usa (ver
    // useAudioSettings.ts). getAudioConstraints já trata os dois como
    // "sem preferência de dispositivo" na prática, mas persistir null é
    // mais correto do que uma string vazia.
    audioSettingsRef.current.setMicId(deviceId || null)
    if (!connectedRef.current) return
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: audioSettingsRef.current.getAudioConstraints(deviceId),
      })
      const rawTrack = newStream.getAudioTracks()[0]
      const newTrack = await applyNoiseSuppression(rawTrack)
      newTrack.enabled = !muted

      const oldTrack = localStreamRef.current?.getAudioTracks()[0]
      if (oldTrack) {
        oldTrack.stop()
        localStreamRef.current?.removeTrack(oldTrack)
      }
      localStreamRef.current?.addTrack(newTrack)

      // `true` marca a track como "fornecida pelo usuário" pro LiveKit —
      // ele não tenta gerenciar/recriar essa track sozinho (o que
      // ignoraria todo o pipeline de RNNoise/gate acima), só a usa e
      // troca no sender de verdade, exatamente como o antigo
      // `sender.replaceTrack()` fazia em cada RTCPeerConnection.
      const micTrack = micPublicationRef.current?.track as LocalAudioTrack | undefined
      if (micTrack) await micTrack.replaceTrack(newTrack, true)
    } catch {
      setError('Não foi possível trocar de microfone.')
    }
  }

  // Reaplica as configurações de áudio atuais (cancelamento de eco,
  // redução de ruído, ganho automático) no microfone já conectado —
  // usado pelos botões de liga/desliga (ao lado do perfil e em
  // Configurações → Áudio), pra a mudança valer na call em andamento
  // sem precisar reconectar.
  //
  // `overrides` é opcional e existe só pra evitar uma corrida com o
  // React: quem chama essa função normalmente acabou de chamar
  // setNoiseSuppression/setEchoCancellation/setAutoGainControl um
  // instante antes, mas a atualização de estado é assíncrona — nesse
  // mesmo clique, `audioSettingsRef.current` ainda reflete o valor
  // ANTIGO (de antes do clique), porque o React só re-renderiza (e
  // atualiza o ref) depois. Sem passar o valor novo explicitamente
  // aqui, o toggle sempre aplicava a configuração de um clique atrás —
  // dava a impressão de que o redutor de ruído simplesmente não fazia
  // nada.
  async function refreshAudioConstraints(
    overrides?: Partial<
      Pick<
        ReturnType<typeof useAudioSettings>,
        'echoCancellation' | 'noiseSuppression' | 'autoGainControl' | 'micSensitivity' | 'micSensitivityMode'
      >
    >
  ) {
    if (!connectedRef.current) return
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: audioSettingsRef.current.getAudioConstraints(undefined, overrides),
      })
      const rawTrack = newStream.getAudioTracks()[0]
      const newTrack = await applyNoiseSuppression(rawTrack, {
        noiseSuppression: overrides?.noiseSuppression,
        micSensitivity: overrides?.micSensitivity,
        micSensitivityMode: overrides?.micSensitivityMode,
      })
      newTrack.enabled = !muted

      const oldTrack = localStreamRef.current?.getAudioTracks()[0]
      if (oldTrack) {
        oldTrack.stop()
        localStreamRef.current?.removeTrack(oldTrack)
      }
      localStreamRef.current?.addTrack(newTrack)

      const micTrack = micPublicationRef.current?.track as LocalAudioTrack | undefined
      if (micTrack) await micTrack.replaceTrack(newTrack, true)
    } catch {
      // se falhar, o microfone atual continua funcionando com as configs antigas
    }
  }

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    const newMuted = !muted
    mutedRef.current = newMuted
    setMuted(newMuted)
    applyMicEnabledState(pushToTalkActive)
    if (newMuted) playMuteSound()
    else playUnmuteSound()
  }

  async function toggleVideo() {
    if (videoEnabled) {
      const track = localStreamRef.current?.getVideoTracks()[0]
      if (track) {
        if (cameraPublicationRef.current) {
          await roomRef.current?.localParticipant.unpublishTrack(track)
          cameraPublicationRef.current = null
        }
        track.stop()
        localStreamRef.current?.removeTrack(track)
      }
      setVideoEnabled(false)
      return
    }
    try {
      // VIGÉSIMA QUARTA RODADA — ver StoredSettings.cameraId
      // (useAudioSettings.ts) pro porquê: deixa escolher uma câmera
      // virtual (ex.: "OBS Virtual Camera") em vez da webcam de
      // verdade. `exact` faz falhar explicitamente se o dispositivo
      // escolhido não existir mais (ex.: OBS fechado) em vez de cair
      // silenciosamente na webcam padrão sem avisar ninguém.
      const cameraId = audioSettingsRef.current.cameraId
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
      })
      const track = camStream.getVideoTracks()[0]
      localStreamRef.current?.addTrack(track)
      if (roomRef.current) {
        cameraPublicationRef.current = await roomRef.current.localParticipant.publishTrack(track, {
          name: 'camera',
          source: Track.Source.Camera,
        })
      }
      setVideoEnabled(true)
    } catch (err) {
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
    if (screenVideoPublicationRef.current) {
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

  async function toggleScreenShare(opts?: { auto?: boolean }) {
    if (screenSharing) {
      stopScreenShareState()
      return
    }
    setScreenShareConnecting(true)
    try {
      const preset = screenShareQualityRef.current
      // OITAVA RODADA: getDisplayMedia() foi abandonado — ver o
      // comentário grande em captureScreenShareStream acima pro
      // raciocínio completo. A qualidade (resolução/taxa de quadros)
      // continua sendo ajustada DEPOIS, na track já ativa.
      const stream = await captureScreenShareStream(preset, opts)
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
      screenStreamRef.current = stream
      setLocalScreenStream(stream)
      const videoTrack = stream.getVideoTracks()[0]
      // Ajuste de qualidade best-effort, à parte — ver
      // applyVideoQualityConstraints acima. Não bloqueia nem arrisca a
      // transmissão: se falhar, só continua na resolução/taxa nativa.
      void applyVideoQualityConstraints(videoTrack, preset)
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
      // juntos no mesmo MediaStream, exatamente como o Chrome/Discord
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
        const systemAudioTrack = await captureSystemAudioTrack()
        if (systemAudioTrack) {
          audioTrack = systemAudioTrack
          systemAudioTrackRef.current = systemAudioTrack
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
      // "motion" prioriza fluidez de movimento em vez de nitidez de
      // texto estático — melhor pra compartilhar jogo/vídeo do que a
      // opção padrão, que otimiza pra tela parada (documento, planilha)
      videoTrack.contentHint = 'motion'
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
        screenVideoPublicationRef.current = await roomRef.current.localParticipant.publishTrack(videoTrack, {
          name: 'screen',
          source: Track.Source.ScreenShare,
          screenShareEncoding: {
            maxBitrate: preset.maxBitrate,
            maxFramerate: preset.frameRate,
          },
          degradationPreference: preset.degradationPreference,
          simulcast: false,
        })
        if (audioTrack) {
          // Mesmo ajuste de antes — o áudio da transmissão precisa do
          // PRÓPRIO teto de bitrate (pensado pra som de jogo/música,
          // bem maior que o do microfone) e estéreo de verdade
          // (forceStereo substitui o antigo SDP munging manual de
          // sdpStereo.ts — o LiveKit já negocia isso nativamente).
          screenAudioPublicationRef.current = await roomRef.current.localParticipant.publishTrack(audioTrack, {
            name: 'screen-audio',
            source: Track.Source.ScreenShareAudio,
            audioPreset: { maxBitrate: SCREEN_SHARE_AUDIO_MAX_BITRATE },
            forceStereo: true,
            dtx: false,
          })
        }
      }
      setScreenSharing(true)

      // Mitigação de vazamento pro caso "compartilhar seu jogo" em tela
      // cheia (sem janela própria — ver comentário grande acima e em
      // ScreenSharePicker.tsx): enquanto isso estiver ativo, o processo
      // principal (só Windows, best-effort — ver electron/main.cjs)
      // avisa quando a pessoa alterna pra fora do jogo, e a gente troca
      // o vídeo enviado pelos peers por uma "cortina" preta até ela
      // voltar. Em Mac/Linux, ou se o vigia não conseguir iniciar (volta
      // `false`), simplesmente não faz nada — o compartilhamento
      // continua igual ao de antes (sempre visível), sem quebrar nada.
      if (gameShareHint && window.electronAPI?.startForegroundWatch) {
        window.electronAPI
          .startForegroundWatch(gameShareHint.processNames)
          .then((started) => {
            if (!started || !window.electronAPI) return
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
                const placeholder = placeholderTrackRef.current
                publishedTrack.replaceTrack(placeholder, true).catch(() => {})
              }
            })
          })
          .catch(() => {
            // Sem sorte iniciando o vigia (PowerShell bloqueado por
            // política do sistema, por exemplo) — segue sem essa camada
            // extra de proteção, sem interromper o compartilhamento.
          })
      }
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
      // solução que resolve a mesma limitação no Discord/OBS/Zoom.
      const likelyExclusiveFullscreen = name === 'NotReadableError'
      const base = parts.length ? `Não foi possível compartilhar a tela: ${parts.join(' ')}` : 'Não foi possível compartilhar a tela.'
      setError(
        likelyExclusiveFullscreen
          ? `${base} — o jogo provavelmente está em modo de tela cheia EXCLUSIVA. Troque pra "tela cheia sem bordas" (borderless) nas configurações de vídeo do jogo e tente compartilhar de novo.`
          : base
      )
    } finally {
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
    if (!screenSharing || !screenStreamRef.current) return
    setScreenShareConnecting(true)
    try {
      const preset = screenShareQualityRef.current
      // OITAVA RODADA: idem toggleScreenShare acima — ver
      // captureScreenShareStream.
      const newStream = await captureScreenShareStream(preset)
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
      // Ajuste de qualidade best-effort, à parte — ver
      // applyVideoQualityConstraints acima.
      void applyVideoQualityConstraints(newVideoTrack, preset)
      // DÉCIMA PRIMEIRA RODADA: idem toggleScreenShare acima — no Linux
      // `newStream` já pode vir com a track de áudio embutida (seletor
      // nativo do sistema, ver captureScreenShareStream).
      let newAudioTrack: MediaStreamTrack | null = newStream.getAudioTracks()[0] ?? null
      newVideoTrack.contentHint = 'motion'

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
        const systemAudioTrack = await captureSystemAudioTrack()
        if (systemAudioTrack) {
          newAudioTrack = systemAudioTrack
          systemAudioTrackRef.current = systemAudioTrack
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
      }

      if (newAudioTrack && screenAudioPublicationRef.current?.track) {
        // Já existia áudio publicado antes — só troca o conteúdo.
        await (screenAudioPublicationRef.current.track as LocalAudioTrack).replaceTrack(newAudioTrack, true)
      } else if (newAudioTrack && !screenAudioPublicationRef.current && roomRef.current) {
        // Ganhou áudio que não existia antes (ex: trocou de "só uma
        // janela" pra "tela inteira" com o áudio do sistema marcado) —
        // precisa de uma publicação nova.
        screenAudioPublicationRef.current = await roomRef.current.localParticipant.publishTrack(newAudioTrack, {
          name: 'screen-audio',
          source: Track.Source.ScreenShareAudio,
          audioPreset: { maxBitrate: SCREEN_SHARE_AUDIO_MAX_BITRATE },
          forceStereo: true,
          dtx: false,
        })
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
      screenStreamRef.current.getTracks().forEach((t) => t.stop())

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
      if (gameShareHint && window.electronAPI?.startForegroundWatch) {
        window.electronAPI
          .startForegroundWatch(gameShareHint.processNames)
          .then((started) => {
            if (!started || !window.electronAPI) return
            foregroundWatchUnsubRef.current = window.electronAPI.onGameForegroundChanged((focused) => {
              const realTrack = realScreenVideoTrackRef.current
              const publishedTrack = screenVideoPublicationRef.current?.track as LocalVideoTrack | undefined
              if (!realTrack || !publishedTrack) return
              if (focused) {
                publishedTrack.replaceTrack(realTrack, true).catch(() => {})
                if (placeholderTrackRef.current) {
                  placeholderTrackRef.current.stop()
                  placeholderTrackRef.current = null
                }
              } else {
                if (!placeholderTrackRef.current) placeholderTrackRef.current = createPlaceholderVideoTrack()
                const placeholder = placeholderTrackRef.current
                publishedTrack.replaceTrack(placeholder, true).catch(() => {})
              }
            })
          })
          .catch(() => {})
      }
      window.electronAPI?.focusAppWindow?.()
    } catch {
      // Cancelou o seletor, ou algo deu errado — mantém a transmissão
      // ATUAL rodando normalmente, sem interromper nada por causa de uma
      // troca que não deu certo.
    } finally {
      setScreenShareConnecting(false)
    }
  }

  // TRIGÉSIMA QUARTA RODADA — o polling de "quem está falando" (analyser
  // por participante, a cada 100ms) foi removido: já é tratado dentro de
  // attachRoomEvents, via RoomEvent.ActiveSpeakersChanged, que o LiveKit
  // dispara sozinho sempre que muda.

  return (
    <VoiceContext.Provider
      value={{
        connectedChannelId,
        connectedChannelName,
        joiningChannelId,
        connectedAt,
        connectionQuality,
        localConnectionQuality,
        connectedServerId,
        connecting,
        error,
        clearError: () => setError(null),
        participants,
        muted,
        deafened,
        toggleDeafen,
        videoEnabled,
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
      }}
    >
      {children}
    </VoiceContext.Provider>
  )
}
