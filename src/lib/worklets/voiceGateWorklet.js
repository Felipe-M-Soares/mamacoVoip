// "Porteiro" de voz do Mamacos Voip (código próprio). Fecha o microfone
// quando não tem VOZ, sem estalos e sem deixar passar teclado/cliques:
//  - a decisão olha só a faixa da voz (~150 Hz a ~4 kHz): o "tec" do
//    teclado tem muita energia acima disso e quase não conta;
//  - pra ABRIR, o som precisa ficar acima do limiar por um tempinho
//    (sustainMs, padrão 35 ms). Batida de tecla, clique de mouse e
//    batida na mesa duram menos que isso e não abrem; sílaba de fala
//    dura bem mais;
//  - pra não cortar o começo da palavra por causa dessa espera, o áudio
//    sai com um pequeno atraso (lookahead igual ao sustain): quando o
//    porteiro decide abrir, o começo da fala ainda não saiu;
//  - abre e fecha por rampa de ganho (abre em ~3 ms, fecha em ~120 ms);
//  - histerese (fecha 6 dB abaixo de onde abre) + 250 ms segurando
//    aberto, pra não picotar o fim das palavras;
//  - o limiar muda por mensagem (port.postMessage), sem refazer o
//    gráfico de áudio.
// thresholdDb === null → sem porteiro (passa tudo, sem atraso extra útil).
class MvVoiceGateProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = (options && options.processorOptions) || {}
    const tc = (ms) => Math.exp(-1 / ((ms / 1000) * sampleRate))
    this.envAttack = tc(2)
    this.envRelease = tc(12)
    // Envelope RÁPIDO só pra contar quanto tempo o som fica acima do
    // limiar: com o envelope lento, o "rabo" de um clique de tecla ficava
    // dezenas de ms acima do limiar e abria o porteiro.
    this.fastAttack = tc(1)
    this.fastRelease = tc(4)
    this.envFast = 0
    this.gainAttack = tc(3)
    this.gainRelease = tc(120)
    this.holdSamples = Math.round(((o.holdMs ?? 250) / 1000) * sampleRate)
    this.sustainSamples = Math.max(1, Math.round(((o.sustainMs ?? 35) / 1000) * sampleRate))

    // Linha de atraso (lookahead) do tamanho do sustain.
    this.delayLen = this.sustainSamples
    this.delay = new Float32Array(this.delayLen)
    this.delayPos = 0

    // Passa-faixa simples: passa-alta ~150 Hz + passa-baixa ~4 kHz
    // (um polo cada, barato e suficiente pra "pesar" a faixa da voz).
    const dt = 1 / sampleRate
    const rcHp = 1 / (2 * Math.PI * 150)
    const rcLp = 1 / (2 * Math.PI * 4000)
    this.hpA = rcHp / (rcHp + dt)
    this.lpA = dt / (rcLp + dt)
    this.hpPrevIn = 0
    this.hpPrevOut = 0
    this.lpOut = 0

    this.env2 = 0
    this.aboveCount = 0
    this.belowRun = 0
    this.gapSamples = Math.round(0.008 * sampleRate)
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
    if (!output || output.length === 0) return true
    const frames = output[0].length
    const hasInput = input && input.length > 0 && input[0]
    const channels = hasInput ? Math.min(input.length, output.length) : 0
    for (let i = 0; i < frames; i++) {
      // Mono pra decisão/atraso (o microfone já chega em 1 canal).
      let x = 0
      for (let c = 0; c < channels; c++) x += input[c][i]
      if (channels > 1) x /= channels

      // Faixa da voz.
      const hp = this.hpA * (this.hpPrevOut + x - this.hpPrevIn)
      this.hpPrevIn = x
      this.hpPrevOut = hp
      this.lpOut += this.lpA * (hp - this.lpOut)
      const power = this.lpOut * this.lpOut
      const k = power > this.env2 ? this.envAttack : this.envRelease
      this.env2 = k * this.env2 + (1 - k) * power
      const kf = power > this.envFast ? this.fastAttack : this.fastRelease
      this.envFast = kf * this.envFast + (1 - kf) * power

      // Atraso: sai o que entrou `delayLen` amostras atrás.
      const delayed = this.delay[this.delayPos]
      this.delay[this.delayPos] = x
      this.delayPos = (this.delayPos + 1) % this.delayLen

      let target = 1
      if (this.enabled) {
        // Voz é "contínua": a contagem tolera buracos curtos entre ciclos
        // da onda (o envelope rápido oscila), mas zera num silêncio de
        // verdade (> ~8 ms).
        if (this.envFast >= this.openPow) {
          this.belowRun = 0
          if (this.aboveCount < this.sustainSamples) this.aboveCount++
        } else if (++this.belowRun > this.gapSamples) {
          this.aboveCount = 0
        }
        if (this.env2 >= this.openPow && (this.aboveCount >= this.sustainSamples || this.isOpen)) {
          this.isOpen = true
          this.holdLeft = this.holdSamples
        } else {
          if (this.env2 < this.closePow) {
            if (this.holdLeft > 0) this.holdLeft--
            else this.isOpen = false
          } else if (this.isOpen) {
            this.holdLeft = this.holdSamples
          }
        }
        target = this.isOpen ? 1 : 0
      }
      const g = target > this.gain ? this.gainAttack : this.gainRelease
      this.gain = g * this.gain + (1 - g) * target
      const y = delayed * this.gain
      for (let c = 0; c < output.length; c++) output[c][i] = y
    }
    return true
  }
}

registerProcessor('mv-voice-gate', MvVoiceGateProcessor)
