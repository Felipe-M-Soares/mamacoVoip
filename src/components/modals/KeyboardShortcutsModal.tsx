import { Modal } from './Modal'

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
    <Modal title="Atalhos de teclado" onClose={onClose}>
      <div className="space-y-1">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
            <span className="text-sm text-discord-text">{s.label}</span>
            <kbd className="text-xs bg-discord-darker px-2 py-1 rounded font-mono text-discord-text-muted shrink-0 ml-3">
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </Modal>
  )
}
