import {
  ArrowsInLineHorizontalIcon,
  CheckCircleIcon,
  ClockIcon,
  EyeSlashIcon,
  GaugeIcon,
  PlusCircleIcon,
  SealCheckIcon,
  SpeakerSlashIcon,
  WarningCircleIcon,
  type Icon,
} from '@phosphor-icons/react'
import { SectionLabel } from '@/components/common'
import type { Insight } from '@/lib/types'
import { cn } from '@/lib/utils'

const KIND_ICON: Record<Insight['kind'], Icon> = {
  substitution: ArrowsInLineHorizontalIcon,
  deletion: SpeakerSlashIcon,
  insertion: PlusCircleIcon,
  word: WarningCircleIcon,
  missing: EyeSlashIcon,
  unclear: WarningCircleIcon,
  extra: PlusCircleIcon,
  pause: ClockIcon,
  pace: GaugeIcon,
  praise: SealCheckIcon,
}

const SEVERITY: Record<Insight['severity'], string> = {
  high: 'bg-bad text-white',
  medium: 'bg-[#ff9500] text-white',
  low: 'bg-[#8e8e93] text-white',
  positive: 'bg-good text-white',
}

export function InsightsPanel({ insights, onSelect }: { insights: Insight[]; onSelect: (index: number) => void }) {
  return (
    <div className="surface results-item p-6 sm:p-8">
      <SectionLabel>Coach notes</SectionLabel>
      {insights.length === 0 ? (
        <div className="flex items-center gap-3 text-[15px] text-muted-foreground">
          <CheckCircleIcon size={22} weight="fill" className="text-good" /> Nothing to flag. Great job.
        </div>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {insights.map((insight, i) => {
            const IconComp = KIND_ICON[insight.kind]
            const clickable = insight.word_index != null
            return (
              <li key={i}>
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && onSelect(insight.word_index!)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl p-2 text-left transition-colors',
                    clickable && 'hover:bg-fill',
                  )}
                >
                  <span className={cn('grid size-7 shrink-0 place-items-center rounded-[8px]', SEVERITY[insight.severity])}>
                    <IconComp size={16} weight="bold" />
                  </span>
                  <span className="pt-0.5 text-[14px] leading-snug">{insight.title}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
