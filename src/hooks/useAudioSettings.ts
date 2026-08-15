import { useCallback, useEffect, useState } from 'react'

export interface AudioDeviceOption {
  deviceId: string
  label: string
}

const STORAGE_KEY = 'mamacos-audio-settings'

interface StoredSettings {
  micId: string | null
  speakerId: string | null
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
}

const DEFAULTS: StoredSettings = {
  micId: null,
  speakerId: null,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
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
      setMicrophones(mics)
      setSpeakers(outs)
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
  function setEchoCancellation(v: boolean) {
    persist({ ...settings, echoCancellation: v })
  }
  function setNoiseSuppression(v: boolean) {
    persist({ ...settings, noiseSuppression: v })
  }
  function setAutoGainControl(v: boolean) {
    persist({ ...settings, autoGainControl: v })
  }

  function getAudioConstraints(overrideDeviceId?: string): MediaTrackConstraints {
    const deviceId = overrideDeviceId ?? settings.micId
    return {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
    }
  }

  return {
    micId: settings.micId,
    speakerId: settings.speakerId,
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    microphones,
    speakers,
    permissionGranted,
    supportsOutputSelection,
    requestPermission,
    refreshDevices,
    setMicId,
    setSpeakerId,
    setEchoCancellation,
    setNoiseSuppression,
    setAutoGainControl,
    getAudioConstraints,
  }
}
