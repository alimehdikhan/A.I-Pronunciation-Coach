import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  type Icon,
  SparkleIcon,
  TargetIcon,
  TrendUpIcon,
} from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { describeSound } from '@/lib/plain'
import type { SoundMastery } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useUI } from '@/store/ui'

const STATUS: Record<SoundMastery['status'], { label: string; tone: string; Icon: Icon }> = {
  needs_work: { label: 'Needs practice', tone: 'bg-bad-soft text-bad', Icon: TargetIcon },
  getting_there: { label: 'Getting there', tone: 'bg-warn-soft text-warn', Icon: TrendUpIcon },
  solid: { label: 'Got it', tone: 'bg-good-soft text-good', Icon: CheckCircleIcon },
  new: { label: 'Just started', tone: 'bg-fill text-muted-foreground', Icon: SparkleIcon },
}

/**
 * Every sound you have tried a few times: how often you get it right, how often you have tried it,
 * and whether it is getting better. Written in plain words: the sound is named by its spelling
 * and an example word, never by its phonetic symbol (that is one tap away in the sound guide).
 */
export function SoundMasteryGrid({ sounds }: { sounds: SoundMastery[] }) {
  const openPhoneme = useUI((s) => s.openPhoneme)
  const reduce = useReducedMotion()
  return (
    <>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {sounds.map((s, index) => {
          const status = STATUS[s.status]
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
                title={`Tap to see how to make the ${spelled} sound`}
                className="group flex w-full flex-col gap-2 rounded-2xl bg-fill p-3 text-left transition-colors hover:bg-fill-strong"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="text-[22px] leading-none font-medium">{spelled}</span>
                    {word && <span className="truncate text-[12px] text-subtle">as in {word}</span>}
                  </span>
                  {s.trend === 'improving' && (
                    <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-good">
                      <ArrowUpRightIcon size={14} weight="bold" /> Improving
                    </span>
                  )}
                  {s.trend === 'slipping' && (
                    <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-bad">
                      <ArrowDownRightIcon size={14} weight="bold" /> Slipping
                    </span>
                  )}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-background/60" aria-hidden>
                  <motion.div
                    className={cn(
                      'h-full w-full origin-left rounded-full',
                      s.status === 'solid' ? 'bg-good' : s.status === 'needs_work' ? 'bg-bad' : 'bg-warn',
                    )}
                    initial={reduce ? false : { scaleX: 0 }}
                    animate={{ scaleX: percent / 100 }}
                    transition={{ delay: Math.min(0.5, index * 0.04) + 0.15, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[12px]">
                  <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium', status.tone)}>
                    <status.Icon size={12} weight="fill" />
                    {status.label}
                  </span>
                  <span className="text-subtle tabular-nums">
                    {percent}% right · {s.attempts} {s.attempts === 1 ? 'try' : 'tries'}
                  </span>
                </div>
              </motion.button>
            </motion.li>
          )
        })}
      </ul>
      <p className="mt-3 text-xs text-subtle">
        The bar shows how often you say each sound correctly. The sounds that need the most practice are at the top. Tap one to see how to
        make it.
      </p>
    </>
  )
}
