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
  header,
  ariaLabel,
  dockClearance,
  footer,
  tall,
  children,
}: {
  open: boolean
  onClose: () => void
  /** Fires once the exit transition has finished and the sheet unmounts. */
  onExited?: () => void
  title?: string
  /** Stays put under the handle while the body scrolls, e.g. a SessionBar. */
  header?: ReactNode
  /** Used when there is no title to label the dialog. */
  ariaLabel?: string
  /** Leave room under the body for the floating dock (live sessions). */
  dockClearance?: boolean
  /** Stays put under the body while it scrolls, e.g. a message composer. */
  footer?: ReactNode
  /** Hold the full height whatever the content, so a growing thread does
   * not make the sheet jump. */
  tall?: boolean
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

  // A sheet with a footer usually has a text field in it. Where the
  // on-screen keyboard covers the page instead of resizing it (iOS), lift
  // the sheet by the covered height so the field stays in view.
  const hasFooter = footer != null
  const [keyboard, setKeyboard] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!open || !hasFooter || !vv) return
    const update = () =>
      setKeyboard(
        Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)),
      )
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      setKeyboard(0)
    }
  }, [open, hasFooter])

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
        style={
          keyboard > 0
            ? {
                bottom: keyboard,
                // Whatever is left above the keyboard, less a sliver of page
                maxHeight: `calc(100dvh - ${keyboard}px - 12px)`,
              }
            : undefined
        }
        className={`fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-column flex-col rounded-t-xl bg-surface shadow-float transition-transform ${
          tall ? 'h-[92dvh]' : 'max-h-[92dvh]'
        } ${
          shown && open
            ? 'translate-y-0 duration-[400ms] ease-out'
            : 'translate-y-full duration-[240ms] ease-in'
        }`}
      >
        {/* Handle, title and header stay put; only the body scrolls, so
            nothing can ride up past the bar. */}
        <div className="shrink-0 px-6 pt-2">
          <div
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleEnd}
            onPointerCancel={onHandleEnd}
            className="mx-auto mb-3 flex h-6 w-16 touch-none items-center justify-center"
          >
            <div className="h-1 w-9 rounded-xs bg-surface-3" />
          </div>
          {title && (
            <h2 id={titleId} className="mb-3 text-title text-ink">
              {title}
            </h2>
          )}
          {header}
        </div>
        <div
          className={`min-h-0 flex-1 overflow-y-auto px-6 ${
            dockClearance
              ? 'pb-[calc(100px+env(safe-area-inset-bottom))]'
              : footer
                ? 'pb-4'
                : 'pb-[calc(24px+env(safe-area-inset-bottom))]'
          }`}
        >
          {children}
        </div>
        {footer && (
          <div className="shrink-0 px-4 pt-2 pb-[calc(12px+env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
