import { useEffect, useRef } from 'react'
import { useVoiceCore } from '../hooks/useVoice'
import {
  KEYBIND_ACTIONS,
  comboFromEvent,
  isKeybindRecording,
  setGlobalKeybindFailures,
  toAccelerator,
  useKeybinds,
  type KeybindAction,
} from '../lib/keybinds'

// Faz os atalhos de teclado (lib/keybinds) funcionarem: dentro do app via
// keydown e, no app de computador com "funcionar fora do app" ligado, via
// atalhos globais do Electron (com o jogo em primeiro plano).
export function KeybindsRunner() {
  const voice = useVoiceCore()
  const { bindings, global } = useKeybinds()
  const voiceRef = useRef(voice)
  voiceRef.current = voice
  const lastRunRef = useRef<{ id: string; at: number }>({ id: '', at: 0 })

  function run(id: KeybindAction) {
    const now = Date.now()
    if (lastRunRef.current.id === id && now - lastRunRef.current.at < 300) return
    lastRunRef.current = { id, at: now }
    const v = voiceRef.current
    const inCall = Boolean(v.connectedChannelId)
    switch (id) {
      case 'toggle-mute':
        v.toggleMute()
        break
      case 'toggle-deafen':
        v.toggleDeafen()
        break
      case 'toggle-camera':
        if (inCall) void v.toggleVideo()
        break
      case 'toggle-screenshare':
        if (inCall) void v.toggleScreenShare()
        break
      case 'leave-call':
        if (inCall) v.leave()
        break
      case 'toggle-overlay':
        void window.electronAPI?.toggleOverlay?.().catch(() => {})
        break
      case 'open-soundboard':
        if (inCall) window.dispatchEvent(new Event('mv:open-soundboard'))
        break
      case 'return-to-call':
        if (inCall && v.connectedServerId)
          window.dispatchEvent(
            new CustomEvent('mv:open-voice-room', { detail: { serverId: v.connectedServerId, channelId: v.connectedChannelId } })
          )
        break
      case 'toggle-members':
        window.dispatchEvent(new Event('mv:toggle-members'))
        break
      case 'quick-switcher':
        window.dispatchEvent(new Event('mv:quick-switcher'))
        break
      case 'show-shortcuts':
        window.dispatchEvent(new Event('mv:show-shortcuts'))
        break
    }
  }
  const runRef = useRef(run)
  runRef.current = run

  // Dentro do app.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat || isKeybindRecording()) return
      const combo = comboFromEvent(e)
      if (!combo) return
      const action = KEYBIND_ACTIONS.find((a) => bindings[a.id] === combo)
      if (!action) return
      e.preventDefault()
      runRef.current(action.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bindings])

  // Fora do app (Electron).
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.setGlobalKeybinds) return
    const list = global
      ? KEYBIND_ACTIONS.filter((a) => a.global && bindings[a.id]).flatMap((a) => {
          const accelerator = toAccelerator(bindings[a.id]!)
          return accelerator ? [{ id: a.id, accelerator }] : []
        })
      : []
    void api
      .setGlobalKeybinds(list)
      .then((r) => setGlobalKeybindFailures(r?.failed ?? []))
      .catch(() => {})
  }, [bindings, global])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onKeybind) return
    return api.onKeybind((id) => {
      if (isKeybindRecording()) return
      if (KEYBIND_ACTIONS.some((a) => a.id === id)) runRef.current(id as KeybindAction)
    })
  }, [])

  return null
}
