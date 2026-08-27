import { describe, it, expect } from 'vitest'
import { preferStereoOpusForTrack } from './sdpStereo'

// SDP mínimo com DUAS seções m=audio (mic mono E a transmissão de tela,
// cada uma com seu próprio a=msid/track id) mais uma m=video — parecido
// com o que uma RTCPeerConnection real gera quando mic + tela (vídeo) +
// áudio da tela estão todos na mesma conexão. Serve pra garantir que a
// função mexe SÓ na seção certa (a da track pedida), deixando as outras
// intactas — é exatamente esse "vazamento pra seção errada" que
// deixaria o microfone em estéreo à toa (gastando banda sem motivo) ou
// o áudio da tela sem o estéreo que motivou sdpStereo.ts existir.
const MIC_TRACK_ID = 'mic-track-111'
const SCREEN_TRACK_ID = 'screen-audio-track-222'

function buildSdp(opts?: { screenHasOpus?: boolean; screenAlreadyStereo?: boolean }) {
  const screenHasOpus = opts?.screenHasOpus ?? true
  const screenAlreadyStereo = opts?.screenAlreadyStereo ?? false

  const micSection = [
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=mid:0',
    `a=msid:stream-mic ${MIC_TRACK_ID}`,
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
  ]

  const screenSection = screenHasOpus
    ? [
        'm=audio 9 UDP/TLS/RTP/SAVPF 111',
        'a=mid:2',
        `a=msid:stream-screen-audio ${SCREEN_TRACK_ID}`,
        'a=rtpmap:111 opus/48000/2',
        screenAlreadyStereo ? 'a=fmtp:111 minptime=10;stereo=1;sprop-stereo=1' : 'a=fmtp:111 minptime=10',
      ]
    : [
        'm=audio 9 UDP/TLS/RTP/SAVPF 0',
        'a=mid:2',
        `a=msid:stream-screen-audio ${SCREEN_TRACK_ID}`,
        'a=rtpmap:0 PCMU/8000',
      ]

  const videoSection = ['m=video 9 UDP/TLS/RTP/SAVPF 96', 'a=mid:1', 'a=msid:stream-screen-video video-track-333']

  return ['v=0', 'o=- 0 0 IN IP4 0.0.0.0', 's=-', 't=0 0', ...micSection, ...videoSection, ...screenSection].join(
    '\r\n'
  )
}

describe('preferStereoOpusForTrack', () => {
  it('devolve o SDP sem mexer quando targetTrackId é null', () => {
    const sdp = buildSdp()
    expect(preferStereoOpusForTrack(sdp, null)).toBe(sdp)
  })

  it('devolve o SDP sem mexer quando o próprio SDP está vazio', () => {
    expect(preferStereoOpusForTrack('', SCREEN_TRACK_ID)).toBe('')
  })

  it('adiciona stereo=1;sprop-stereo=1 na seção da track certa, quando ela já tem a=fmtp', () => {
    const sdp = buildSdp()
    const out = preferStereoOpusForTrack(sdp, SCREEN_TRACK_ID)
    const lines = out.split('\r\n')
    const screenMsidIndex = lines.findIndex((l) => l.includes(SCREEN_TRACK_ID))
    // a=fmtp da seção da TELA vem duas linhas depois do a=msid (rtpmap, fmtp)
    const screenFmtpLine = lines[screenMsidIndex + 2]
    expect(out).toContain('stereo=1;sprop-stereo=1')
    // a linha de fmtp da transmissão preserva o que já tinha (minptime) e ganha o sufixo
    expect(screenFmtpLine).toBe('a=fmtp:111 minptime=10;stereo=1;sprop-stereo=1')
    // e a seção do microfone (mesmo payload/codec) continua SEM stereo
    const micMsidIndex = lines.findIndex((l) => l.includes(MIC_TRACK_ID))
    expect(lines[micMsidIndex + 2]).toBe('a=fmtp:111 minptime=10;useinbandfec=1')
  })

  it('cria uma linha a=fmtp nova (logo depois do a=rtpmap) quando a seção não tinha nenhuma', () => {
    const sdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      `a=msid:stream-screen-audio ${SCREEN_TRACK_ID}`,
      'a=rtpmap:111 opus/48000/2',
    ].join('\r\n')
    const out = preferStereoOpusForTrack(sdp, SCREEN_TRACK_ID)
    const lines = out.split('\r\n')
    const rtpmapIndex = lines.findIndex((l) => l.startsWith('a=rtpmap:111'))
    expect(lines[rtpmapIndex + 1]).toBe('a=fmtp:111 stereo=1;sprop-stereo=1')
  })

  it('NÃO mexe na seção do microfone (outra track), mesmo tendo Opus também', () => {
    const sdp = buildSdp()
    const out = preferStereoOpusForTrack(sdp, SCREEN_TRACK_ID)
    const lines = out.split('\r\n')
    const micMsidIndex = lines.findIndex((l) => l.includes(MIC_TRACK_ID))
    const micSection = lines.slice(micMsidIndex - 1, micMsidIndex + 3)
    expect(micSection.some((l) => l.includes('stereo=1'))).toBe(false)
  })

  it('não duplica stereo=1;sprop-stereo=1 se a seção já estiver marcada', () => {
    const sdp = buildSdp({ screenAlreadyStereo: true })
    const out = preferStereoOpusForTrack(sdp, SCREEN_TRACK_ID)
    const occurrences = out.split('stereo=1;sprop-stereo=1').length - 1
    expect(occurrences).toBe(1)
  })

  it('não mexe em nada quando a seção da track não oferece Opus (outro codec)', () => {
    const sdp = buildSdp({ screenHasOpus: false })
    const out = preferStereoOpusForTrack(sdp, SCREEN_TRACK_ID)
    expect(out).toBe(sdp)
  })

  it('não mexe em nada quando nenhuma seção de áudio pertence à track pedida (id desconhecido)', () => {
    const sdp = buildSdp()
    const out = preferStereoOpusForTrack(sdp, 'track-que-nao-existe')
    expect(out).toBe(sdp)
  })

  it('deixa a seção m=video totalmente intacta', () => {
    const sdp = buildSdp()
    const out = preferStereoOpusForTrack(sdp, SCREEN_TRACK_ID)
    const videoLineBefore = sdp.split('\r\n').find((l) => l.startsWith('m=video'))
    const videoLineAfter = out.split('\r\n').find((l) => l.startsWith('m=video'))
    expect(videoLineAfter).toBe(videoLineBefore)
  })
})
