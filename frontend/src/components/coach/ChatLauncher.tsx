import { MicrophoneIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useHealth } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { useChat } from '@/store/chat'
import { useVoiceUI } from '@/store/voice'
import type { CoachMood } from './Coach3D'
import { CoachChat } from './CoachChat'
import { CoachExtras } from './CoachExtras'
import { CoachFace } from './CoachFace'

const Coach3D = lazy(() => import('./Coach3D'))

/**
 * The coach in 3D, loaded once the page is idle. The flat face shows until the first 3D frame is
 * drawn, then fades out under it; it stays if WebGL is missing or lost.
 */
function CoachAvatar({
  happy,
  still,
  hidden,
  cue,
  pressed,
  onMood,
  onNudge,
}: {
  happy: boolean
  still: boolean
  hidden: boolean
  cue: number
  pressed: boolean
  onMood: (mood: CoachMood) => void
  onNudge: () => void
}) {
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
            <Coach3D
              size={56}
              happy={happy}
              still={still}
              hidden={hidden}
              cue={cue}
              pressed={pressed}
              onMood={onMood}
              onNudge={onNudge}
              onReady={() => setShown(true)}
              onFail={() => setFailed(true)}
            />
          </span>
        </Suspense>
      )}
    </span>
  )
}

const HELLO_KEY = 'coach-hello-shown'
const NUDGES_KEY = 'coach-nudges'
const HELLO_AFTER_MS = 3500
const BUBBLE_FOR_MS = 6000
const MAX_NUDGES = 2
const NUDGES = ['Psst… need a hand?', 'Want a quick tip?', 'Stuck? I can help.']

function readSession(key: string) {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSession(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // Private windows may refuse storage; the bubbles then follow each page load instead.
  }
}

/**
 * What the coach says in its bubble: a hello once per browser session (unless the chat is already in
 * use), and up to two nudges a session when nobody has come by for a while.
 */
function useBubble(open: boolean, used: boolean) {
  const [bubble, setBubble] = useState<{ text: string; ask: boolean } | null>(null)
  const [cue, setCue] = useState(0)
  useEffect(() => {
    if (readSession(HELLO_KEY) === '1' || open || used) return
    const show = window.setTimeout(() => {
      writeSession(HELLO_KEY, '1')
      setBubble({ text: 'Hi! Stuck on a word?', ask: true })
      setCue((c) => c + 1)
    }, HELLO_AFTER_MS)
    return () => window.clearTimeout(show)
    // Decided once, on arrival.
  }, [])
  useEffect(() => {
    if (!bubble) return
    const hide = window.setTimeout(() => setBubble(null), BUBBLE_FOR_MS)
    return () => window.clearTimeout(hide)
  }, [bubble])
  useEffect(() => {
    if (open) setBubble(null)
  }, [open])
  const nudge = () => {
    const shown = Number(readSession(NUDGES_KEY) ?? 0)
    if (open || bubble || shown >= MAX_NUDGES) return
    writeSession(NUDGES_KEY, String(shown + 1))
    setBubble({ text: NUDGES[shown % NUDGES.length], ask: false })
  }
  return { bubble, cue, nudge, dismiss: () => setBubble(null) }
}

/**
 * The coach, one tap away on every page: a little 3D character in the corner (a pearl-white head with
 * a glass face). It notices the pointer when it comes near and follows it, reacts to being pointed at
 * and pressed, says hello once per visit and nudges now and then. Tapping it opens a chat panel; the
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
  const [pressed, setPressed] = useState(false)
  const [mood, setMood] = useState<CoachMood>('idle')
  const { bubble, cue, nudge, dismiss } = useBubble(open, hasMessages)

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
        onPointerLeave={() => {
          setHovered(false)
          setPressed(false)
        }}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerCancel={() => setPressed(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        whileHover={{ scale: 1.06 }}
        initial={reduce ? false : { scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 22, delay: 0.4 }}
        className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 size-14 rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring/40 sm:right-6 lg:bottom-6"
      >
        {/* The coach stays mounted while the panel is open (it sits still under the close button). */}
        <span className="relative grid size-14 place-items-center rounded-full shadow-[0_10px_26px_-14px_rgb(16_24_48/0.45)]">
          <motion.span
            animate={{ scale: open ? 0.6 : 1, opacity: open ? 0 : 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            className="block"
          >
            <CoachAvatar
              happy={hovered && !open}
              still={!!reduce}
              hidden={open}
              cue={cue}
              pressed={pressed}
              onMood={setMood}
              onNudge={nudge}
            />
          </motion.span>
          {!open && <CoachExtras mood={mood} />}
          <AnimatePresence initial={false}>
            {open && (
              <motion.span
                key="close"
                initial={reduce ? false : { rotate: -60, opacity: 0, scale: 0.7 }}
                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                exit={{ rotate: 60, opacity: 0, scale: 0.7 }}
                transition={{ type: 'spring', stiffness: 420, damping: 24 }}
                className="absolute inset-0 grid place-items-center rounded-full bg-[#111216] text-white ring-1 ring-white/10"
              >
                <XIcon size={24} weight="bold" />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </motion.button>

      {/* Decorative: the button beside it already says "Ask your coach" to assistive tech. */}
      <AnimatePresence>
        {bubble && !open && (
          <motion.button
            key={bubble.text}
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => {
              dismiss()
              setOpen(true)
            }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, x: 12 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8, x: 8 }}
            transition={{ type: 'spring', stiffness: 460, damping: 28 }}
            style={{ transformOrigin: 'right center' }}
            className="fixed right-[4.9rem] bottom-[calc(env(safe-area-inset-bottom)+5.5rem+0.625rem)] z-50 flex h-9 items-center rounded-full bg-foreground pr-3.5 pl-3.5 text-[13px] font-medium whitespace-nowrap text-background shadow-[0_12px_32px_-8px_hsl(var(--shadow-color)/0.45),0_2px_6px_hsl(var(--shadow-color)/0.12)] sm:right-[5.4rem] lg:bottom-[calc(1.5rem+0.625rem)]"
          >
            {bubble.text}
            {bubble.ask && <span className="ml-1 font-semibold text-primary">Ask me</span>}
            {/* The pointer to the coach. */}
            <span className="absolute top-1/2 left-full size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-foreground" />
          </motion.button>
        )}
      </AnimatePresence>
    </>
  )
}
