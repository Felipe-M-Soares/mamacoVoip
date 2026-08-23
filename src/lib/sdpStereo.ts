// O WebRTC, por padrão, manda TUDO em mono — mesmo quando o microfone/
// fonte de áudio de verdade é estéreo (2 canais), a menos que o SDP
// (a "receita" de como a chamada vai ser codificada, trocada entre os
// dois lados antes da call começar de verdade) diga explicitamente
// "stereo=1" no codec Opus daquele áudio. Isso não é uma constraint que
// dá pra pedir via getUserMedia/getDisplayMedia nem uma opção do
// RTCRtpSender.setParameters() (que só controla bitrate/prioridade) —
// só existe um jeito de ligar: editar o texto do SDP na mão antes dele
// ser aplicado. Chamado de "SDP munging", é uma técnica padrão (não um
// hack frágil) usada por várias bibliotecas WebRTC de produção pra
// exatamente esse fim.
//
// Importante: só queremos isso pro áudio da TRANSMISSÃO DE TELA (som de
// jogo/sistema, que É estéreo de verdade) — o microfone continua mono
// de propósito (voz não ganha nada com estéreo, só gastaria banda à
// toa). Por isso a função recebe o ID da track específica que deve
// virar estéreo, e vasculha o SDP (que pode ter VÁRIAS seções de áudio,
// uma pro microfone e outra pra transmissão) procurando qual seção
// "m=audio" pertence a essa track (via a linha "a=msid:", que carrega o
// ID da track daquela seção) — só mexe nessa, deixa todo o resto
// intacto.
export function preferStereoOpusForTrack(sdp: string, targetTrackId: string | null): string {
  if (!targetTrackId || !sdp) return sdp

  const lines = sdp.split('\r\n')
  const sectionStarts: number[] = []
  lines.forEach((line, i) => {
    if (line.startsWith('m=')) sectionStarts.push(i)
  })
  sectionStarts.push(lines.length)

  for (let s = 0; s < sectionStarts.length - 1; s++) {
    const start = sectionStarts[s]
    const end = sectionStarts[s + 1]
    if (!lines[start].startsWith('m=audio')) continue

    const sectionLines = lines.slice(start, end)
    const belongsToTargetTrack = sectionLines.some(
      (l) => l.startsWith('a=msid:') && l.includes(targetTrackId)
    )
    if (!belongsToTargetTrack) continue

    const rtpmapLine = sectionLines.find((l) => /^a=rtpmap:\d+ opus\/48000/i.test(l))
    if (!rtpmapLine) continue // esse peer/navegador nem ofereceu Opus nessa seção — nada a fazer
    const payloadTypeMatch = rtpmapLine.match(/^a=rtpmap:(\d+)/)
    if (!payloadTypeMatch) continue
    const payloadType = payloadTypeMatch[1]

    const fmtpIndex = sectionLines.findIndex((l) => l.startsWith(`a=fmtp:${payloadType} `))
    if (fmtpIndex >= 0) {
      if (!/stereo=1/.test(sectionLines[fmtpIndex])) {
        sectionLines[fmtpIndex] = `${sectionLines[fmtpIndex]};stereo=1;sprop-stereo=1`
      }
    } else {
      const rtpmapIndex = sectionLines.indexOf(rtpmapLine)
      sectionLines.splice(rtpmapIndex + 1, 0, `a=fmtp:${payloadType} stereo=1;sprop-stereo=1`)
    }

    const shift = sectionLines.length - (end - start)
    lines.splice(start, end - start, ...sectionLines)
    if (shift !== 0) {
      for (let k = s + 1; k < sectionStarts.length; k++) sectionStarts[k] += shift
    }
  }

  return lines.join('\r\n')
}
