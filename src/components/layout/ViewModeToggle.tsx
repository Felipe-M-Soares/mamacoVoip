export type ViewMode = 'classico' | 'escritorio'

function MonkeyIcon({ headset, size }: { headset: boolean; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {headset ? (
        <>
          <circle cx="12" cy="11.4" r="6.6" />
          <path d="M12 8.9c-1.3-1.4-3.9-.9-3.9 1.5 0 1 .5 1.6.8 2.1-.5.9-.3 3.8 3.1 3.8s3.6-2.9 3.1-3.8c.3-.5.8-1.1.8-2.1 0-2.4-2.6-2.9-3.9-1.5z" />
          <circle cx="10.4" cy="10.8" r=".5" fill="currentColor" />
          <circle cx="13.6" cy="10.8" r=".5" fill="currentColor" />
          <path d="M3.6 12.6v-1.6a8.4 8.4 0 0 1 16.8 0v1.6" />
          <rect x="2.4" y="10.6" width="2.6" height="4.4" rx="1.1" />
          <rect x="19" y="10.6" width="2.6" height="4.4" rx="1.1" />
          <path d="M20.3 15v1.2c0 2-1.7 3.4-4.2 3.4h-1.6" />
        </>
      ) : (
        <>
          <circle cx="4.6" cy="11.4" r="2.4" />
          <circle cx="19.4" cy="11.4" r="2.4" />
          <circle cx="12" cy="11.4" r="7.2" />
          <path d="M12 8.6c-1.4-1.6-4.3-1-4.3 1.7 0 1.1.6 1.8.9 2.4-.6 1-.4 4.2 3.4 4.2s4-3.2 3.4-4.2c.3-.6.9-1.3.9-2.4 0-2.7-2.9-3.3-4.3-1.7z" />
          <circle cx="10.2" cy="10.6" r=".55" fill="currentColor" />
          <circle cx="13.8" cy="10.6" r=".55" fill="currentColor" />
          <path d="M10.7 14.6c.8.6 1.8.6 2.6 0" />
        </>
      )}
    </svg>
  )
}

export function ViewModeToggle({ mode, onChange, compact = false }: { mode: ViewMode; onChange: (m: ViewMode) => void; compact?: boolean }) {
  const item = (m: ViewMode, label: string) => {
    const on = mode === m
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => !on && onChange(m)}
        className={`mv-mode-btn ${on ? 'is-on' : ''} relative flex-1 flex items-center justify-center gap-1.5 rounded-[10px] font-semibold ${compact ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[12.5px]'}`}
      >
        <MonkeyIcon headset={m === 'escritorio'} size={compact ? 17 : 19} />
        {label}
      </button>
    )
  }
  return (
    <div role="radiogroup" aria-label="Modo de visualização" className="flex items-center gap-0.5 p-0.5 rounded-xl bg-black/35 border border-white/10">
      {item('classico', 'Clássico')}
      {item('escritorio', 'Escritório')}
    </div>
  )
}
