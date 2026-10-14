import { useEffect, useRef } from 'react'
import { isTypingTarget } from '@/lib/utils'

type Handler = (event: KeyboardEvent) => void

/**
 * Single-key shortcuts (e.g. `' '`, `'r'`). Ignored while typing, while a
 * modifier is held, or while a dialog is open.
 */
export function useHotkeys(map: Record<string, Handler>, enabled = true) {
  const handlers = useRef(map)

  useEffect(() => {
    handlers.current = map
  })

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      if (isTypingTarget(event.target)) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      const key = event.key === ' ' ? ' ' : event.key.toLowerCase()
      const handler = handlers.current[key]
      if (handler) {
        event.preventDefault()
        handler(event)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
