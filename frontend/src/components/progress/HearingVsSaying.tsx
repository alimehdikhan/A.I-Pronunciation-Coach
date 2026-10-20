import { ArrowRightIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import { useSoundName } from '@/lib/soundNames'
import type { PerceptionStat, SoundMastery } from '@/lib/types'
import { cn } from '@/lib/utils'

function Bar({ value, label }: { value: number | null; label: string }) {
  const pct = value == null ? null : Math.floor(value * 100 + 1e-9)
  return (
    <div className="min-w-0 flex-1">
      <div className="flex justify-between text-[12px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{pct == null ? 'not yet' : `${pct}%`}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-fill">
        <div
          className={cn('h-full rounded-full', pct == null ? '' : pct >= 80 ? 'bg-good' : pct >= 60 ? 'bg-warn' : 'bg-bad')}
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
    </div>
  )
}

/**
 * Per contrast: how often the learner heard it right in listening drills, next to how often they
 * say the sound cleanly. The two are tracked separately: a low "hearing" score explains a stuck
 * "saying" score, and is trained first.
 */
export function HearingVsSaying({ perception, mastery }: { perception: PerceptionStat[]; mastery: SoundMastery[] }) {
  const soundName = useSoundName()
  const saying = new Map(mastery.map((m) => [m.phoneme, m.clean_rate]))
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {perception.map((p) => (
          <li key={p.phoneme + p.other} className="rounded-2xl bg-fill/60 p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="text-[15px] font-semibold">
                {soundName(p.phoneme).spelled} vs {soundName(p.other).spelled}
              </span>
              <span className="text-[12px] text-subtle">{p.trials} listening trials</span>
            </div>
            <div className="flex gap-4">
              <Bar value={p.accuracy} label="Hearing" />
              <Bar value={saying.get(p.phoneme) ?? null} label="Saying" />
            </div>
          </li>
        ))}
      </ul>
      <Link to="/drills?mode=listen" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-primary hover:underline">
        Train your ear <ArrowRightIcon size={14} weight="bold" />
      </Link>
    </div>
  )
}
