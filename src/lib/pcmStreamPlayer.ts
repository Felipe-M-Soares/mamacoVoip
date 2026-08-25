// Toca um fluxo contínuo de PCM (chegando aos pedaços, via IPC — ver
// process-audio-capture.exe / electron/main.cjs / VoiceContext.tsx) como
// um MediaStreamTrack de áudio de verdade, pra poder ser adicionado numa
// RTCPeerConnection igual qualquer outra fonte de áudio (mic, tela).
//
// Como funciona: cada pedaço recebido vira um AudioBuffer decodificado na
// mão (os bytes já chegam em PCM cru — float32 ou int16 intercalado, ver
// o cabeçalho de process-audio-capture.exe), tocado através de um
// AudioBufferSourceNode agendado pra começar EXATAMENTE onde o pedaço
// anterior termina (nextStartTime), em vez de tocar "agora" — isso evita
// estalos/cortes entre pedaços consecutivos, o mesmo princípio usado por
// qualquer tocador de áudio em streaming via Web Audio API. Sem esse
// agendamento preciso, pequenas variações no tempo de entrega de cada
// pedaço (comum em qualquer IPC) causariam microcortes constantes.
export class PcmStreamPlayer {
  private ctx: AudioContext
  private destination: MediaStreamAudioDestinationNode
  private nextStartTime = 0
  private format: { sampleRate: number; channels: number; sampleFormat: 'float32' | 'int16' } | null = null
  private closed = false

  constructor() {
    this.ctx = new AudioContext()
    this.destination = this.ctx.createMediaStreamDestination()
  }

  get stream(): MediaStream {
    return this.destination.stream
  }

  setFormat(format: { sampleRate: number; channels: number; sampleFormat: 'float32' | 'int16' }) {
    this.format = format
    this.nextStartTime = this.ctx.currentTime
  }

  push(chunk: Uint8Array) {
    if (this.closed || !this.format || chunk.byteLength === 0) return
    const { channels, sampleRate, sampleFormat } = this.format
    if (channels <= 0) return

    const bytesPerSample = sampleFormat === 'float32' ? 4 : 2
    const bytesPerFrame = bytesPerSample * channels
    const frameCount = Math.floor(chunk.byteLength / bytesPerFrame)
    if (frameCount <= 0) return

    let audioBuffer: AudioBuffer
    try {
      audioBuffer = this.ctx.createBuffer(channels, frameCount, sampleRate)
    } catch {
      // sampleRate/channels vieram de fora (o .exe), com uma proteção
      // extra caso algum dia venha um valor absurdo — melhor perder um
      // pedaço de áudio do que derrubar a call inteira.
      return
    }

    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    for (let ch = 0; ch < channels; ch++) {
      const channelData = audioBuffer.getChannelData(ch)
      for (let i = 0; i < frameCount; i++) {
        const byteOffset = (i * channels + ch) * bytesPerSample
        channelData[i] = sampleFormat === 'float32' ? view.getFloat32(byteOffset, true) : view.getInt16(byteOffset, true) / 32768
      }
    }

    const source = this.ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(this.destination)

    const now = this.ctx.currentTime
    // Se a gente ficou pra trás (pedaços chegando mais devagar que o
    // consumo, ex: uma pausa momentânea do processo principal), realinha
    // pra "agora + uma folguinha" em vez de tentar tocar tudo que ficou
    // acumulado de uma vez (o que soaria como um áudio acelerado/robótico).
    if (this.nextStartTime < now) this.nextStartTime = now + 0.02
    source.start(this.nextStartTime)
    this.nextStartTime += audioBuffer.duration
  }

  close() {
    this.closed = true
    try {
      this.destination.stream.getTracks().forEach((t) => t.stop())
    } catch {
      // já pode ter parado sozinho
    }
    this.ctx.close().catch(() => {})
  }
}
