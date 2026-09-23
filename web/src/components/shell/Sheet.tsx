import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

const EXIT_MS = 240
const DRAG_CLOSE_PX = 80

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Bottom sheet. Rises over 400ms, drops over 240ms, and stays mounted
 * until the drop finishes. Locks body scroll, moves focus in and back
 * out, closes on Escape, scrim tap, or a downward drag on the handle.
 */
export function Sheet({
  open,
  onClose,
  onExited,
  title,
  ariaLabel,
  children,
}: {
  open: boolean
  onClose: () => void
  /** Fires once the exit transition has finished and the sheet unmounts. */
  onExited?: () => void
  title?: string
  /** Used when there is no title to label the dialog. */
  ariaLabel?: string
  children: ReactNode
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const dragStartY = useRef<number | null>(null)
  // Callers often pass an inline onClose; a ref keeps the open-time
  // effect from re-running (and re-focusing) on every parent render.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onExitedRef = useRef(onExited)
  onExitedRef.current = onExited
  const wasOpen = useRef(open)

  // `mounted` keeps the DOM alive through the exit; `shown` drives the
  // transform so the enter transition has a frame to start from.
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (open) {
      wasOpen.current = true
      setMounted(true)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setShown(false)
    const exiting = wasOpen.current
    wasOpen.current = false
    const t = setTimeout(
      () => {
        setMounted(false)
        if (exiting) onExitedRef.current?.()
      },
      reducedMotion() ? 0 : EXIT_MS,
    )
    return () => clearTimeout(t)
  }, [open])

  // Body scroll lock, focus in, Escape — all for as long as the sheet is open.
  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
      restoreRef.current?.focus?.()
      restoreRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (open && mounted) panelRef.current?.focus()
  }, [open, mounted])

  if (!mounted) return null

  // A small Tab loop keeps keyboard focus inside the panel.
  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return
    const items = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => el.offsetParent !== null)
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const current = document.activeElement
    if (e.shiftKey && (current === first || current === panelRef.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && current === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const onHandleDown = (e: PointerEvent<HTMLDivElement>) => {
    dragStartY.current = e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onHandleMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return
    if (e.clientY - dragStartY.current > DRAG_CLOSE_PX) {
      dragStartY.current = null
      onClose()
    }
  }
  const onHandleEnd = () => {
    dragStartY.current = null
  }

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`motion-base absolute inset-0 bg-scrim transition-opacity ${
          shown && open ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className={`fixed inset-x-0 bottom-0 mx-auto w-full max-w-column overflow-y-auto rounded-t-xl bg-surface px-6 pt-2 pb-[calc(24px+env(safe-area-inset-bottom))] shadow-float max-h-[92dvh] transition-transform ${
          shown && open
            ? 'translate-y-0 duration-[400ms] ease-out'
            : 'translate-y-full duration-[240ms] ease-in'
        }`}
      >
        <div
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleEnd}
          onPointerCancel={onHandleEnd}
          className="mx-auto mb-4 flex h-6 w-16 touch-none items-center justify-center"
        >
          <div className="h-1 w-9 rounded-xs bg-surface-3" />
        </div>
        {title && (
          <h2 id={titleId} className="mb-4 text-title text-ink">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}
