import { useSoundName } from '@/lib/soundNames'
import { ArrowRightIcon, SparkleIcon, TargetIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { Pill, SectionLabel } from '@/components/common'
import { SpeakChip } from '@/components/tutor/SpeakButton'
import { Skeleton } from '@/components/ui/skeleton'
import { useAnalytics, useCoach } from '@/lib/queries'
import type { CoachRequest, CoachSlip, EvaluationResult } from '@/lib/types'
import { useSettings } from '@/store/settings'
import { SayItAlone, WorthCheckingList } from './WorthChecking'

const MAX_SLIPS = 8

/** The diagnosed problems of an attempt, in the compact form the coach explains. */
export function slipsOf(result: EvaluationResult): CoachSlip[] {
  const slips: CoachSlip[] = []
  for (const word of result.words) {
    const name = word.reference ?? word.spoken ?? ''
    if (!name) continue
    if (word.status === 'mispronounced' && word.confirmed !== 'fine') {
      const ops = word.alignment.filter((op) => op.op === 'replace' || op.op === 'delete')
      // The surest slips first: only "fix" slips get tips, "check" ones are listed to look at again.
      ops.sort((a, b) => Number(a.tier === 'check') - Number(b.tier === 'check'))
      if (ops.length === 0) slips.push({ word: name, kind: 'substitution', expected: '', actual: '', tier: 'fix' })
      for (const op of ops.slice(0, 2)) {
        slips.push({
          word: name,
          kind: op.op === 'delete' ? 'deletion' : 'substitution',
          expected: op.expected,
          actual: op.op === 'delete' ? '' : op.actual,
          tier: word.confirmed === 'slip' ? 'fix' : (op.tier ?? 'fix'),
          affects: word.affects_understanding ?? null,
        })
      }
    } else if (word.status === 'missing' || word.status === 'unclear' || word.status === 'extra') {
      slips.push({ word: name, kind: word.status, expected: '', actual: '' })
    }
  }
  return slips.slice(0, MAX_SLIPS)
}

export function CoachCard({
  result,
  previousScore,
  onSelect,
}: {
  result: EvaluationResult
  previousScore?: number
  /** Opens a word in the inspector. */
  onSelect?: (index: number) => void
}) {
  const username = useSettings((s) => s.username)
  const soundName = useSoundName()
  const nativeLanguage = useSettings((s) => s.nativeLanguage)
  const goal = useSettings((s) => s.goal)
  const tipLanguage = useSettings((s) => s.tipLanguage)
  const { data: analytics } = useAnalytics(username)

  const request = useMemo<CoachRequest | null>(() => {
    if (!result.transcription) return null
    return {
      target_text: result.reference_text,
      level: result.difficulty,
      score: result.score,
      slips: slipsOf(result),
      weak_sounds: (analytics?.top_weaknesses ?? []).slice(0, 5).map((w) => ({ phoneme: w.phoneme, count: w.count })),
      previous_score: previousScore ?? null,
      native_language: nativeLanguage,
      goal,
      tip_language: tipLanguage,
    }
  }, [result, analytics, previousScore, nativeLanguage, goal, tipLanguage])

  const { data, isLoading } = useCoach(request)
  if (!request) return null
  const hasFixSlips = request.slips.some((s) => s.tier !== 'check')

  return (
    <div className="surface results-item p-6 sm:p-8">
      <SectionLabel
        icon={<SparkleIcon weight="fill" />}
        action={data ? <Pill tone={data.source === 'groq' ? 'primary' : 'neutral'}>{data.source === 'groq' ? 'AI coach' : 'Tips'}</Pill> : undefined}
      >
        Your coach
      </SectionLabel>

      {isLoading || !data ? (
        <div className="space-y-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ) : (
        <div className="space-y-4">
          <p dir="auto" className="text-[17px] leading-relaxed font-medium">
            {data.summary}
          </p>
          {data.language_note && <p className="text-[13px] text-subtle">{data.language_note}</p>}
          {data.one_thing && (
            <div className="flex gap-3 rounded-2xl border border-primary/25 bg-primary-soft p-4">
              <TargetIcon size={22} weight="fill" className="mt-0.5 shrink-0 text-primary" />
              <div>
                <div className="text-xs font-semibold text-primary">Change this on your next try</div>
                <div dir="auto" className="mt-0.5 text-[15px] leading-relaxed font-medium">
                  {data.one_thing}
                </div>
              </div>
            </div>
          )}
          <WorthCheckingList
            words={result.words}
            onSelect={onSelect}
            action={(word) => <SayItAlone word={word} recordId={result.record_id} compact onDone={() => onSelect?.(word.index)} />}
          />
          {data.tips.length > 0 && (
            <ul className="space-y-3">
              {data.tips.map((tip, i) => (
                <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-muted-foreground">
                  {tip.phoneme && (
                    <span className="mt-0.5 shrink-0 font-semibold text-foreground" title={tip.phoneme}>
                      {soundName(tip.phoneme).spelled}
                    </span>
                  )}
                  <span dir="auto">
                    {tip.word && <span className="font-medium text-foreground">{tip.word}: </span>}
                    {tip.tip}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!!data.minor?.length && (
            <p className="rounded-2xl bg-fill p-4 text-[14px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Won’t confuse a listener: </span>
              {data.minor.map((w) => `“${w}”`).join(', ')}. These differ a little from the standard sound. Your goal is to be
              understood, so they come last. Switch to “Reduce my accent” in Settings to work on them too.
            </p>
          )}
          {hasFixSlips && (
            <Link to="/coach" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-primary hover:underline">
              Work on this with a guided session <ArrowRightIcon size={14} weight="bold" />
            </Link>
          )}
          {data.practice_sentence && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-fill p-4">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-subtle">Try this next</div>
                <div className="text-[15px] font-medium">{data.practice_sentence}</div>
              </div>
              <SpeakChip text={data.practice_sentence} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
