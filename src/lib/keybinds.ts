import { useSyncExternalStore } from 'react'

// Atalhos de teclado configuráveis (Configurações → Atalhos). Começam
// todos VAZIOS — cada pessoa escolhe as teclas que quer.
// Uma combinação é guardada como texto, ex.: "Ctrl+Shift+M".

export type KeybindAction =
  | 'toggle-mute'
  | 'toggle-deafen'
  | 'toggle-camera'
  | 'toggle-screenshare'
  | 'leave-call'
  | 'open-soundboard'
  | 'return-to-call'
  | 'toggle-members'
  | 'quick-switcher'
  | 'show-shortcuts'

export const KEYBIND_ACTIONS: {
  id: KeybindAction
  label: string
  group: 'Chamada' | 'Navegação'
  defaultCombo: string | null
  /** Pode funcionar fora do app (com o jogo em foco) */
  global: boolean
}[] = [
  { id: 'toggle-mute', label: 'Ligar/desligar microfone', group: 'Chamada', defaultCombo: null, global: true },
  { id: 'toggle-deafen', label: 'Ligar/desligar áudio (fone)', group: 'Chamada', defaultCombo: null, global: true },
  { id: 'toggle-camera', label: 'Ligar/desligar câmera', group: 'Chamada', defaultCombo: null, global: true },
  { id: 'toggle-screenshare', label: 'Compartilhar tela / parar', group: 'Chamada', defaultCombo: null, global: true },
  { id: 'leave-call', label: 'Sair da sala de voz', group: 'Chamada', defaultCombo: null, global: true },
  { id: 'open-soundboard', label: 'Abrir o soundboard', group: 'Chamada', defaultCombo: null, global: false },
  { id: 'return-to-call', label: 'Voltar pra tela da sala', group: 'Navegação', defaultCombo: null, global: false },
  { id: 'toggle-members', label: 'Mostrar/esconder lista de membros', group: 'Navegação', defaultCombo: null, global: false },
  { id: 'quick-switcher', label: 'Seletor rápido (servidor, canal, conversa)', group: 'Navegação', defaultCombo: null, global: false },
  { id: 'show-shortcuts', label: 'Mostrar a lista de atalhos', group: 'Navegação', defaultCombo: null, global: false },
]

type State = { bindings: Record<KeybindAction, string | null>; global: boolean }

const KEY = 'mv-keybinds'

function defaults(): State {
  const bindings = {} as Record<KeybindAction, string | null>
  for (const a of KEYBIND_ACTIONS) bindings[a.id] = a.defaultCombo
  return { bindings, global: true }
}

function load(): State {
  const base = defaults()
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<State> | null
    if (raw && typeof raw === 'object') {
      for (const a of KEYBIND_ACTIONS) {
        const v = raw.bindings?.[a.id]
        if (v === null || typeof v === 'string') base.bindings[a.id] = v
      }
      if (typeof raw.global === 'boolean') base.global = raw.global
    }
  } catch {
    // sem armazenamento — fica no padrão
  }
  return base
}

let state: State = load()
const listeners = new Set<() => void>()

function save(next: State) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // só não lembra
  }
  listeners.forEach((l) => l())
}

export function useKeybinds(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
    () => state
  )
}

/** Define a combinação de uma ação; se outra ação já usava, ela fica sem atalho. Devolve a ação que perdeu o atalho. */
export function setKeybind(id: KeybindAction, combo: string | null): KeybindAction | null {
  const bindings = { ...state.bindings }
  let displaced: KeybindAction | null = null
  if (combo) {
    for (const a of KEYBIND_ACTIONS) {
      if (a.id !== id && bindings[a.id] === combo) {
        bindings[a.id] = null
        displaced = a.id
      }
    }
  }
  bindings[id] = combo
  save({ ...state, bindings })
  return displaced
}

export function resetKeybinds() {
  save({ ...defaults(), global: state.global })
}

export function setGlobalKeybindsEnabled(enabled: boolean) {
  save({ ...state, global: enabled })
}

export function getKeybinds(): State {
  return state
}

// ---------------------------------------------------------------- teclas

const CODE_NAMES: Record<string, string> = {
  Space: 'Espaço',
  Slash: '/',
  Backslash: '\\',
  Period: '.',
  Comma: ',',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
}

function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return `Num${code.slice(6)}`
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return CODE_NAMES[code] ?? null
}

/** Combinação de um evento de teclado ("Ctrl+Shift+M"), ou null se for só modificador/tecla não suportada. */
export function comboFromEvent(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  const key = keyName(e.code)
  if (!key) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Win')
  parts.push(key)
  return parts.join('+')
}

/** Precisa de pelo menos um modificador (Ctrl/Alt/Win) ou ser uma tecla F — senão atrapalharia digitar. */
export function isUsableCombo(combo: string): boolean {
  const parts = combo.split('+')
  const key = parts[parts.length - 1]
  return parts.some((p) => p === 'Ctrl' || p === 'Alt' || p === 'Win') || /^F\d+$/.test(key)
}

const ACCEL_KEYS: Record<string, string> = {
  'Espaço': 'Space',
  '↑': 'Up',
  '↓': 'Down',
  '←': 'Left',
  '→': 'Right',
  Enter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
}

/** Combinação no formato do Electron (globalShortcut). */
export function toAccelerator(combo: string): string | null {
  const parts = combo.split('+')
  if (combo.endsWith('++')) return null
  const out = parts.map((p, i) => {
    if (i < parts.length - 1) return p === 'Ctrl' ? 'Control' : p === 'Win' ? 'Super' : p
    if (/^Num[0-9]$/.test(p)) return `num${p.slice(3)}`
    return ACCEL_KEYS[p] ?? p
  })
  return out.join('+')
}

// Enquanto a pessoa grava um atalho novo nas Configurações, os atalhos
// existentes não disparam.
let recording = false
export function setKeybindRecording(on: boolean) {
  recording = on
}
export function isKeybindRecording() {
  return recording
}
