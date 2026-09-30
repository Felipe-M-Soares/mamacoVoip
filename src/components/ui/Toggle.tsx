// Interruptor em pílula (role="switch") — substitui o checkbox quadrado
// padrão do navegador nas telas de configuração. Acessível: anuncia o
// estado via aria-checked e responde a Espaço/Enter por ser um <button>.
export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  id,
  size = 'md',
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** Rótulo pra leitor de tela quando não há <label> visível associado. */
  label?: string
  id?: string
  size?: 'sm' | 'md'
}) {
  const track = size === 'sm' ? 'w-8 h-[18px]' : 'w-10 h-6'
  const knob = size === 'sm' ? 'w-3.5 h-3.5' : 'w-[18px] h-[18px]'
  const shift = size === 'sm' ? 'translate-x-[14px]' : 'translate-x-4'
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex items-center shrink-0 rounded-full p-[3px] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${track} ${
        checked
          ? 'bg-mv-accent shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]'
          : 'bg-mv-raised shadow-[inset_0_0_0_1px_var(--color-line-strong)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`${knob} rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.4)] transition-transform duration-150 ease-out ${
          checked ? shift : 'translate-x-0'
        } flex items-center justify-center`}
      >
        {checked && size === 'md' && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5 text-mv-accent">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        )}
      </span>
    </button>
  )
}
