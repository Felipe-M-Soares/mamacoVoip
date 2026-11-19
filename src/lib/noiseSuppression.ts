import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseWasmSimdPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
import voiceGateWorkletPath from './worklets/voiceGateWorklet.js?url&no-inline'

let wasmBinaryPromise: Promise<ArrayBuffer> | null = null
function getWasmBinary(): Promise<ArrayBuffer> {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseWasmSimdPath }).catch((err) => {
      wasmBinaryPromise = null
      throw err
    })
  }
  return wasmBinaryPromise
}

export function preloadNoiseSuppression() {
  getWasmBinary().catch(() => {})
}

async function createProcessingContext(workletPaths: string[]): Promise<{ audioContext: AudioContext; wasmBinary: ArrayBuffer }> {
  const audioContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
  try {
    const wasmBinary = await getWasmBinary()
    for (const path of workletPaths) {
      await audioContext.audioWorklet.addModule(path)
    }
    if (audioContext.state === 'suspended') await audioContext.resume().catch(() => {})
    return { audioContext, wasmBinary }
  } catch (err) {
    audioContext.close().catch(() => {})
    throw err
  }
}

export const MIN_MIC_SENSITIVITY = 0
export const MAX_MIC_SENSITIVITY = 100
export const DEFAULT_MIC_SENSITIVITY = 40

const SENSITIVITY_MIN_DB = -80
const SENSITIVITY_MAX_DB = -20

export function sensitivityToOpenThresholdDb(sensitivity: number): number {
  const clamped = Math.max(MIN_MIC_SENSITIVITY, Math.min(MAX_MIC_SENSITIVITY, sensitivity))
  const t = clamped / 100
  return SENSITIVITY_MAX_DB + t * (SENSITIVITY_MIN_DB - SENSITIVITY_MAX_DB)
}

export { createAutoSensitivity, AUTO_SENSITIVITY_TICK_MS } from './autoSensitivity'

export interface NoiseSuppressor {
  setInputTrack: (rawTrack: MediaStreamTrack, sensitivity?: number | null, options?: { denoise?: boolean }) => MediaStreamTrack
  setSensitivity: (sensitivity: number | null) => void
  setSensitivityDb: (thresholdDb: number | null) => void
  sampleLevelDb: () => number | null
  destroy: () => void
}

export async function createNoiseSuppressor(): Promise<NoiseSuppressor> {
  const { audioContext, wasmBinary } = await createProcessingContext([rnnoiseWorkletPath, voiceGateWorkletPath])

  let source: MediaStreamAudioSourceNode | null = null
  let rnnoiseNode: RnnoiseWorkletNode | null = null
  let gateNode: AudioWorkletNode | null = null
  let merger: ChannelMergerNode | null = null
  let destination: MediaStreamAudioDestinationNode | null = null
  let levelAnalyser: AnalyserNode | null = null
  let levelBuffer: Float32Array<ArrayBuffer> | null = null

  function teardownGraph() {
    try {
      source?.disconnect()
    } catch {
    }
    try {
      rnnoiseNode?.disconnect()
      rnnoiseNode?.destroy()
    } catch {
    }
    try {
      gateNode?.disconnect()
      gateNode?.port.close()
    } catch {
    }
    try {
      merger?.disconnect()
    } catch {
    }
    try {
      levelAnalyser?.disconnect()
    } catch {
    }
    source = null
    rnnoiseNode = null
    gateNode = null
    merger = null
    levelAnalyser = null
    levelBuffer = null
  }

  function rewireGate(thresholdDb: number | null) {
    gateNode?.port.postMessage({ thresholdDb })
  }

  function setInputTrack(
    rawTrack: MediaStreamTrack,
    sensitivity: number | null = DEFAULT_MIC_SENSITIVITY,
    options: { denoise?: boolean } = {}
  ): MediaStreamTrack {
    const denoise = options.denoise !== false
    teardownGraph()
    source = audioContext.createMediaStreamSource(new MediaStream([rawTrack]))
    source.channelCount = 1
    source.channelCountMode = 'explicit'
    source.channelInterpretation = 'speakers'

    let preGate: AudioNode = source
    if (denoise) {
      rnnoiseNode = new RnnoiseWorkletNode(audioContext, { wasmBinary, maxChannels: 1 })
      source.connect(rnnoiseNode)
      preGate = rnnoiseNode
    }

    levelAnalyser = audioContext.createAnalyser()
    levelAnalyser.fftSize = 512
    levelBuffer = new Float32Array(levelAnalyser.fftSize)
    preGate.connect(levelAnalyser)

    merger = audioContext.createChannelMerger(2)
    gateNode = new AudioWorkletNode(audioContext, 'mv-voice-gate', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        thresholdDb: sensitivity === null ? null : sensitivityToOpenThresholdDb(sensitivity),
        holdMs: 250,
        sustainMs: 50,
      },
    })
    preGate.connect(gateNode)
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
    levelAnalyser.getFloatTimeDomainData(levelBuffer)
    let sumSquares = 0
    for (let i = 0; i < levelBuffer.length; i++) {
      const v = levelBuffer[i]
      sumSquares += v * v
    }
    const rms = Math.sqrt(sumSquares / levelBuffer.length)
    if (rms <= 0.0001) return -80
    return Math.max(-80, 20 * Math.log10(rms))
  }

  function destroy() {
    teardownGraph()
    audioContext.close().catch(() => {
    })
  }

  return { setInputTrack, setSensitivity, setSensitivityDb, sampleLevelDb, destroy }
}

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
    }
    try {
      rnnoiseNode?.disconnect()
      rnnoiseNode?.destroy()
    } catch {
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
    }
    try {
      rnnoiseNode?.disconnect()
      rnnoiseNode?.destroy()
    } catch {
    }
    source = null
    rnnoiseNode = null
    audioContext.close().catch(() => {
    })
  }

  return { setInputTrack, destroy }
}
