import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseWasmSimdPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'

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

// O binário WASM (só os bytes, baixados uma vez via fetch) é seguro de
// compartilhar entre vários AudioContext diferentes — por isso fica
// cacheado aqui fora, em vez de baixado de novo toda vez que alguém
// entra numa call ou troca de microfone.
let wasmBinaryPromise: Promise<ArrayBuffer> | null = null
function getWasmBinary(): Promise<ArrayBuffer> {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseWasmSimdPath })
  }
  return wasmBinaryPromise
}

export interface NoiseSuppressor {
  // Troca qual track BRUTA (do microfone, sem processamento) está sendo
  // filtrada agora — chame de novo sempre que o microfone mudar (troca
  // de dispositivo, reconexão). Devolve uma track NOVA, já tratada, pra
  // usar no lugar da bruta em todo o resto do app (medidor de nível,
  // envio pros outros participantes da call, etc.). A track bruta
  // continua sendo dona do dispositivo físico — quem chama ainda precisa
  // parar ela manualmente quando não for mais usar (essa função só
  // conecta um nó de processamento nela, não assume posse).
  setInputTrack: (rawTrack: MediaStreamTrack) => MediaStreamTrack
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
  const audioContext = new AudioContext({ sampleRate: 48000 })
  const wasmBinary = await getWasmBinary()
  // O módulo do worklet precisa ser registrado em CADA AudioContext
  // (não é compartilhado entre contextos diferentes) — como esse
  // contexto acabou de ser criado agora mesmo, isso só roda uma vez por
  // chamada de createNoiseSuppressor.
  await audioContext.audioWorklet.addModule(rnnoiseWorkletPath)

  let source: MediaStreamAudioSourceNode | null = null
  let node: RnnoiseWorkletNode | null = null

  function teardownGraph() {
    try {
      source?.disconnect()
    } catch {
      // já desconectado — sem problema
    }
    try {
      node?.disconnect()
      node?.destroy()
    } catch {
      // já destruído — sem problema
    }
    source = null
    node = null
  }

  function setInputTrack(rawTrack: MediaStreamTrack): MediaStreamTrack {
    teardownGraph()
    source = audioContext.createMediaStreamSource(new MediaStream([rawTrack]))
    node = new RnnoiseWorkletNode(audioContext, { wasmBinary, maxChannels: 1 })
    const destination = audioContext.createMediaStreamDestination()
    source.connect(node)
    node.connect(destination)
    return destination.stream.getAudioTracks()[0]
  }

  function destroy() {
    teardownGraph()
    audioContext.close().catch(() => {
      // já fechado — sem problema
    })
  }

  return { setInputTrack, destroy }
}
