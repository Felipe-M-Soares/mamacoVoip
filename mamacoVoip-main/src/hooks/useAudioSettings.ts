import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_MIC_SENSITIVITY } from '../lib/noiseSuppression'

export interface AudioDeviceOption {
  deviceId: string
  label: string
}

const STORAGE_KEY = 'mamacos-audio-settings'

interface StoredSettings {
  micId: string | null
  speakerId: string | null
  // VIGÉSIMA QUARTA RODADA — pedido explícito: "quero o mesmo esquema
  // do OBS que transmite fielmente o jogo". Em vez de escrever um
  // capturador nativo próprio via Windows Graphics Capture (a mesma
  // tecnologia do OBS, mas que exige interoperação COM/WinRT em C++ —
  // bem mais arriscada de acertar sem um Windows de verdade pra testar
  // do que qualquer coisa feita até aqui), o caminho de baixo risco:
  // deixar a pessoa escolher a "OBS Virtual Camera" (ou qualquer outra
  // câmera virtual de um app de captura de tela) como fonte de vídeo da
  // câmera comum do app. Como o OBS já é confirmado funcionando na
  // máquina da pessoa, a Câmera Virtual dele entrega EXATAMENTE a
  // mesma captura fiel que já funciona lá — só passando pelo caminho de
  // vídeo mais simples e testado do app (getUserMedia comum, o mesmo
  // que a webcam de verdade usa), sem nenhum código novo arriscado.
  // null = usa a câmera padrão do sistema (comportamento de antes).
  cameraId: string | null
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
  // 0-100 — ver MIN/MAX/DEFAULT_MIC_SENSITIVITY em lib/noiseSuppression.ts.
  // Controla o "gate" de ruído: abaixo desse volume, o microfone é
  // cortado por completo (resolve o caso de som de teclado/mesa
  // vazando, que o RNNoise sozinho não filtra bem). Só é usado
  // diretamente quando `micSensitivityMode` é 'manual' — no modo
  // 'auto' o limiar é recalculado sozinho a partir do ruído ambiente
  // (ver o loop de auto-ajuste em VoiceContext.tsx).
  micSensitivity: number
  // 'manual' (padrão, comportamento de antes): usa o slider acima.
  // 'auto': o app mede o ruído de fundo continuamente e ajusta o
  // limiar sozinho, sem precisar que a pessoa mexa em nada.
  micSensitivityMode: 'auto' | 'manual'
  // DÉCIMA NONA RODADA: bug relatado com o Rainbow Six como exemplo — "as
  // vozes dos personagens saem mas o som dos tiros e outras coisas do
  // jogo não". Causa: o RNNoise (ligado por padrão pra transmissão de
  // tela desde a rodada anterior, pra resolver um chiado constante) é
  // uma rede treinada especificamente pra ISOLAR VOZ — qualquer coisa
  // que não pareça fala (tiro, explosão, música, passos) é tratada como
  // "ruído" e suprimida de propósito, é literalmente o trabalho dela.
  // Aplicar isso na mixagem de áudio INTEIRA de um jogo destrói o som
  // de verdade, não só "chiado" — regressão séria, pior que o problema
  // original. Virou opt-in, DESLIGADO por padrão: quem tinha o chiado
  // específico da captura por processo pode ligar sabendo da troca
  // (efeitos sonoros não-vocais do jogo ficam mais discretos/cortados),
  // mas ninguém perde o áudio do jogo sem pedir.
  screenAudioNoiseSuppression: boolean
}

const DEFAULTS: StoredSettings = {
  micId: null,
  speakerId: null,
  cameraId: null,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  micSensitivity: DEFAULT_MIC_SENSITIVITY,
  micSensitivityMode: 'manual',
  screenAudioNoiseSuppression: false,
}

function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    // localStorage indisponível (modo privado, etc.) — usa os padrões
  }
  return DEFAULTS
}

