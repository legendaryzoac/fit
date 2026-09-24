import { useCallback, useRef, useState } from 'react'

/**
 * For a Sheet whose parent unmounts it on the way out: `dismiss(then)`
 * drops the sheet first and runs `then` from the Sheet's onExited, so the
 * mode switch waits for the exit transition. A second dismiss while one
 * is in flight is ignored.
 */
export function useSheetDismiss() {
  const [open, setOpen] = useState(true)
  const pending = useRef<(() => void) | null>(null)
  const dismiss = useCallback((then: () => void) => {
    if (pending.current) return
    pending.current = then
    setOpen(false)
  }, [])
  const onExited = useCallback(() => {
    pending.current?.()
  }, [])
  return { open, dismiss, onExited }
}
