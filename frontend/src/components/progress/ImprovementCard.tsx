import { TrendDownIcon, TrendUpIcon } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { Panel } from '@/components/common'
import { cn } from '@/lib/utils'
import type { Analytics } from '@/lib/types'

/** One sentence that answers "am I getting better?", from the first attempts against the latest. */
export function ImprovementCard({ improvement }: { improvement: NonNullable<Analytics['improvement']> }) {
  const change = Math.round(improvement.change)
  const up = change > 0
  const flat = change === 0
  const Icon = up || flat ? TrendUpIcon : TrendDownIcon
  const reduce = useReducedMotion()
  return (
    <Panel className="progress-item flex items-center gap-4 p-5 sm:p-6">
      <motion.div
        initial={reduce ? false : { scale: 0.4, rotate: -20, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 16, delay: 0.15 }}
        className={cn('grid size-12 shrink-0 place-items-center rounded-2xl', up ? 'bg-good-soft text-good' : flat ? 'bg-fill text-muted-foreground' : 'bg-warn-soft text-warn')}
      >
        <Icon size={24} weight="bold" />
      </motion.div>
      <div className="min-w-0">
        <div className="headline text-[20px]">
          {up && <>Up {change} points since you started</>}
          {flat && <>Holding steady since you started</>}
          {!up && !flat && <>Down {Math.abs(change)} points lately</>}
        </div>
        <p className="mt-0.5 text-[14px] text-muted-foreground">
          Your first {improvement.attempts} attempts averaged {Math.round(improvement.first_average)}; your latest{' '}
          {improvement.attempts} average {Math.round(improvement.recent_average)}.
          {!up && !flat && ' A harder phrase or a tired day can do that. The sounds below show where to look.'}
        </p>
      </div>
    </Panel>
  )
}