// Preferências de áudio (microfone/alto-falante escolhidos, cancelamento
// de eco, redução de ruído, controle automático de ganho). São aplicadas
// via as constraints nativas do getUserMedia — o navegador faz o
// processamento de verdade (echoCancellation/noiseSuppression/
// autoGainControl são recursos padrão da Web Audio API, não uma
// simulação). Um redutor de ruído "de estúdio" (tipo RNNoise via WASM)
// exigiria uma biblioteca de processamento de sinal à parte — fora do
// escopo aqui, mas os três controles nativos já cobrem o caso comum.
export function useAudioSettings() {
  const [settings, setSettings] = useState<StoredSettings>(loadSettings)
  const [microphones, setMicrophones] = useState<AudioDeviceOption[]>([])
  const [speakers, setSpeakers] = useState<AudioDeviceOption[]>([])
  // VIGÉSIMA QUARTA RODADA — ver StoredSettings.cameraId acima pro
  // porquê (deixar escolher a "OBS Virtual Camera" como fonte de vídeo).
  const [cameras, setCameras] = useState<AudioDeviceOption[]>([])
  const [permissionGranted, setPermissionGranted] = useState(false)
  const [supportsOutputSelection, setSupportsOutputSelection] = useState(false)

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const mics = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microfone ${i + 1}` }))
      const outs = devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Alto-falante ${i + 1}` }))
      const cams = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Câmera ${i + 1}` }))
      setMicrophones(mics)
      setSpeakers(outs)
      setCameras(cams)
      setPermissionGranted(mics.some((m) => !m.label.startsWith('Microfone ')))
      setSupportsOutputSelection(outs.length > 0 && typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype)
    } catch {
      // enumerateDevices pode falhar fora de um contexto seguro (https/localhost)
    }
  }, [])

  useEffect(() => {
    refreshDevices()
    const handler = () => refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', handler)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handler)
  }, [refreshDevices])

  function persist(next: StoredSettings) {
    setSettings(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // best-effort — se não der pra persistir, a preferência só vale pra sessão atual
    }
  }

  async function requestPermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      await refreshDevices()
      return { error: null }
    } catch {
      return { error: 'Permissão de microfone negada.' }
    }
  }

  function setMicId(id: string | null) {
    persist({ ...settings, micId: id })
  }
  function setSpeakerId(id: string | null) {
    persist({ ...settings, speakerId: id })
  }
  function setCameraId(id: string | null) {
    persist({ ...settings, cameraId: id })
  }
  function setEchoCancellation(v: boolean) {
    persist({ ...settings, echoCancellation: v })
  }
  function setNoiseSuppression(v: boolean) {
    persist({ ...settings, noiseSuppression: v })
  }
  function setAutoGainControl(v: boolean) {
    persist({ ...settings, autoGainControl: v })
  }
  function setMicSensitivity(v: number) {
    persist({ ...settings, micSensitivity: v })
  }
  function setMicSensitivityMode(v: 'auto' | 'manual') {
    persist({ ...settings, micSensitivityMode: v })
  }
  function setScreenAudioNoiseSuppression(v: boolean) {
    persist({ ...settings, screenAudioNoiseSuppression: v })
  }

  // `overrides` existe pro caso de ligar/desligar um desses três (eco,
  // ruído, ganho) enquanto já se está numa call: o botão precisa
  // recalcular as constraints com o valor NOVO na hora, sem esperar o
  // componente re-renderizar — se só ler `settings` (o estado do React),
  // pega o valor de ANTES do clique, porque a atualização de estado
  // ainda não foi aplicada nesse mesmo tick (ver refreshAudioConstraints
  // em VoiceContext.tsx pra mais detalhes de por que isso importava).
  function getAudioConstraints(
    overrideDeviceId?: string,
    overrides?: Partial<Pick<StoredSettings, 'echoCancellation' | 'noiseSuppression' | 'autoGainControl'>>
  ): MediaTrackConstraints {
    const deviceId = overrideDeviceId ?? settings.micId
    const effective = { ...settings, ...overrides }

    // Removidas duas coisas que pareciam inofensivas mas provavelmente
    // pioravam o ruído em vez de ajudar:
    //
    // 1. Os `goog*` (googNoiseSuppression, googHighpassFilter, etc.) são
    //    constraints antigas do Chrome/Hangouts de mais de 10 anos atrás,
    //    removidas do motor de áudio do Chromium há tempos — hoje são só
    //    peso morto, o navegador ignora silenciosamente.
    //
    // 2. `latency: { ideal: 0 }` pedia pro navegador priorizar latência
    //    mínima na captura — mas o processamento de ruído/eco do Chromium
    //    (APM) tem um custo de alguns milissegundos pra funcionar. Ao
    //    sinalizar "quero o mínimo de atraso possível", existe um risco
    //    real do navegador entender isso como "prefira um caminho de
    //    captura mais cru, com menos processamento" — indo exatamente
    //    contra o cancelamento de ruído que a pessoa também pediu.
    //    Numa chamada de voz, a diferença de alguns milissegundos de
    //    latência de captura é imperceptível perto do atraso da própria
    //    rede — não vale o risco de atrapalhar a redução de ruído.
    return {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: effective.echoCancellation,
      noiseSuppression: effective.noiseSuppression,
      autoGainControl: effective.autoGainControl,
      // Qualidade de captura mais alta que o padrão do navegador —
      // áudio de voz mais nítido, sem exigir praticamente nada a mais
      // de banda (a diferença é irrelevante frente ao vídeo/tela).
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 16 },
      channelCount: { ideal: 1 },
    } as MediaTrackConstraints
  }

  return {
    micId: settings.micId,
    speakerId: settings.speakerId,
    cameraId: settings.cameraId,
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    micSensitivity: settings.micSensitivity,
    micSensitivityMode: settings.micSensitivityMode,
    screenAudioNoiseSuppression: settings.screenAudioNoiseSuppression,
    microphones,
    speakers,
    cameras,
    permissionGranted,
    supportsOutputSelection,
    requestPermission,
    refreshDevices,
    setMicId,
    setSpeakerId,
    setCameraId,
    setEchoCancellation,
    setNoiseSuppression,
    setAutoGainControl,
    setMicSensitivity,
    setMicSensitivityMode,
    setScreenAudioNoiseSuppression,
    getAudioConstraints,
  }
}
