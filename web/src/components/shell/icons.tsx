/**
 * Cadence stroke icons: 24 grid, currentColor, 2px, round caps and joins.
 * Every icon is decorative — the button that carries it owns the label.
 */
import type { ReactNode } from 'react'

type IconProps = { className?: string }

function Icon({
  className = 'h-5 w-5',
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function IconChevronDown(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  )
}

export function IconChevronLeft(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="m15 6-6 6 6 6" />
    </Icon>
  )
}

export function IconChevronRight(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  )
}

export function IconX(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  )
}

export function IconPlus(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

export function IconMinus(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 12h14" />
    </Icon>
  )
}

export function IconCheck(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="m5 12 5 5 9-10" />
    </Icon>
  )
}

export function IconPlay(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M7 5v14l12-7z" />
    </Icon>
  )
}

export function IconPause(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M8 5v14M16 5v14" />
    </Icon>
  )
}

/** Play triangle with a bar: skip to the next section. */
export function IconSkip(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 5v14l10-7z M19 5v14" />
    </Icon>
  )
}

export function IconMore(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 12h.01M12 12h.01M19 12h.01" />
    </Icon>
  )
}

/** A simple gear: circle plus eight short ticks. */
export function IconSettings(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M4.9 19.1l2.2-2.2M16.9 7.1l2.2-2.2" />
    </Icon>
  )
}

export function IconToday(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  )
}

export function IconLog(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </Icon>
  )
}

export function IconPlan(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Icon>
  )
}

export function IconTrends(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 18 10 11l4 4 6-8" />
    </Icon>
  )
}
