// "Porteiro" de voz do Mamacos Voip (código próprio). Fecha o microfone
// quando o volume fica abaixo do limiar, mas SEM estalos:
//  - mede o volume com um RMS suavizado (sobe em ~5ms, desce em ~30ms)
//    em vez de decidir bloco a bloco;
//  - abre e fecha por rampa de ganho (abre em ~3ms, fecha em ~120ms),
//    nunca cortando o som de uma vez;
//  - histerese (fecha 6 dB abaixo de onde abre) + 250ms de "segurar"
//    aberto, pra não picotar o fim das palavras;
//  - o limiar muda por mensagem (port.postMessage), sem refazer o
//    gráfico de áudio — antes cada ajuste do modo automático recriava o
//    nó e gerava um estalo a cada poucos segundos.
// thresholdDb === null → sem porteiro (passa tudo).
class MvVoiceGateProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = (options && options.processorOptions) || {}
    const tc = (ms) => Math.exp(-1 / ((ms / 1000) * sampleRate))
    this.envAttack = tc(5)
    this.envRelease = tc(30)
    this.gainAttack = tc(3)
    this.gainRelease = tc(120)
    this.holdSamples = Math.round(((o.holdMs ?? 250) / 1000) * sampleRate)
    this.env2 = 0
    this.holdLeft = 0
    this.isOpen = false
    this.setThreshold(o.thresholdDb ?? null)
    this.gain = this.enabled ? 0 : 1
    this.port.onmessage = (e) => {
      if (e.data && 'thresholdDb' in e.data) this.setThreshold(e.data.thresholdDb)
    }
  }

  setThreshold(db) {
    if (db === null || typeof db !== 'number' || !Number.isFinite(db)) {
      this.enabled = false
      return
    }
    this.enabled = true
    // Comparação no domínio da POTÊNCIA (RMS²), sem raiz por amostra.
    this.openPow = Math.pow(10, db / 10)
    this.closePow = Math.pow(10, (db - 6) / 10)
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0 || !input[0] || !output || output.length === 0) return true
    const channels = Math.min(input.length, output.length)
    const frames = input[0].length
    for (let i = 0; i < frames; i++) {
      let power = 0
      for (let c = 0; c < channels; c++) {
        const v = input[c][i]
        power += v * v
      }
      power /= channels
      const k = power > this.env2 ? this.envAttack : this.envRelease
      this.env2 = k * this.env2 + (1 - k) * power

      let target = 1
      if (this.enabled) {
        if (this.env2 >= this.openPow) {
          this.isOpen = true
          this.holdLeft = this.holdSamples
        } else if (this.env2 < this.closePow) {
          if (this.holdLeft > 0) this.holdLeft--
          else this.isOpen = false
        } else if (this.isOpen) {
          this.holdLeft = this.holdSamples
        }
        target = this.isOpen ? 1 : 0
      }
      const g = target > this.gain ? this.gainAttack : this.gainRelease
      this.gain = g * this.gain + (1 - g) * target
      for (let c = 0; c < channels; c++) output[c][i] = input[c][i] * this.gain
    }
    return true
  }
}

registerProcessor('mv-voice-gate', MvVoiceGateProcessor)
