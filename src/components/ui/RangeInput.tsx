import { forwardRef, type CSSProperties, type InputHTMLAttributes } from 'react'

type RangeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export const RangeInput = forwardRef<HTMLInputElement, RangeInputProps>(function RangeInput(
  { className = '', style, min = 0, max = 100, value, defaultValue, ...rest },
  ref
) {
  const lo = Number(min)
  const hi = Number(max)
  const current = Number(value ?? defaultValue ?? lo)
  const pct = hi > lo ? Math.min(100, Math.max(0, ((current - lo) / (hi - lo)) * 100)) : 0
  return (
    <input
      ref={ref}
      type="range"
      min={min}
      max={max}
      value={value}
      defaultValue={defaultValue}
      className={`mv-range ${className}`}
      style={{ ...style, '--fill': `${pct}%` } as CSSProperties}
      {...rest}
    />
  )
})
