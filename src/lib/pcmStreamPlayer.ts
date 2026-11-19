export const PCM_MAX_SCHEDULE_AHEAD_S = 0.3
export const PCM_REALIGN_LEAD_S = 0.04

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
    source.onended = () => {
      try {
        source.disconnect()
      } catch {
      }
    }

    this.nextStartTime = startAt
    source.start(this.nextStartTime)
    this.nextStartTime += audioBuffer.duration
  }

  close() {
    this.closed = true
    try {
      this.destination.stream.getTracks().forEach((t) => t.stop())
    } catch {
    }
    this.ctx.close().catch(() => {})
  }
}
