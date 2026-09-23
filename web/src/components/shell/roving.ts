import type { KeyboardEvent } from 'react'

/**
 * Roving tabindex for a radiogroup / tablist: one Tab stop for the group,
 * arrows (and Home/End) move both focus and selection within it.
 * Attach to the container; `selector` picks the option buttons.
 */
export function rovingKeyDown<T extends string>(
  e: KeyboardEvent<HTMLElement>,
  options: Array<{ value: T }>,
  value: T | undefined,
  onChange: (v: T) => void,
  selector: string,
) {
  let next: number
  const current = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  const last = options.length - 1
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      next = current === last ? 0 : current + 1
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      next = current === 0 ? last : current - 1
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = last
      break
    default:
      return
  }
  e.preventDefault()
  onChange(options[next].value)
  const buttons = e.currentTarget.querySelectorAll<HTMLElement>(selector)
  buttons[next]?.focus()
}

/** tabIndex for an option: 0 on the selected one (or the first when none). */
export function rovingTabIndex<T extends string>(
  options: Array<{ value: T }>,
  value: T | undefined,
  index: number,
): 0 | -1 {
  const selected = options.findIndex((o) => o.value === value)
  return index === (selected === -1 ? 0 : selected) ? 0 : -1
}
