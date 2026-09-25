import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  currentConfirm,
  settleConfirm,
  subscribeConfirm,
  type ConfirmRequest,
} from '../../lib/confirm'
import { Button } from '../cadence/Button'

const EXIT_MS = 120

/**
 * The one confirm dialog, mounted once in the shell and driven by
 * `confirm()`. A small centred card over its own scrim, above any sheet.
 * Escape and the scrim answer no; focus goes to the safe button and back.
 */
export function ConfirmDialog() {
  const req = useSyncExternalStore(subscribeConfirm, currentConfirm, currentConfirm)
  // The last request stays rendered through the exit transition.
  const [last, setLast] = useState<ConfirmRequest | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    if (req) {
      setLast(req)
      return
    }
    const t = setTimeout(() => setLast(null), EXIT_MS)
    return () => clearTimeout(t)
  }, [req])

  // Focus in, Escape, a Tab loop over the two buttons, focus back out.
  // Capture phase so an open Sheet's own Escape handler never sees it.
  useEffect(() => {
    if (!req) return
    restoreRef.current = document.activeElement as HTMLElement | null
    // The safe choice comes first in the card.
    cardRef.current?.querySelector<HTMLElement>('button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        settleConfirm(false)
        return
      }
      if (e.key !== 'Tab' || !cardRef.current) return
      const items = Array.from(
        cardRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'),
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      const inside = cardRef.current.contains(current)
      if (!inside || (e.shiftKey && current === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && current === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      restoreRef.current?.focus?.()
      restoreRef.current = null
    }
  }, [req])

  const shown = req ?? last
  if (!shown) return null
  const closing = req == null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-6">
      <div
        aria-hidden="true"
        onClick={() => settleConfirm(false)}
        className={`motion-quick absolute inset-0 bg-scrim transition-opacity ${
          closing ? 'opacity-0' : 'animate-fade'
        }`}
      />
      <div
        ref={cardRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={shown.body ? bodyId : undefined}
        className={`motion-quick relative w-full max-w-xs rounded-lg bg-surface p-5 shadow-float transition-[opacity,transform] ${
          closing ? 'scale-95 opacity-0' : 'animate-pop'
        }`}
      >
        <h2 id={titleId} className="text-title text-ink">
          {shown.title}
        </h2>
        {shown.body && (
          <p id={bodyId} className="mt-1 text-body text-ink-2">
            {shown.body}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="quiet" onClick={() => settleConfirm(false)}>
            {shown.cancel ?? 'Keep'}
          </Button>
          <Button
            variant={shown.tone === 'brand' ? 'primary' : 'danger'}
            onClick={() => settleConfirm(true)}
          >
            {shown.action}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
