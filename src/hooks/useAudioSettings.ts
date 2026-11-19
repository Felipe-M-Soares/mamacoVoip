import { applySoundsSink } from '../lib/sounds'
import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_MIC_SENSITIVITY } from '../lib/noiseSuppression'
import { migrateSensitivity } from '../lib/audioSettingsMigration'

export interface AudioDeviceOption {
  deviceId: string
  label: string
}

const STORAGE_KEY = 'mamacos-audio-settings'

interface StoredSettings {
  micId: string | null
  speakerId: string | null
  cameraId: string | null
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
  micSensitivity: number
  micSensitivityMode: 'auto' | 'manual'
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

const SENSITIVITY_MIGRATION_KEY = 'mamacos-audio-sensitivity-v2'

function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const migrated = localStorage.getItem(SENSITIVITY_MIGRATION_KEY) === '1'
      const parsed = migrateSensitivity(JSON.parse(raw) as Partial<StoredSettings>, migrated, DEFAULT_MIC_SENSITIVITY)
      if (!migrated) {
        localStorage.setItem(SENSITIVITY_MIGRATION_KEY, '1')
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
      }
      return { ...DEFAULTS, ...parsed }
    }
    localStorage.setItem(SENSITIVITY_MIGRATION_KEY, '1')
  } catch {
  }
  return DEFAULTS
}

export function useAudioSettings() {
  const [settings, setSettings] = useState<StoredSettings>(loadSettings)
  const [microphones, setMicrophones] = useState<AudioDeviceOption[]>([])
  const [speakers, setSpeakers] = useState<AudioDeviceOption[]>([])
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
    }
  }, [])

  useEffect(() => {
    refreshDevices()
    const handler = () => refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', handler)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handler)
  }, [refreshDevices])

  function update(patch: Partial<StoredSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
      }
      return next
    })
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
    update({ micId: id })
  }
  function setSpeakerId(id: string | null) {
    update({ speakerId: id })
    applySoundsSink(id)
  }
  function setCameraId(id: string | null) {
    update({ cameraId: id })
  }
  function setEchoCancellation(v: boolean) {
    update({ echoCancellation: v })
  }
  function setNoiseSuppression(v: boolean) {
    update({ noiseSuppression: v })
  }
  function setAutoGainControl(v: boolean) {
    update({ autoGainControl: v })
  }
  function setMicSensitivity(v: number) {
    update({ micSensitivity: v })
  }
  function setMicSensitivityMode(v: 'auto' | 'manual') {
    update({ micSensitivityMode: v })
  }
  function setScreenAudioNoiseSuppression(v: boolean) {
    update({ screenAudioNoiseSuppression: v })
  }

  function getAudioConstraints(
    overrideDeviceId?: string,
    overrides?: Partial<Pick<StoredSettings, 'echoCancellation' | 'noiseSuppression' | 'autoGainControl'>>
  ): MediaTrackConstraints {
    const deviceId = overrideDeviceId ?? settings.micId
    const effective = { ...settings, ...overrides }

    return {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: effective.echoCancellation,
      noiseSuppression: effective.noiseSuppression,
      autoGainControl: effective.autoGainControl,
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
