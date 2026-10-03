// Teste REAL de codificação, sem depender de ninguém assistindo: liga duas
// conexões WebRTC dentro do próprio app (uma manda, a outra recebe), manda
// um vídeo de teste de um canvas por ~2 s em cada formato e lê no getStats
// QUAL codificador o Chromium usou de verdade (placa de vídeo ou
// processador). É a mesma engrenagem da transmissão — então o resultado
// vale pra qualquer placa, sem lista de modelos.

export type EncodeTestResult = { hw: boolean | null; impl: string | null }
export type EncodeCodecKey = 'h264' | 'vp9' | 'av1'

const MIME: Record<EncodeCodecKey, string> = { h264: 'video/H264', vp9: 'video/VP9', av1: 'video/AV1' }

function pickCodecs(key: EncodeCodecKey): RTCRtpCodec[] | null {
  const caps = RTCRtpSender.getCapabilities?.('video')
  if (!caps) return null
  let list = caps.codecs.filter((c) => c.mimeType.toLowerCase() === MIME[key].toLowerCase())
  if (key === 'h264') {
    // O que o LiveKit/WebRTC negocia pra transmissão: baseline, modo 1.
    const preferred = list.filter((c) => /packetization-mode=1/.test(c.sdpFmtpLine ?? '') && /42e01f/i.test(c.sdpFmtpLine ?? ''))
    if (preferred.length) list = preferred
  }
  return list.length ? list : null
}

function isHardware(stat: Record<string, unknown>): boolean | null {
  if (typeof stat.powerEfficientEncoder === 'boolean') return stat.powerEfficientEncoder
  const impl = typeof stat.encoderImplementation === 'string' ? stat.encoderImplementation : ''
  if (!impl || /unknown/i.test(impl)) return null
  return !/openh264|libvpx|libaom|software|fallback/i.test(impl)
}

export async function testEncoder(key: EncodeCodecKey, timeoutMs = 6000): Promise<EncodeTestResult> {
  const codecs = pickCodecs(key)
  if (!codecs || typeof RTCPeerConnection === 'undefined') return { hw: false, impl: null }

  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')
  let frame = 0
  const draw = () => {
    if (!ctx) return
    frame++
    ctx.fillStyle = `hsl(${(frame * 7) % 360} 60% 40%)`
    ctx.fillRect(0, 0, 1280, 720)
    ctx.fillStyle = '#fff'
    ctx.fillRect((frame * 13) % 1200, (frame * 7) % 680, 80, 40)
  }
  draw()
  const timer = window.setInterval(draw, 33)
  const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(30)
  const track = stream.getVideoTracks()[0]
  const pc1 = new RTCPeerConnection()
  const pc2 = new RTCPeerConnection()
  const cleanup = () => {
    window.clearInterval(timer)
    track?.stop()
    pc1.close()
    pc2.close()
  }
  try {
    pc1.onicecandidate = (e) => e.candidate && pc2.addIceCandidate(e.candidate).catch(() => {})
    pc2.onicecandidate = (e) => e.candidate && pc1.addIceCandidate(e.candidate).catch(() => {})
    const tr = pc1.addTransceiver(track, { direction: 'sendonly' })
    tr.setCodecPreferences(codecs)
    pc2.addTransceiver('video', { direction: 'recvonly' })
    const params = tr.sender.getParameters()
    if (params.encodings?.[0]) {
      params.encodings[0].maxBitrate = 4_000_000
      await tr.sender.setParameters(params).catch(() => {})
    }
    const offer = await pc1.createOffer()
    await pc1.setLocalDescription(offer)
    await pc2.setRemoteDescription(offer)
    const answer = await pc2.createAnswer()
    await pc2.setLocalDescription(answer)
    await pc1.setRemoteDescription(answer)

    const deadline = Date.now() + timeoutMs
    let last: EncodeTestResult = { hw: null, impl: null }
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400))
      const report = await tr.sender.getStats()
      for (const s of report.values() as IterableIterator<Record<string, unknown>>) {
        if (s.type !== 'outbound-rtp') continue
        const frames = typeof s.framesEncoded === 'number' ? s.framesEncoded : 0
        const impl = typeof s.encoderImplementation === 'string' ? s.encoderImplementation : null
        last = { hw: isHardware(s), impl }
        // Depois de ~1 s codificando o Chromium já trocou pro software,
        // se fosse trocar.
        if (frames > 40 && last.hw !== null) return last
      }
    }
    return last
  } catch {
    return { hw: false, impl: null }
  } finally {
    cleanup()
  }
}
