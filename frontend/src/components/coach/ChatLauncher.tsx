import { MicrophoneIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useHealth } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { useChat } from '@/store/chat'
import { useVoiceUI } from '@/store/voice'
import { CoachChat } from './CoachChat'
import { CoachFace } from './CoachFace'

const Coach3D = lazy(() => import('./Coach3D'))

/**
 * The coach in 3D, loaded once the page is idle. The flat face shows until the first 3D frame is
 * drawn, then fades out under it; it stays if WebGL is missing or lost.
 */
function CoachAvatar({ happy, still }: { happy: boolean; still: boolean }) {
  const [load, setLoad] = useState(false)
  const [shown, setShown] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    // Safari has no requestIdleCallback.
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(() => setLoad(true), { timeout: 2500 })
      return () => window.cancelIdleCallback(handle)
    }
    const handle = window.setTimeout(() => setLoad(true), 1200)
    return () => window.clearTimeout(handle)
  }, [])
  const live = shown && !failed
  return (
    <span className="relative grid size-14 place-items-center">
      <CoachFace size={56} happy={happy} className={cn('absolute inset-0 transition-opacity duration-300', live && 'opacity-0')} />
      {load && !failed && (
        <Suspense fallback={null}>
          <span className={cn('grid place-items-center transition-opacity duration-300', live ? 'opacity-100' : 'opacity-0')}>
            <Coach3D size={56} happy={happy} still={still} onReady={() => setShown(true)} onFail={() => setFailed(true)} />
          </span>
        </Suspense>
      )}
    </span>
  )
}

/**
 * The coach, one tap away on every page: a little 3D character in the corner that follows the
 * pointer with its eyes, blinks, and smiles when you point at it. Tapping it opens a chat panel. The
 * conversation is kept while the panel is closed.
 */
export function ChatLauncher() {
  const open = useChat((s) => s.open)
  const toggle = useChat((s) => s.toggle)
  const setOpen = useChat((s) => s.setOpen)
  const hasMessages = useChat((s) => s.messages.length > 0)
  const clear = useChat((s) => s.clear)
  const reduce = useReducedMotion()
  const { data: health } = useHealth()
  const openVoice = useVoiceUI((s) => s.setOpen)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.section
            key="panel"
            role="dialog"
            aria-label="Ask your coach"
            initial={reduce ? false : { opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            style={{ transformOrigin: 'bottom right' }}
            className="material fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+9.5rem)] z-50 flex h-[min(540px,calc(100dvh-13rem))] flex-col overflow-hidden rounded-[28px] border border-border shadow-2xl sm:inset-x-auto sm:right-6 sm:w-[400px] lg:bottom-24"
          >
            <header className="flex items-center gap-2 border-b border-border px-4 py-3">
              <CoachFace size={34} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">Your coach</div>
                <div className="text-xs text-subtle">Ask about a word, a sound or your progress</div>
              </div>
              {health?.voice_agent && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    openVoice(true)
                  }}
                  aria-label="Talk to your coach out loud"
                  title="Talk out loud"
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary-soft px-3 text-[13px] font-semibold text-primary transition-colors hover:brightness-95"
                >
                  <MicrophoneIcon size={15} weight="fill" /> Talk
                </button>
              )}
              {hasMessages && (
                <button
                  type="button"
                  onClick={clear}
                  aria-label="Clear the conversation"
                  className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-fill"
                >
                  <TrashIcon size={17} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close the chat"
                className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-fill"
              >
                <XIcon size={17} weight="bold" />
              </button>
            </header>
            <CoachChat />
          </motion.section>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={toggle}
        aria-label={open ? 'Close the coach chat' : 'Ask your coach'}
        aria-expanded={open}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        initial={reduce ? false : { scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 22, delay: 0.4 }}
        className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 size-14 rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring/40 sm:right-6 lg:bottom-6"
      >
        {/* The coach stays mounted while the panel is open (it sits still under the close button). */}
        <span className="relative grid size-14 place-items-center rounded-full shadow-[0_12px_30px_-10px_rgb(201_89_221/0.7)]">
          <motion.span
            animate={{ scale: open ? 0.6 : 1, opacity: open ? 0 : 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            className="block"
          >
            <CoachAvatar happy={hovered && !open} still={!!reduce || open} />
          </motion.span>
          <AnimatePresence initial={false}>
            {open && (
              <motion.span
                key="close"
                initial={reduce ? false : { rotate: -60, opacity: 0, scale: 0.7 }}
                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                exit={{ rotate: 60, opacity: 0, scale: 0.7 }}
                transition={{ type: 'spring', stiffness: 420, damping: 24 }}
                className="bg-ai absolute inset-0 grid place-items-center rounded-full text-white"
              >
                <XIcon size={24} weight="bold" />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </motion.button>
    </>
  )
}
