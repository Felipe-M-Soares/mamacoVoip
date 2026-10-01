import { useEffect, useState } from 'react'
import { Kbd, SettingsCard, TabHeader, ToggleRow } from './settingsUI'
import { Toggle } from '../ui/Toggle'
import {
  KEYBIND_ACTIONS,
  comboFromEvent,
  isUsableCombo,
  resetKeybinds,
  setGlobalKeybindsEnabled,
  setKeybind,
  setKeybindRecording,
  useGlobalKeybindFailures,
  useKeybinds,
  type KeybindAction,
} from '../../lib/keybinds'

function ComboKeys({ combo }: { combo: string }) {
  const parts = combo.endsWith('++') ? [...combo.slice(0, -2).split('+'), '+'] : combo.split('+')
  return (
    <span className="flex items-center gap-1">
      {parts.map((k, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-[11px] text-mv-muted">+</span>}
          <Kbd>{k}</Kbd>
        </span>
      ))}
    </span>
  )
}

export function KeybindsTab() {
  const { bindings, global } = useKeybinds()
  const failures = useGlobalKeybindFailures()
  const [recordingId, setRecordingId] = useState<KeybindAction | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const isDesktop = Boolean(window.electronAPI?.isElectron)

  // Gravando: a próxima combinação vira o atalho. Esc cancela,
  // Backspace/Delete remove o atalho.
  useEffect(() => {
    if (!recordingId) return
    setKeybindRecording(true)
    function onKey(e: KeyboardEvent) {
      e.preventDefault()
      e.stopPropagation()
      if (!recordingId) return
      if (e.key === 'Escape') {
        setRecordingId(null)
        return
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setKeybind(recordingId, null)
        setRecordingId(null)
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return // só modificador até agora
      if (!isUsableCombo(combo)) {
        setNotice('Use Ctrl, Alt ou Win junto (ou uma tecla F1–F24), senão atrapalharia digitar.')
        return
      }
      const displaced = setKeybind(recordingId, combo)
      setNotice(
        displaced
          ? `${combo} estava em "${KEYBIND_ACTIONS.find((a) => a.id === displaced)?.label}" — esse ficou sem atalho.`
          : null
      )
      setRecordingId(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      setKeybindRecording(false)
    }
  }, [recordingId])

  const groups = ['Chamada', 'Navegação'] as const

  return (
    <div className="space-y-5">
      <TabHeader
        title="Atalhos de teclado"
        description="Nenhum atalho vem configurado: clique em “Sem atalho” e aperte a combinação que quiser (ex.: Ctrl+Shift+M). Esc cancela, Backspace remove. O apertar-para-falar fica em Voz e Vídeo."
      />

      {isDesktop && (
        <ToggleRow
          title="Funcionar fora do app"
          description="Os atalhos de chamada funcionam mesmo com o jogo ou outro programa em primeiro plano. A combinação deixa de chegar nos outros programas."
        >
          <Toggle checked={global} onChange={setGlobalKeybindsEnabled} label="Atalhos fora do app" />
        </ToggleRow>
      )}

      {groups.map((group) => (
        <SettingsCard key={group} title={group}>
          <div className="divide-y divide-[var(--color-line)]">
            {KEYBIND_ACTIONS.filter((a) => a.group === group && (isDesktop || !a.desktopOnly)).map((a) => {
              const combo = bindings[a.id]
              const rec = recordingId === a.id
              return (
                <div key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[14px] text-mv-text">{a.label}</p>
                    {a.global && isDesktop && global && combo && failures.includes(a.id) ? (
                      <p className="text-[11.5px] text-amber-300">
                        Outro programa (AMD, NVIDIA, Xbox Game Bar…) já usa essa tecla fora do app. Escolha outra.
                      </p>
                    ) : (
                      a.global &&
                      isDesktop &&
                      global && <p className="text-[11.5px] text-mv-muted">Funciona também dentro de jogos</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setNotice(null)
                      setRecordingId(rec ? null : a.id)
                    }}
                    className={`min-w-[132px] h-9 px-3 rounded-lg border text-[13px] flex items-center justify-center transition-colors ${
                      rec
                        ? 'border-mv-accent bg-mv-accent/10 text-white animate-pulse'
                        : 'border-[var(--color-line-strong)] hover:bg-white/[0.05] text-mv-muted'
                    }`}
                    aria-label={`Mudar atalho de ${a.label}`}
                  >
                    {rec ? 'Aperte as teclas…' : combo ? <ComboKeys combo={combo} /> : 'Sem atalho'}
                  </button>
                </div>
              )
            })}
          </div>
        </SettingsCard>
      ))}

      {notice && <p className="text-[13px] text-amber-300">{notice}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            resetKeybinds()
            setNotice('Todos os atalhos foram apagados.')
          }}
          className="h-9 px-4 btn-secondary text-[13px]"
        >
          Limpar todos
        </button>
      </div>
    </div>
  )
}
