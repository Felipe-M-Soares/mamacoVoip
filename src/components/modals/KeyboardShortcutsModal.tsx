import { Modal } from './Modal'
import { Kbd } from './settingsUI'
import { KEYBIND_ACTIONS, useKeybinds } from '../../lib/keybinds'

const FIXED: { keys: string; label: string }[] = [
  { keys: 'Ctrl + V', label: 'Colar imagem/print como anexo' },
  { keys: 'Enter', label: 'Enviar mensagem' },
  { keys: 'Shift + Enter', label: 'Nova linha na mensagem' },
  { keys: 'Esc', label: 'Cancelar resposta / fechar um modal' },
]

export function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  const { bindings } = useKeybinds()
  const SHORTCUTS = [
    ...KEYBIND_ACTIONS.filter((a) => bindings[a.id]).map((a) => ({
      keys: bindings[a.id]!.endsWith('++') ? bindings[a.id]!.slice(0, -2).split('+').concat('+').join(' + ') : bindings[a.id]!.split('+').join(' + '),
      label: a.label,
    })),
    ...FIXED,
  ]
  return (
    <Modal title="Atalhos de teclado" onClose={onClose} maxWidth="max-w-lg">
      <div className="rounded-xl border border-[var(--color-line)] divide-y divide-[var(--color-line)] overflow-hidden">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white/[0.015]">
            <span className="text-[13.5px] text-mv-text">{s.label}</span>
            <span className="flex items-center gap-1 shrink-0">
              {s.keys.split(' + ').map((k, i) => (
                <span key={k} className="flex items-center gap-1">
                  {i > 0 && <span className="text-[11px] text-mv-muted">+</span>}
                  <Kbd>{k}</Kbd>
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-mv-muted mt-3">Dá pra trocar as teclas em Configurações → Atalhos.</p>
    </Modal>
  )
}
