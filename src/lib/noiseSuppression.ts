import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseWasmSimdPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
// Porteiro de voz próprio, com rampas suaves (ver o arquivo).
import voiceGateWorkletPath from './worklets/voiceGateWorklet.js?url&no-inline'

// RNNoise (biblioteca da Xiph/Mozilla — mesma família usada dentro do
// Firefox) é uma rede neural pequena, treinada especificamente pra
// separar voz de ruído de fundo (ventoinha, teclado mecânico, som do
// jogo vazando pro microfone, etc.) — bem mais forte do que o
// cancelamento de ruído nativo do Chromium sozinho (ver
// useAudioSettings.ts). Roda inteiro no dispositivo da pessoa via WASM,
// sem mandar áudio pra nenhum servidor externo.
//
// Isso é usado COMO REFORÇO, além das constraints nativas do
// getUserMedia (echoCancellation/noiseSuppression/autoGainControl
// continuam ativas) — não no lugar delas.
//
// Depois do RNNoise, passa por um "gate" (porteiro) de ruído: uma
// segunda etapa, bem mais simples, que corta o áudio de vez quando o
// volume fica abaixo de um limite (a "sensibilidade" configurável pela
// pessoa, manual ou automática). O RNNoise sozinho reduz ruído
// CONTÍNUO (chiado, zumbido, ventoinha) mas não é bom com sons de
// impacto (tecla de teclado, mesa batendo) — o gate resolve exatamente
// esse caso: se não tem volume de voz suficiente, corta tudo.

// O binário WASM (só os bytes, baixados uma vez via fetch) é seguro de
// compartilhar entre vários AudioContext diferentes — por isso fica
// cacheado aqui fora, em vez de baixado de novo toda vez que alguém
// entra numa call ou troca de microfone.
let wasmBinaryPromise: Promise<ArrayBuffer> | null = null
function getWasmBinary(): Promise<ArrayBuffer> {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseWasmSimdPath }).catch((err) => {
      // Não deixa uma falha passageira (rede caiu no primeiro download)
      // ficar cacheada pra sempre — antes, a Promise REJEITADA ficava
      // guardada aqui e o RNNoise nunca mais funcionava até reiniciar o app.
      wasmBinaryPromise = null
      throw err
    })
  }
  return wasmBinaryPromise
}

/**
 * Baixa os bytes do WASM do RNNoise antes de alguém entrar numa call
 * (chamado em idle pelo MainLayout) — assim o "entrar no canal de voz"
 * não espera esse download depois de pegar o microfone. Best-effort.
 */
export function preloadNoiseSuppression() {
  getWasmBinary().catch(() => {})
}

// Cria o AudioContext dedicado e registra os worklets. Se QUALQUER etapa
// falhar (WASM não baixou, addModule rejeitou por CSP, etc.), fecha o
// contexto antes de propagar o erro — antes ele ficava aberto e órfão
// (cada tentativa de entrar numa call vazava um AudioContext inteiro,
// e o Chromium tem um limite baixo de contextos simultâneos).
async function createProcessingContext(workletPaths: string[]): Promise<{ audioContext: AudioContext; wasmBinary: ArrayBuffer }> {
  const audioContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
  try {
    const wasmBinary = await getWasmBinary()
    for (const path of workletPaths) {
      await audioContext.audioWorklet.addModule(path)
    }
    // Um contexto criado fora de um gesto do usuário pode nascer
    // "suspended" (política de autoplay) — nesse estado o gráfico não
    // processa nada e a track de saída fica MUDA.
    if (audioContext.state === 'suspended') await audioContext.resume().catch(() => {})
    return { audioContext, wasmBinary }
  } catch (err) {
    audioContext.close().catch(() => {})
    throw err
  }
}

// Sensibilidade do microfone (modo MANUAL): 0 (menos sensível — só sons
// bem altos "abrem" o microfone) a 100 (mais sensível — quase tudo
// passa, gate praticamente nunca fecha). Convertida pra um limiar em
// dBFS, a escala que o gate realmente entende.
export const MIN_MIC_SENSITIVITY = 0
export const MAX_MIC_SENSITIVITY = 100
export const DEFAULT_MIC_SENSITIVITY = 50

