import { ArrowRightIcon, TargetIcon } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { Link } from 'react-router'
import { Panel, SectionLabel } from '@/components/common'
import { Button } from '@/components/ui/button'
import { describeSound, STATUS_WORDS } from '@/lib/plain'
import type { SoundMastery } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useUI } from '@/store/ui'

/** The few sounds worth your time right now, with one button to start. */
export function FocusSounds({ sounds }: { sounds: SoundMastery[] }) {
  const openPhoneme = useUI((s) => s.openPhoneme)
  const reduce = useReducedMotion()
  const focus = sounds.filter((s) => s.status !== 'solid').slice(0, 3)
  if (focus.length === 0) {
    return (
      <Panel className="progress-item p-6 sm:p-8">
        <SectionLabel icon={<TargetIcon weight="fill" />}>What to practise next</SectionLabel>
        <p className="text-[15px] text-muted-foreground">Every sound you have tried is going well. Try a harder phrase to keep growing.</p>
      </Panel>
    )
  }
  return (
    <Panel className="progress-item p-6 sm:p-8">
      <SectionLabel
        icon={<TargetIcon weight="fill" />}
        action={
          <Button asChild size="sm">
            <Link to="/coach">
              Practise with your coach <ArrowRightIcon weight="bold" />
            </Link>
          </Button>
        }
      >
        What to practise next
      </SectionLabel>
      <ul className="grid gap-3 sm:grid-cols-3">
        {focus.map((sound, index) => {
          const { spelled, word } = describeSound(sound)
          const percent = Math.floor(sound.clean_rate * 100 + 1e-9)
          return (
            <motion.li
              key={sound.phoneme}
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.07, type: 'spring', stiffness: 300, damping: 26 }}
            >
              <button
                type="button"
                onClick={() => openPhoneme(sound.phoneme)}
                className="flex h-full w-full flex-col gap-3 rounded-2xl bg-fill p-4 text-left transition-colors hover:bg-fill-strong"
              >
                <div>
                  <div className="headline text-[26px] leading-none">{word || spelled}</div>
                  <div className="mt-1 text-[13px] text-muted-foreground">
                    the <b className="font-semibold text-foreground">{spelled}</b> sound
                  </div>
                </div>
                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-background/60">
                    <motion.div
                      className={cn('h-full rounded-full', sound.status === 'needs_work' ? 'bg-bad' : 'bg-warn')}
                      initial={reduce ? false : { width: 0 }}
                      animate={{ width: `${percent}%` }}
                      transition={{ delay: 0.2 + index * 0.07, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[13px]">
                    <span className="text-muted-foreground">Right {percent}% of the time</span>
                    <span className="font-medium">{STATUS_WORDS[sound.status]}</span>
                  </div>
                </div>
              </button>
            </motion.li>
          )
        })}
      </ul>
    </Panel>
  )
}
