import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from '@phosphor-icons/react'
import { Pill, Tip } from '@/components/common'
import { ActivityRings, CountUp } from '@/components/ui/score-ring'
import type { EvaluationResult, MetricKey } from '@/lib/types'
import { METRIC_META, cn, scoreLabel, scoreTone, toneText } from '@/lib/utils'

const RINGS: { key: MetricKey; from: string; to: string; dot: string }[] = [
  { key: 'pronunciation', from: 'var(--ring-move-a)', to: 'var(--ring-move-b)', dot: 'bg-[#fa114f]' },
  { key: 'fluency', from: 'var(--ring-exercise-a)', to: 'var(--ring-exercise-b)', dot: 'bg-[#92e82a]' },
  { key: 'clarity', from: 'var(--ring-stand-a)', to: 'var(--ring-stand-b)', dot: 'bg-[#1eeaef]' },
]

function MetricRow({ label, hint, value, dot }: { label: string; hint: string; value: number | null; dot: string }) {
  return (
    <Tip content={hint} side="left">
      <div className="flex items-center gap-3 py-2.5">
        <span className={cn('size-2.5 shrink-0 rounded-full', dot)} />
        <span className="flex-1 text-[15px] text-muted-foreground">{label}</span>
        <span className="text-[17px] font-semibold tabular-nums">
          {value == null ? <span className="text-subtle">—</span> : <CountUp value={value} />}
        </span>
      </div>
    </Tip>
  )
}

export function ScoreSummary({ result, previous }: { result: EvaluationResult; previous?: number }) {
  const { metrics, score } = result
  const tone = scoreTone(score)
  const delta = previous != null ? Math.round(score - previous) : null
  const correctWords = result.words.filter((w) => w.reference && (w.status === 'correct' || w.status === 'unclear')).length
  const totalWords = result.words.filter((w) => w.reference).length

  return (
    <div className="surface results-item grid gap-8 p-6 sm:p-8 md:grid-cols-[auto_1fr] md:items-center md:gap-12">
      <div className="relative mx-auto grid place-items-center">
        <ActivityRings
          size={208}
          stroke={22}
          gap={3}
          rings={RINGS.map((r) => ({ value: metrics[r.key], from: r.from, to: r.to }))}
        />
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-muted-foreground">Overall</span>
          <Pill tone={tone === 'muted' ? 'neutral' : tone}>{scoreLabel(score)}</Pill>
          {delta != null && (
            <Pill tone={delta > 0 ? 'good' : delta < 0 ? 'bad' : 'neutral'}>
              {delta > 0 ? <ArrowUpRightIcon weight="bold" /> : delta < 0 ? <ArrowDownRightIcon weight="bold" /> : <MinusIcon weight="bold" />}
              {delta > 0 ? `+${delta}` : delta} vs last try
            </Pill>
          )}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className={cn('headline text-[76px] leading-none sm:text-[88px]', toneText[tone])}>
            <CountUp value={score} />
          </span>
          <span className="text-xl font-medium text-subtle">/100</span>
        </div>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted-foreground">{result.feedback}</p>

        <div className="mt-5 divide-y divide-border border-t border-border">
          {RINGS.map((r) => (
            <MetricRow key={r.key} label={METRIC_META[r.key].label} hint={METRIC_META[r.key].hint} value={metrics[r.key]} dot={r.dot} />
          ))}
          <Tip content={METRIC_META.completeness.hint} side="left">
            <div className="flex items-center gap-3 py-2.5">
              <span className="size-2.5 shrink-0 rounded-full bg-subtle" />
              <span className="flex-1 text-[15px] text-muted-foreground">Words correct</span>
              <span className="text-[17px] font-semibold tabular-nums">
                {correctWords}
                <span className="text-subtle">/{totalWords}</span>
              </span>
            </div>
          </Tip>
        </div>
      </div>
    </div>
  )
}
