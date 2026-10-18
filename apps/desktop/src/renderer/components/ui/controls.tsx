import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-control)] px-3 text-[13px] font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40',
        variant === 'primary' && 'bg-accent text-white shadow-[var(--shadow-glow)] hover:bg-accent-hover',
        variant === 'secondary' && 'border border-line bg-elevated text-fg hover:bg-raised',
        variant === 'ghost' && 'text-fg-2 hover:bg-elevated hover:text-fg',
        variant === 'danger' && 'border border-line bg-elevated text-danger hover:bg-raised',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-2 transition-colors hover:bg-elevated hover:text-fg disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  title?: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: SegmentedOption<T>[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[var(--radius-control)] border border-line bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-6 min-w-9 rounded-md px-2 text-xs font-medium transition-colors',
            o.value === value ? 'bg-accent text-white' : 'text-fg-2 hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  min = 1,
  max = 32768,
  unit,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  unit?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <label htmlFor={id} className="flex items-center gap-1.5 text-xs text-fg-2">
      <span className="w-3 text-fg-3">{label}</span>
      <input
        id={id}
        type="number"
        aria-label={label}
        disabled={disabled}
        min={min}
        max={max}
        value={Number.isFinite(value) ? Math.round(value) : ''}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(Math.min(Math.max(Math.round(v), min), max))
        }}
        className="h-7 w-20 rounded-md border border-line bg-bg px-2 text-[13px] text-fg tabular-nums outline-none focus:border-accent disabled:opacity-40"
      />
      {unit && <span className="text-fg-3">{unit}</span>}
    </label>
  )
}

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  suffix?: string
}) {
  const id = useId()
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-16 shrink-0 text-xs text-fg-2">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full accent-[var(--color-accent)]"
        style={{ background: `linear-gradient(to right, var(--color-accent) ${pct}%, var(--color-raised) ${pct}%)` }}
      />
      <span className="w-12 text-right text-xs text-fg tabular-nums">
        {value}
        {suffix}
      </span>
    </div>
  )
}

export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <span className="text-xs text-fg-2">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

export { cx }
