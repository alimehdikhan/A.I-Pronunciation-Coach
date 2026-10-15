import { ArrowDownRightIcon, ArrowUpRightIcon } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import type { SoundMastery } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useUI } from '@/store/ui'

const STATUS: Record<SoundMastery['status'], { label: string; tone: string }> = {
  needs_work: { label: 'Needs work', tone: 'bg-bad-soft text-bad' },
  getting_there: { label: 'Getting there', tone: 'bg-warn-soft text-warn' },
  solid: { label: 'Solid', tone: 'bg-good-soft text-good' },
  new: { label: 'Just started', tone: 'bg-fill text-muted-foreground' },
}

/** Every sound you have attempted at least three times: how often it came out clean, and where it is heading. */
export function SoundMasteryGrid({ sounds }: { sounds: SoundMastery[] }) {
  const openPhoneme = useUI((s) => s.openPhoneme)
  const reduce = useReducedMotion()
  return (
    <>
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
      {sounds.map((s, index) => {
        const status = STATUS[s.status]
        // Rounded down on purpose: 89.7% must not read "90%" next to a sound that is "Solid" at 90%.
        const percent = Math.floor(s.clean_rate * 100 + 1e-9)
        const example = s.label.replace(/^.*?\bas in\s*/i, '').replace(/[“”"]/g, '')
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
              className="group flex w-full flex-col gap-2 rounded-2xl bg-fill p-3 text-left transition-colors hover:bg-fill-strong"
            >
              <div className="flex items-center justify-between">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="ipa text-[22px] leading-none">{s.phoneme}</span>
                  {example && <span className="truncate text-[12px] text-subtle">as in {example}</span>}
                </span>
                {s.trend === 'improving' && <ArrowUpRightIcon size={16} weight="bold" className="text-good" aria-label="Improving" />}
                {s.trend === 'slipping' && <ArrowDownRightIcon size={16} weight="bold" className="text-bad" aria-label="Slipping" />}
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
                <span className={cn('rounded-full px-2 py-0.5 font-medium', status.tone)}>{status.label}</span>
                <span className="text-subtle tabular-nums">
                  {percent}% · {s.attempts}×
                </span>
              </div>
            </motion.button>
          </motion.li>
        )
      })}
    </ul>
    <p className="mt-3 text-xs text-subtle">
      The first number is how often the sound came out clean; the second is how many times you have tried it. Weakest first.
    </p>
    </>
  )
}
