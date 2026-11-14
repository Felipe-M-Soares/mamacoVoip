// Troca entre o modo Clássico (lista de canais) e o Escritório (isométrico).
// Mesmo botão nos dois lugares: na barra de canais e no topo do escritório.
import type { ReactNode } from 'react'

export type ViewMode = 'classico' | 'escritorio'

export function ViewModeToggle({ mode, onChange, compact = false }: { mode: ViewMode; onChange: (m: ViewMode) => void; compact?: boolean }) {
  const item = (m: ViewMode, label: string, icon: ReactNode) => {
    const on = mode === m
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => !on && onChange(m)}
        className={`relative flex-1 flex items-center justify-center gap-1.5 rounded-[10px] font-semibold transition-colors ${compact ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[12.5px]'} ${
          on ? 'bg-white text-[#1b1622] shadow-[0_1px_3px_rgba(0,0,0,.25)]' : 'text-white/75 hover:text-white'
        }`}
      >
        {icon}
        {label}
      </button>
    )
  }
  return (
    <div role="radiogroup" aria-label="Modo de visualização" className="flex items-center gap-0.5 p-0.5 rounded-xl bg-black/35 border border-white/10">
      {item(
        'classico',
        'Clássico',
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>,
      )}
      {item(
        'escritorio',
        'Escritório',
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="m3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>,
      )}
    </div>
  )
}