const SENSITIVITY_MIN_DB = -80 // sensibilidade 100 — gate quase sempre aberto
const SENSITIVITY_MAX_DB = -20 // sensibilidade 0 — só som bem alto abre

function sensitivityToOpenThresholdDb(sensitivity: number): number {
  const clamped = Math.max(MIN_MIC_SENSITIVITY, Math.min(MAX_MIC_SENSITIVITY, sensitivity))
  const t = clamped / 100
  return SENSITIVITY_MAX_DB + t * (SENSITIVITY_MIN_DB - SENSITIVITY_MAX_DB)
}

export interface NoiseSuppressor {
  // Troca qual track BRUTA (do microfone, sem processamento) está sendo
  // filtrada agora — chame de novo sempre que o microfone mudar (troca
  // de dispositivo, reconexão). Devolve uma track NOVA, já tratada, pra
  // usar no lugar da bruta em todo o resto do app (medidor de nível,
  // envio pros outros participantes da call, etc.). A track bruta
  // continua sendo dona do dispositivo físico — quem chama ainda
  // precisa parar ela manualmente quando não for mais usar (essa
  // função só conecta um nó de processamento nela, não assume posse).
  //
  // `sensitivity` é 0-100 (ver MIN/MAX/DEFAULT_MIC_SENSITIVITY acima).
  // `null` desliga o gate por completo (só RNNoise, sem cortar nada por
  // volume).
  setInputTrack: (rawTrack: MediaStreamTrack, sensitivity?: number | null) => MediaStreamTrack
  // Troca só o limiar do gate (0-100, igual setInputTrack) SEM
  // reconstruir o resto do gráfico de áudio (RNNoise, destino) — a
  // track de SAÍDA continua sendo exatamente o mesmo objeto de antes.
  // Importante pro modo automático, que reajusta isso a cada poucos
  // segundos: se cada ajuste trocasse a track de saída, seria preciso
  // trocar de track no envio pra call inteira toda vez, causando uma
  // engasgadinha no áudio.
  setSensitivity: (sensitivity: number | null) => void
  // Mesma ideia que `setSensitivity`, mas recebe o limiar já em dBFS
  // direto (em vez de 0-100) — usado pelo modo automático, que calcula
  // o limiar sozinho a partir do ruído de fundo medido.
  setSensitivityDb: (thresholdDb: number | null) => void
  // Nível atual do sinal (dBFS aproximado, RMS), medido DEPOIS do
  // RNNoise e ANTES do gate. Usado pelo modo automático pra estimar o
  // "piso" de ruído ambiente — medir DEPOIS do gate criaria um ciclo
  // vicioso (gate fecha → parece silêncio total → piso estimado cai →
  // limiar cai → gate abre fácil demais → repete pra sempre).
  sampleLevelDb: () => number | null
  // Libera tudo (nós de áudio + o AudioContext dedicado). Chame ao sair
  // da call ou quando a pessoa desativar a redução de ruído.
  destroy: () => void
}

