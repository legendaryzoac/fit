/** The mark: a barbell, evergreen plates on an ink bar. Colours come from
 * the theme so it follows Dawn and Dusk. Pairs with the FIT wordmark. */
export function BrandMark({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect x="4" y="29" width="56" height="6" rx="3" fill="var(--ink)" />
      <rect x="10" y="16" width="9" height="32" rx="4" fill="var(--brand)" />
      <rect x="21" y="22" width="6" height="20" rx="3" fill="var(--ink)" />
      <rect x="45" y="16" width="9" height="32" rx="4" fill="var(--brand)" />
      <rect x="37" y="22" width="6" height="20" rx="3" fill="var(--ink)" />
    </svg>
  )
}
