import { ArrowDownRightIcon, ArrowUpRightIcon, CheckCircleIcon, EarIcon, GaugeIcon, type Icon, MinusIcon, SparkleIcon, WaveformIcon } from '@phosphor-icons/react'
import { Pill, Tip } from '@/components/common'
import { ActivityRings, CountUp } from '@/components/ui/score-ring'
import type { EvaluationResult, MetricKey } from '@/lib/types'
import { METRIC_META, cn, scoreLabel, scoreTone, toneText } from '@/lib/utils'

const RINGS: { key: MetricKey; from: string; to: string; color: string; Icon: Icon }[] = [
  { key: 'pronunciation', from: 'var(--ring-move-a)', to: 'var(--ring-move-b)', color: '#fa114f', Icon: WaveformIcon },
  { key: 'fluency', from: 'var(--ring-exercise-a)', to: 'var(--ring-exercise-b)', color: '#6fd12b', Icon: GaugeIcon },
  { key: 'clarity', from: 'var(--ring-stand-a)', to: 'var(--ring-stand-b)', color: '#00b8d9', Icon: SparkleIcon },
]

/** A small tinted tile holding the metric's icon, in the same colour as its ring. */
export function MetricIcon({ Icon: IconComp, color }: { Icon: Icon; color: string }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-[10px]" style={{ color, backgroundColor: `${color}22` }}>
      <IconComp size={17} weight="fill" />
    </span>
  )
}

function MetricRow({ label, hint, value, color, Icon: IconComp }: { label: string; hint: string; value: number | null; color: string; Icon: Icon }) {
  return (
    <Tip content={hint} side="left">
      <div className="flex items-center gap-3 py-2.5">
        <MetricIcon Icon={IconComp} color={color} />
        <span className="flex-1 text-[15px] text-muted-foreground">{label}</span>
        <span className="text-[17px] font-semibold tabular-nums">
          {value == null ? <span className="text-subtle">—</span> : <CountUp value={value} />}
        </span>
      </div>
    </Tip>
  )
}

/** The headline "would a listener understand you?" estimate, shown apart from the score. */
function Understood({ value }: { value: NonNullable<EvaluationResult['intelligibility']> }) {
  const pct = Math.round(value.score)
  const tone = pct >= 90 ? 'good' : pct >= 70 ? 'warn' : 'bad'
  return (
    <Tip
      content="A speech recogniser that was not told the sentence heard these words. It stands in for a listener hearing you cold; it is not part of your score and has not been checked against real listeners."
      side="bottom"
    >
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-fill px-4 py-3">
        <EarIcon size={22} weight="fill" className="shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-muted-foreground">Would a listener understand you?</div>
          <div className="text-[15px]">
            <span className={cn('font-semibold', toneText[tone])}>
              {pct >= 90 ? 'Very likely' : pct >= 70 ? 'Mostly' : 'Often not'}
            </span>
            <span className="text-muted-foreground">
              {' '}
              · {value.recovered} of {value.words} words came through ({pct}%)
            </span>
          </div>
        </div>
        <Pill tone="neutral" className="h-6 text-[11px]">
          machine estimate
        </Pill>
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

        {result.intelligibility && result.intelligibility.words > 0 && <Understood value={result.intelligibility} />}

        <div className="mt-5 divide-y divide-border border-t border-border">
          {RINGS.map((r) => (
            <MetricRow key={r.key} label={METRIC_META[r.key].label} hint={METRIC_META[r.key].hint} value={metrics[r.key]} color={r.color} Icon={r.Icon} />
          ))}
          <Tip content={METRIC_META.completeness.hint} side="left">
            <div className="flex items-center gap-3 py-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-fill text-muted-foreground">
                <CheckCircleIcon size={17} weight="fill" />
              </span>
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