// Cria um redutor de ruído novo. Pode falhar (raro) em navegadores sem
// suporte a AudioWorklet, ou se o WASM não carregar por algum motivo de
// rede/CSP — quem chama deve tratar isso como "sem reforço extra,
// segue só com o cancelamento nativo do navegador", nunca como erro
// fatal pra call inteira.
export async function createNoiseSuppressor(): Promise<NoiseSuppressor> {
  // Trava em 48kHz: é a taxa que o RNNoise espera internamente
  // (documentado pela própria biblioteca — processa em quadros fixos de
  // 10ms). Sem forçar isso explicitamente, o AudioContext podia nascer
  // numa taxa diferente dependendo do hardware da pessoa, e o
  // processamento saía errado — na prática, mais chiado/distorção em vez
  // de menos.
  // Os módulos dos worklets precisam ser registrados em CADA
  // AudioContext (não são compartilhados entre contextos diferentes) —
  // como esse contexto acabou de ser criado agora mesmo, isso só roda
  // uma vez por chamada de createNoiseSuppressor.
  const { audioContext, wasmBinary } = await createProcessingContext([rnnoiseWorkletPath, voiceGateWorkletPath])

  let source: MediaStreamAudioSourceNode | null = null
  let rnnoiseNode: RnnoiseWorkletNode | null = null
  let gateNode: AudioWorkletNode | null = null
  let merger: ChannelMergerNode | null = null
  let destination: MediaStreamAudioDestinationNode | null = null
  let levelAnalyser: AnalyserNode | null = null
  let levelBuffer: Uint8Array<ArrayBuffer> | null = null

  function teardownGraph() {
    try {
      source?.disconnect()
    } catch {
      // já desconectado — sem problema
    }
    try {
      rnnoiseNode?.disconnect()
      rnnoiseNode?.destroy()
    } catch {
      // já destruído — sem problema
    }
    try {
      gateNode?.disconnect()
      gateNode?.port.close()
    } catch {
      // já desconectado — sem problema
    }
    try {
      merger?.disconnect()
    } catch {
      // já desconectado — sem problema
    }
    try {
      levelAnalyser?.disconnect()
    } catch {
      // já desconectado — sem problema
    }
    source = null
    rnnoiseNode = null
    gateNode = null
    merger = null
    levelAnalyser = null
    levelBuffer = null
  }

  // Muda só o limiar do porteiro (null = sem porteiro), por mensagem —
  // o gráfico de áudio e a track de saída continuam os mesmos, sem estalo.
  function rewireGate(thresholdDb: number | null) {
    gateNode?.port.postMessage({ thresholdDb })
  }

  function setInputTrack(rawTrack: MediaStreamTrack, sensitivity: number | null = DEFAULT_MIC_SENSITIVITY): MediaStreamTrack {
    teardownGraph()
    source = audioContext.createMediaStreamSource(new MediaStream([rawTrack]))
    // Força o sinal que entra no RNNoise a ser mono de verdade,
    // independente de quantos canais o hardware do microfone realmente
    // capturou — o RNNoise só processa 1 canal (maxChannels: 1 abaixo),
    // e alimentar ele com uma fonte que o navegador ainda considera
    // "estéreo" gerava processamento inconsistente.
    source.channelCount = 1
    source.channelCountMode = 'explicit'
    source.channelInterpretation = 'speakers'

    rnnoiseNode = new RnnoiseWorkletNode(audioContext, { wasmBinary, maxChannels: 1 })
    source.connect(rnnoiseNode)

    // "Escuta" o sinal já limpo pelo RNNoise, sem se conectar em mais
    // nada além do analisador (é só uma leitura passiva, não faz parte
    // do caminho até o destino).
    levelAnalyser = audioContext.createAnalyser()
    levelAnalyser.fftSize = 512
    levelBuffer = new Uint8Array(levelAnalyser.fftSize)
    rnnoiseNode.connect(levelAnalyser)

    // Duplica o canal mono explicitamente pros dois lados (esquerdo e
    // direito) via um ChannelMergerNode, em vez de confiar no upmix
    // automático do navegador — em alguns casos o Chromium tocava uma
    // MediaStream de 1 canal só no alto-falante ESQUERDO em vez de nos
    // dois, e essa duplicação manual evita esse problema de vez.
    merger = audioContext.createChannelMerger(2)
    gateNode = new AudioWorkletNode(audioContext, 'mv-voice-gate', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        thresholdDb: sensitivity === null ? null : sensitivityToOpenThresholdDb(sensitivity),
        holdMs: 250,
      },
    })
    rnnoiseNode.connect(gateNode)
    gateNode.connect(merger, 0, 0)
    gateNode.connect(merger, 0, 1)

    destination = audioContext.createMediaStreamDestination()
    merger.connect(destination)
    return destination.stream.getAudioTracks()[0]
  }

  function setSensitivity(sensitivity: number | null) {
    rewireGate(sensitivity === null ? null : sensitivityToOpenThresholdDb(sensitivity))
  }

  function setSensitivityDb(thresholdDb: number | null) {
    rewireGate(thresholdDb)
  }

  function sampleLevelDb(): number | null {
    if (!levelAnalyser || !levelBuffer) return null
    levelAnalyser.getByteTimeDomainData(levelBuffer)
    let sumSquares = 0
    for (let i = 0; i < levelBuffer.length; i++) {
      const v = (levelBuffer[i] - 128) / 128
      sumSquares += v * v
    }
    const rms = Math.sqrt(sumSquares / levelBuffer.length)
    if (rms <= 0.0001) return -80
    return 20 * Math.log10(rms)
  }

  function destroy() {
    teardownGraph()
    audioContext.close().catch(() => {
      // já fechado — sem problema
    })
  }

  return { setInputTrack, setSensitivity, setSensitivityDb, sampleLevelDb, destroy }
}

