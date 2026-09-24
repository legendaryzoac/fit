import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'tonal' | 'ghost' | 'quiet' | 'danger'
export type ButtonSize = 'md' | 'sm'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-strong',
  tonal: 'bg-brand-soft text-brand-strong',
  ghost: 'text-brand-strong hover:bg-surface-2',
  quiet: 'bg-surface-2 text-ink hover:bg-surface-3',
  danger: 'bg-rose text-on-rose',
}

const SIZE: Record<ButtonSize, string> = {
  md: 'min-h-11 text-body font-semibold',
  sm: 'min-h-9 text-caption font-semibold',
}

/** Side padding by size; ghost trims it. Only one px-* class ever lands on an element. */
const PAD: Record<ButtonSize, string> = { md: 'px-5', sm: 'px-3.5' }
const GHOST_PAD = 'px-3'

/** A pill button. Ghost trims its side padding; block fills the row. */
export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  type = 'button',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
}) {
  const pad = variant === 'ghost' ? GHOST_PAD : PAD[size]
  return (
    <button
      type={type}
      className={`pressable inline-flex items-center justify-center gap-2 rounded-pill disabled:opacity-40 ${SIZE[size]} ${pad} ${VARIANT[variant]} ${
        block ? 'flex w-full' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
