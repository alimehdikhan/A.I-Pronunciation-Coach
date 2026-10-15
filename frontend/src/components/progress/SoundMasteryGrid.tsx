import { ArrowDownRightIcon, ArrowUpRightIcon } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { describeSound, STATUS_WORDS } from '@/lib/plain'
import type { SoundMastery } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useUI } from '@/store/ui'

const TONE: Record<SoundMastery['status'], string> = {
  needs_work: 'bg-bad-soft text-bad',
  getting_there: 'bg-warn-soft text-warn',
  solid: 'bg-good-soft text-good',
  new: 'bg-fill text-muted-foreground',
}

/** Every sound you have tried three or more times, weakest first, in plain words. */
export function SoundMasteryGrid({ sounds }: { sounds: SoundMastery[] }) {
  const openPhoneme = useUI((s) => s.openPhoneme)
  const reduce = useReducedMotion()
  return (
    <>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {sounds.map((s, index) => {
          const { spelled, word } = describeSound(s)
          // Rounded down on purpose: 89.7% must not read "90%" next to a sound that is "Got it" at 90%.
          const percent = Math.floor(s.clean_rate * 100 + 1e-9)
          return (
            <motion.li
              key={s.phoneme}
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(0.5, index * 0.04), type: 'spring', stiffness: 300, damping: 26 }}
            >
              <motion.button
                type="button"
                onClick={() => openPhoneme(s.phoneme)}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.97 }}
                className="flex w-full flex-col gap-2 rounded-2xl bg-fill p-3 text-left transition-colors hover:bg-fill-strong"
              >
                <div className="flex items-center justify-between">
                  <span className="min-w-0 truncate text-[16px] font-semibold">
                    {word || spelled}
                    <span className="ml-1.5 text-[12px] font-normal text-subtle">{spelled}</span>
                  </span>
                  {s.trend === 'improving' && <ArrowUpRightIcon size={16} weight="bold" className="shrink-0 text-good" aria-label="Improving" />}
                  {s.trend === 'slipping' && <ArrowDownRightIcon size={16} weight="bold" className="shrink-0 text-bad" aria-label="Slipping" />}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-background/60">
                  <motion.div
                    className={cn('h-full rounded-full', s.status === 'solid' ? 'bg-good' : s.status === 'needs_work' ? 'bg-bad' : 'bg-warn')}
                    initial={reduce ? false : { width: 0 }}
                    animate={{ width: `${percent}%` }}
                    transition={{ delay: Math.min(0.5, index * 0.04) + 0.15, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 text-[12px]">
                  <span className={cn('rounded-full px-2 py-0.5 font-medium', TONE[s.status])}>{STATUS_WORDS[s.status]}</span>
                  <span className="text-subtle tabular-nums">
                    {percent}% · tried {s.attempts}×
                  </span>
                </div>
              </motion.button>
            </motion.li>
          )
        })}
      </ul>
      <p className="mt-3 text-xs text-subtle">
        The percentage is how often the sound came out right when you tried it. The weakest are listed first.
      </p>
    </>
  )
}
