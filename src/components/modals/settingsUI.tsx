import type { ReactNode } from 'react'
import { CheckIcon } from '../ui/icons'

// Peças visuais compartilhadas pelas telas de configuração (usuário e
// servidor): cabeçalho de aba, cartões de grupo, linhas "rótulo +
// controle", slider estilizado e controle segmentado.

export function TabHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-2xl font-semibold text-white">{title}</h1>
      {description && <p className="text-[14px] text-mv-muted mt-1.5 leading-relaxed">{description}</p>}
    </header>
  )
}

export function SettingsCard({
  title,
  description,
  children,
  tone = 'default',
  className = '',
  action,
}: {
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  tone?: 'default' | 'danger'
  className?: string
  action?: ReactNode
}) {
  return (
    <section
      className={`rounded-2xl border p-4 sm:p-5 ${
        tone === 'danger' ? 'border-rose-500/30 bg-rose-500/[0.04]' : 'bg-white/[0.02] border-[var(--color-line)]'
      } ${className}`}
    >
      {(title || action) && (
        <div className={`flex items-start justify-between gap-3 ${children ? 'mb-4' : ''}`}>
          <div className="min-w-0">
            {title && (
              <h2 className={`text-[15px] font-semibold ${tone === 'danger' ? 'text-rose-300' : 'text-white'}`}>{title}</h2>
            )}
            {description && <p className="text-[13px] text-mv-muted mt-1 leading-relaxed">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** Linha de configuração: título + descrição à esquerda, controle à direita. */
export function SettingRow({
  title,
  description,
  control,
  htmlFor,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  control?: ReactNode
  htmlFor?: string
  children?: ReactNode
}) {
  return (
    <div className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          {htmlFor ? (
            <label htmlFor={htmlFor} className="text-[14px] font-medium text-white cursor-pointer">
              {title}
            </label>
          ) : (
            <p className="text-[14px] font-medium text-white">{title}</p>
          )}
          {description && <p className="text-[12.5px] text-mv-muted mt-0.5 leading-relaxed">{description}</p>}
        </div>
        {control}
      </div>
      {children}
    </div>
  )
}

/** Divisor entre SettingRows dentro de um cartão. */
export function RowList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-[var(--color-line)]">{children}</div>
}

export function RangeSlider({
  min,
  max,
  value,
  onChange,
  label,
}: {
  min: number
  max: number
  value: number
  onChange: (value: number) => void
  label: string
}) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100
  return (
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        background: `linear-gradient(to right, var(--color-mv-accent) ${pct}%, var(--color-mv-raised) ${pct}%)`,
      }}
      className="w-full h-1.5 rounded-full appearance-none cursor-pointer
        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:h-[18px]
        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
        [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-mv-accent)_30%,transparent),0_2px_6px_rgb(0_0_0/0.5)]
        [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110
        [&::-moz-range-thumb]:w-[18px] [&::-moz-range-thumb]:h-[18px] [&::-moz-range-thumb]:rounded-full
        [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0"
    />
  )
}

/** Controle segmentado (tipo abas em pílula). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full gap-1 p-1 rounded-xl bg-mv-canvas border border-[var(--color-line)]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 h-8 rounded-lg text-[13px] font-medium transition-colors ${
            value === o.value
              ? 'bg-mv-raised text-white shadow-[inset_0_0_0_1px_var(--color-line-strong)]'
              : 'text-mv-muted hover:text-mv-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center min-w-[1.4rem] justify-center h-[22px] px-1.5 rounded-md bg-mv-canvas border border-[var(--color-line-strong)] border-b-2 font-mono text-[11px] text-mv-muted">
      {children}
    </kbd>
  )
}

export function InlineMessage({ tone, children }: { tone: 'error' | 'success' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'bg-rose-500/10 text-rose-300 border-rose-500/25',
    success: 'bg-mv-green/10 text-mv-green border-mv-green/25',
    info: 'bg-white/[0.03] text-mv-muted border-[var(--color-line)]',
  }[tone]
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`text-[13px] rounded-lg border px-3 py-2 ${styles}`}>
      {children}
    </p>
  )
}

/** Estado vazio: ícone em "azulejo" + título + dica curta. */
export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-8 px-4">
      <span className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-[var(--color-line)] flex items-center justify-center text-mv-muted mb-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden="true">
          {icon}
        </svg>
      </span>
      <p className="text-[14px] font-medium text-white">{title}</p>
      {hint && <p className="text-[12.5px] text-mv-muted mt-0.5 max-w-xs">{hint}</p>}
    </div>
  )
}

/** Linhas-esqueleto de carregamento pra listas. */
export function ListSkeleton({ rows = 4, avatar = false }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="space-y-1" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }, (_, k) => (
        <div key={k} className="flex items-center gap-3 px-3 py-2.5">
          {avatar && <div className="w-8 h-8 rounded-full animate-pulse bg-white/[0.05] shrink-0" />}
          <div className="flex-1 space-y-2">
            <div className="h-2.5 rounded animate-pulse bg-white/[0.05]" style={{ width: `${55 + ((k * 17) % 35)}%` }} />
            <div className="h-2 w-24 rounded animate-pulse bg-white/[0.04]" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Caixa de seleção visual (pro lugar dos checkboxes nativos em listas). */
export function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`w-5 h-5 rounded-md shrink-0 flex items-center justify-center border transition-colors ${
        checked ? 'bg-mv-accent border-mv-accent' : 'border-[var(--color-line-strong)] bg-mv-canvas'
      }`}
    >
      {checked && (
        <CheckIcon className="w-3 h-3 text-white" strokeWidth={3.5} aria-hidden />
      )}
    </span>
  )
}

/** Opção "cartão com rádio" — usada em tipo de canal, visibilidade etc. */
export function OptionCard({
  selected,
  onSelect,
  icon,
  title,
  description,
  disabled,
}: {
  selected: boolean
  onSelect: () => void
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      disabled={disabled}
      className={`w-full flex items-center gap-3 text-left px-3.5 py-3 rounded-xl border transition-colors disabled:opacity-60 ${
        selected ? 'border-mv-accent/60 bg-mv-accent/[0.08]' : 'border-[var(--color-line)] bg-mv-canvas/50 hover:bg-white/[0.04]'
      }`}
    >
      {icon && (
        <span
          className={`w-9 h-9 rounded-[10px] shrink-0 flex items-center justify-center ${
            selected ? 'bg-mv-accent/15 text-mv-accent' : 'bg-white/[0.05] text-mv-muted'
          }`}
        >
          {icon}
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-medium text-white">{title}</span>
        {description && <span className="block text-[12.5px] text-mv-muted mt-0.5">{description}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`w-[18px] h-[18px] rounded-full shrink-0 border-2 flex items-center justify-center ${
          selected ? 'border-mv-accent' : 'border-[var(--color-line-strong)]'
        }`}
      >
        {selected && <span className="w-2 h-2 rounded-full bg-mv-accent" />}
      </span>
    </button>
  )
}

/** Linha com Toggle pra opções dentro de modais (substitui checkbox + texto). */
export function ToggleRow({
  title,
  description,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.02] border border-[var(--color-line)] px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-white">{title}</p>
        {description && <p className="text-[12.5px] text-mv-muted mt-0.5 leading-snug">{description}</p>}
      </div>
      {children}
    </div>
  )
}
