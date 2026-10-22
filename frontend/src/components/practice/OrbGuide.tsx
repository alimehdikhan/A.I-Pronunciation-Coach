import { HandTapIcon, MicrophoneIcon, SparkleIcon, WaveformIcon, type Icon } from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'

/** Where a first-time learner is in their first recording. */
export type OrbGuideStep = 'tap' | 'allow' | 'speak' | 'wait'

const STEPS: Record<OrbGuideStep, { number: 1 | 2 | 3; icon: Icon; title: string; text: string }> = {
  tap: { number: 1, icon: HandTapIcon, title: 'Tap the orb to start', text: 'It turns on your microphone. Then say the phrase above.' },
  allow: { number: 1, icon: MicrophoneIcon, title: 'Allow your microphone', text: 'Your browser is asking. Choose Allow so your coach can hear you.' },
  speak: { number: 2, icon: WaveformIcon, title: 'Say the phrase out loud', text: 'Then tap the orb again to finish.' },
  wait: { number: 3, icon: SparkleIcon, title: 'Checking each sound', text: 'Your results appear below in a few seconds.' },
}

const EASE_OUT = [0.23, 1, 0.32, 1] as const

/**
 * A tip above the Practice orb that walks a first-time learner through one real recording:
 * tap to start, say the phrase, tap again to finish. It follows what they actually do.
 */
export function OrbGuide({ step, id, onSkip }: { step: OrbGuideStep | null; id: string; onSkip: () => void }) {
  const reduce = useReducedMotion()
  const current = step ? STEPS[step] : null

  return (
    <>
      {/* Read out each step as the learner reaches it; the orb is described by it too. */}
      <span id={id} aria-live="polite" className="sr-only">
        {current ? `${current.title}. ${current.text}` : ''}
      </span>
      <AnimatePresence initial={!reduce}>
        {current && (
          <motion.div
            key="guide"
            // The tip makes room above the orb, so nothing on the card is covered.
            initial={reduce ? false : { height: 0 }}
            animate={{ height: 'auto' }}
            exit={reduce ? undefined : { height: 0, transition: { duration: 0.3, delay: 0.1, ease: EASE_OUT } }}
            transition={{ duration: 0.4, ease: EASE_OUT }}
            className="flex w-full justify-center"
          >
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 4, transition: { duration: 0.15 } }}
              transition={reduce ? { duration: 0.2 } : { type: 'spring', bounce: 0.25, duration: 0.5, delay: 0.1 }}
              style={{ transformOrigin: '50% 100%' }}
              className="relative mb-1.5 w-full max-w-[312px] rounded-2xl bg-foreground p-4 text-background shadow-[0_12px_32px_-8px_hsl(var(--shadow-color)/0.45),0_2px_6px_hsl(var(--shadow-color)/0.12)]"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step}
                  aria-hidden
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4, filter: 'blur(3px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3, filter: 'blur(3px)' }}
                  transition={{ duration: 0.18, ease: EASE_OUT }}
                  className="flex min-h-[58px] gap-3"
                >
                  <current.icon size={22} weight="fill" className="mt-px shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-[15px] leading-snug font-semibold tracking-[-0.01em]">{current.title}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-background/70">{current.text}</p>
                  </div>
                </motion.div>
              </AnimatePresence>

              <div className="mt-3 flex items-center justify-between pl-[34px]">
                <div className="flex items-center gap-2" aria-hidden>
                  <span className="flex gap-1">
                    {[1, 2, 3].map((n) => (
                      <span
                        key={n}
                        className={cn(
                          'h-1 rounded-full transition-[width,background-color] duration-300',
                          n === current.number ? 'w-4 bg-background' : n < current.number ? 'w-1.5 bg-background/60' : 'w-1.5 bg-background/25',
                        )}
                      />
                    ))}
                  </span>
                  <span className="text-[12px] text-background/60 tabular-nums">{current.number} of 3</span>
                </div>
                <button
                  type="button"
                  onClick={onSkip}
                  aria-label="Skip the tips"
                  className="-my-1 -mr-1.5 rounded-full px-1.5 py-1 text-[13px] font-medium text-background/70 transition-colors outline-none hover:text-background focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Skip
                </button>
              </div>

              {/* The pointer down to the orb. */}
              <span aria-hidden className="absolute top-full left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] bg-foreground" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/** Rings that spread out from the orb, so a first-time learner sees it is the thing to tap. */
export function OrbPulse({ size }: { size: number }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
      {[0, 1].map((i) => (
        <span
          key={i}
          className="orb-pulse col-start-1 row-start-1 rounded-full border-2 border-primary"
          style={{ width: size, height: size, animationDelay: `${i * 1.2}s` }}
        />
      ))}
    </span>
  )
}
