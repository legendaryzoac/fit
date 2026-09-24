import type { ButtonHTMLAttributes } from 'react'

const SIZE = { md: 'h-11 w-11', sm: 'h-9 w-9' } as const

/** A plain, round icon-only button; `label` is its accessible name.
 * `inherit` keeps the parent's ink, for buttons on a tinted surface. */
export function IconButton({
  label,
  size = 'md',
  inherit = false,
  type = 'button',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  size?: keyof typeof SIZE
  inherit?: boolean
}) {
  return (
    <button
      type={type}
      aria-label={label}
      className={`pressable flex shrink-0 items-center justify-center rounded-pill ${
        inherit ? 'hover:bg-surface/40' : 'text-ink-2 hover:bg-surface-2'
      } ${SIZE[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
