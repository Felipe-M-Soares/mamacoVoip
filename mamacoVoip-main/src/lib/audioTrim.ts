// Ferramenta de recorte de áudio pro soundboard — o pedido foi "limite
// cada som a 5 segundo... mas ai tem q ter uma ferramenta para cortar o
// audio como no discord" (o Discord deixa escolher um trecho de até 5s
// de qualquer áudio enviado, em vez de simplesmente rejeitar arquivos
// longos). Tudo roda no navegador/Electron via Web Audio API — não
// precisa de nenhum serviço externo nem upload prévio só pra cortar.

export const MAX_SOUND_SECONDS = 5

// Decodifica o arquivo só pra descobrir a duração real (mais confiável
// que a duração de um <audio>/<video>, que em alguns formatos fica
// disponível só depois de carregar o arquivo inteiro, ou vem errada até
// terminar o "seek" inicial em certos containers). Devolve também o
// AudioBuffer decodificado, pra não precisar decodificar de novo na hora
// de cortar de fato.
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer()
  // Um AudioContext novo só pra decodificar — mais simples que reusar um
  // já existente (que podia estar suspenso esperando interação do
  // usuário) e barato o bastante pra criar sob demanda aqui.
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AudioContextCtor()
  try {
    // Safari/versões antigas só aceitam o callback antigo — o try/catch
    // cobre os dois jeitos sem precisar detectar navegador.
    return await ctx.decodeAudioData(arrayBuffer.slice(0))
  } finally {
    ctx.close().catch(() => {})
  }
}

// Corta [startSec, endSec) do AudioBuffer e devolve um novo Blob WAV
// (16-bit PCM, mono) pronto pra upload. Mistura todos os canais originais
// num só (mono) — reduz o tamanho do arquivo pela metade em fontes
// estéreo, sem perda perceptível pra um efeito curto de soundboard, e
// simplifica o encoder (não precisa entrelaçar N canais).
export function trimAudioBufferToWav(buffer: AudioBuffer, startSec: number, endSec: number): Blob {
  const sampleRate = buffer.sampleRate
  const startSample = Math.max(0, Math.floor(startSec * sampleRate))
  const endSample = Math.min(buffer.length, Math.floor(endSec * sampleRate))
  const frameCount = Math.max(0, endSample - startSample)

  const mono = new Float32Array(frameCount)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < frameCount; i++) {
      mono[i] += data[startSample + i] / buffer.numberOfChannels
    }
  }

  return encodeWavMono16(mono, sampleRate)
}

// Encoder WAV bem simples — cabeçalho RIFF/PCM padrão + amostras de
// 16-bit assinado. Não depende de nenhuma lib externa (evita puxar mais
// peso pro bundle só pra isso).
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
  view.setUint32(16, 16, true) // tamanho do bloco fmt
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 1 canal (mono)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits por amostra
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
