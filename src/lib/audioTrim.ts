export const MAX_SOUND_SECONDS = 10

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer()
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AudioContextCtor()
  try {
    return await ctx.decodeAudioData(arrayBuffer.slice(0))
  } finally {
    ctx.close().catch(() => {})
  }
}

export function trimAudioBufferToWav(buffer: AudioBuffer, startSec: number, endSec: number): Blob {
  const sampleRate = buffer.sampleRate
  const startSample = Math.max(0, Math.floor(startSec * sampleRate))
  const endSample = Math.min(buffer.length, Math.floor(endSec * sampleRate))
  const frameCount = Math.max(0, endSample - startSample)

  let mono = new Float32Array(frameCount)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < frameCount; i++) {
      mono[i] += data[startSample + i] / buffer.numberOfChannels
    }
  }

  const fade = Math.min(Math.floor(sampleRate * 0.008), Math.floor(frameCount / 2))
  for (let i = 0; i < fade; i++) {
    const g = i / fade
    mono[i] *= g
    mono[frameCount - 1 - i] *= g
  }

  let rate = sampleRate
  if (rate > 48000) {
    const ratio = rate / 48000
    const outLen = Math.floor(mono.length / ratio)
    const out = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio
      const i0 = Math.floor(pos)
      const i1 = Math.min(i0 + 1, mono.length - 1)
      const t = pos - i0
      out[i] = mono[i0] * (1 - t) + mono[i1] * t
    }
    mono = out
    rate = 48000
  }

  return encodeWavMono16(mono, rate)
}

export function computePeaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const peaks = new Float32Array(buckets)
  const step = Math.max(1, Math.floor(buffer.length / buckets))
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let b = 0; b < buckets; b++) {
      let max = 0
      const from = b * step
      const to = Math.min(from + step, data.length)
      for (let i = from; i < to; i += 4) {
        const v = Math.abs(data[i])
        if (v > max) max = v
      }
      if (max > peaks[b]) peaks[b] = max
    }
  }
  let top = 0
  for (let b = 0; b < buckets; b++) top = Math.max(top, peaks[b])
  if (top > 0) for (let b = 0; b < buckets; b++) peaks[b] /= top
  return peaks
}

export function isUploadReadyAudio(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const okType = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm'].includes(file.type)
  return okType && ['mp3', 'wav', 'ogg', 'webm'].includes(ext)
}

function encodeWavMono16(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2
  const blockAlign = bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}
