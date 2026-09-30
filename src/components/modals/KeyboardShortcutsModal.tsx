import { Modal } from './Modal'
import { Kbd } from './settingsUI'

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Ctrl + K', label: 'Seletor rápido (pular pra servidor, canal ou conversa)' },
  { keys: 'Ctrl + Shift + O', label: 'Mostrar/esconder sobreposição dentro de jogos' },
  { keys: 'Enter', label: 'Enviar mensagem' },
  { keys: 'Shift + Enter', label: 'Nova linha na mensagem' },
  { keys: 'Esc', label: 'Cancelar resposta / fechar um modal' },
  { keys: 'Ctrl + /', label: 'Mostrar esses atalhos' },
]

export function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
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
    </Modal>
  )
}
