import { ChatCircleDotsIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect } from 'react'
import { useChat } from '@/store/chat'
import { CoachChat } from './CoachChat'

/**
 * The coach, one tap away on every page: a round button in the corner that opens a chat panel.
 * The conversation is kept while the panel is closed.
 */
export function ChatLauncher() {
  const open = useChat((s) => s.open)
  const toggle = useChat((s) => s.toggle)
  const setOpen = useChat((s) => s.setOpen)
  const hasMessages = useChat((s) => s.messages.length > 0)
  const clear = useChat((s) => s.clear)
  const reduce = useReducedMotion()

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
              <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-primary">
                <ChatCircleDotsIcon size={18} weight="fill" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">Your coach</div>
                <div className="text-xs text-subtle">Ask about a word, a sound or your progress</div>
              </div>
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
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        initial={reduce ? false : { scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 22, delay: 0.4 }}
        className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30 sm:right-6 lg:bottom-6"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={open ? 'close' : 'open'}
            initial={reduce ? false : { rotate: -60, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 60, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {open ? <XIcon size={24} weight="bold" /> : <ChatCircleDotsIcon size={26} weight="fill" />}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </>
  )
}