// DÉCIMA SÉTIMA RODADA — o mesmo motor (RNNoise) do microfone, aplicado
// agora no ÁUDIO DA TRANSMISSÃO DE TELA (som do jogo/sistema), pra
// resolver um chiado/estática CONSTANTE relatado numa transmissão via
// captura por processo (WASAPI "process loopback" — ver
// process-audio-capture.exe): revisando o código nativo, não achamos
// nenhum bug óbvio de lá causando isso — é uma limitação conhecida
// dessa API específica do Windows em algumas máquinas/drivers, não algo
// que dê pra "consertar" na captura em si. RNNoise é bom exatamente
// nesse tipo de ruído CONTÍNUO (ver o comentário grande no topo deste
// arquivo), então reaproveitá-lo aqui é razoável — mas montado bem
// diferente do microfone:
//   - SEM o "gate": o gate corta o áudio inteiro quando o volume cai
//     abaixo de um limiar — ótimo pra voz (silêncio entre frases), mas
//     errado pra som de jogo/música, que tem trechos baixos/silenciosos
//     LEGÍTIMOS que não deveriam ser cortados.
//   - EM ESTÉREO de verdade (maxChannels: 2, documentado pelo pacote —
//     processa os dois canais como duas instâncias RNNoise
//     independentes, uma por canal) em vez de forçar mono como o
//     microfone faz — preserva a separação espacial do jogo, que
//     importa pro som ficar bom (é o mesmo motivo da correção de SDP em
//     sdpStereo.ts, que força a=fmtp;stereo=1 pra essa track).
export interface ScreenAudioDenoiser {
  setInputTrack: (rawTrack: MediaStreamTrack) => MediaStreamTrack
  destroy: () => void
}

export async function createScreenAudioDenoiser(): Promise<ScreenAudioDenoiser> {
  const { audioContext, wasmBinary } = await createProcessingContext([rnnoiseWorkletPath])

  let source: MediaStreamAudioSourceNode | null = null
  let rnnoiseNode: RnnoiseWorkletNode | null = null
  const destination = audioContext.createMediaStreamDestination()

  function setInputTrack(rawTrack: MediaStreamTrack): MediaStreamTrack {
    try {
      source?.disconnect()
    } catch {
      // já desconectado — sem problema
    }
    try {
      rnnoiseNode?.disconnect()
      rnnoiseNode?.destroy()
    } catch {
      // já destruído — sem problema
    }
    source = audioContext.createMediaStreamSource(new MediaStream([rawTrack]))
    rnnoiseNode = new RnnoiseWorkletNode(audioContext, { wasmBinary, maxChannels: 2 })
    source.connect(rnnoiseNode)
    rnnoiseNode.connect(destination)
    return destination.stream.getAudioTracks()[0]
  }

  function destroy() {
    try {
      source?.disconnect()
    } catch {
      // já desconectado — sem problema
    }
    try {
      rnnoiseNode?.disconnect()
      rnnoiseNode?.destroy()
    } catch {
      // já destruído — sem problema
    }
    source = null
    rnnoiseNode = null
    audioContext.close().catch(() => {
      // já fechado — sem problema
    })
  }

  return { setInputTrack, destroy }
}
