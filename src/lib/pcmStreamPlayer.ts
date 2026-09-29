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
// Atraso máximo tolerado entre "agora" e o fim do áudio já agendado. O
// relógio do processo nativo (WASAPI) e o do AudioContext nunca batem
// 100% — se os pedaços chegam um tiquinho mais rápido do que tocam, o
// agendamento abaixo ia acumulando atraso SEM LIMITE (depois de uma
// hora de transmissão, o som do jogo chegava segundos atrasado em
// relação ao vídeo). Passou desse teto, o pedaço novo é DESCARTADO (em
// vez de realinhar — realinhar pra "agora" com áudio ainda agendado na
// frente faria dois pedaços tocarem sobrepostos, soando embolado).
export const PCM_MAX_SCHEDULE_AHEAD_S = 0.3
// Folga usada ao (re)alinhar — pequena o bastante pra não somar latência
// perceptível, grande o bastante pra absorver a variação normal do IPC.
export const PCM_REALIGN_LEAD_S = 0.04

// Decide ONDE o próximo pedaço deve começar a tocar (função pura,
// testável). `null` = descartar esse pedaço (fila adiantada demais).
export function nextPcmStartTime(nextStartTime: number, now: number): number | null {
  if (nextStartTime < now) return now + PCM_REALIGN_LEAD_S
  if (nextStartTime - now > PCM_MAX_SCHEDULE_AHEAD_S) return null
  return nextStartTime
}

export class PcmStreamPlayer {
  private ctx: AudioContext
  private destination: MediaStreamAudioDestinationNode
  private nextStartTime = 0
  private format: { sampleRate: number; channels: number; sampleFormat: 'float32' | 'int16' } | null = null
  private closed = false

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    this.destination = this.ctx.createMediaStreamDestination()
    // Contexto criado fora de um gesto do usuário pode nascer suspenso
    // (autoplay) — aí nada toca e a transmissão sai muda.
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
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

    const startAt = nextPcmStartTime(this.nextStartTime, this.ctx.currentTime)
    if (startAt === null) return

    const source = this.ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(this.destination)
    // Solta o nó do gráfico assim que terminar de tocar — são dezenas de
    // pedaços por segundo, não vale depender só do GC pra isso.
    source.onended = () => {
      try {
        source.disconnect()
      } catch {
        // já desconectado
      }
    }

    // Se a gente ficou pra trás (pedaços chegando mais devagar que o
    // consumo, ex: uma pausa momentânea do processo principal), realinha
    // pra "agora + uma folguinha" em vez de tentar tocar tudo que ficou
    // acumulado de uma vez (o que soaria como um áudio acelerado/robótico).
    // E se ficou ADIANTADO demais (deriva de relógio), idem — ver
    // PCM_MAX_SCHEDULE_AHEAD_S.
    this.nextStartTime = startAt
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
