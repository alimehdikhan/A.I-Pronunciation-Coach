import { ArrowRightIcon, SparkleIcon, TargetIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { Pill, SectionLabel } from '@/components/common'
import { SpeakChip } from '@/components/tutor/SpeakButton'
import { Skeleton } from '@/components/ui/skeleton'
import { useAnalytics, useCoach } from '@/lib/queries'
import type { CoachRequest, CoachSlip, EvaluationResult } from '@/lib/types'
import { useSettings } from '@/store/settings'

const MAX_SLIPS = 8

/** The diagnosed problems of an attempt, in the compact form the coach explains. */
export function slipsOf(result: EvaluationResult): CoachSlip[] {
  const slips: CoachSlip[] = []
  for (const word of result.words) {
    const name = word.reference ?? word.spoken ?? ''
    if (!name) continue
    if (word.status === 'mispronounced') {
      const ops = word.alignment.filter((op) => op.op === 'replace' || op.op === 'delete')
      if (ops.length === 0) slips.push({ word: name, kind: 'substitution', expected: '', actual: '' })
      for (const op of ops.slice(0, 2)) {
        slips.push({
          word: name,
          kind: op.op === 'delete' ? 'deletion' : 'substitution',
          expected: op.expected,
          actual: op.op === 'delete' ? '' : op.actual,
        })
      }
    } else if (word.status === 'missing' || word.status === 'unclear' || word.status === 'extra') {
      slips.push({ word: name, kind: word.status, expected: '', actual: '' })
    }
  }
  return slips.slice(0, MAX_SLIPS)
}

export function CoachCard({ result, previousScore }: { result: EvaluationResult; previousScore?: number }) {
  const username = useSettings((s) => s.username)
  const nativeLanguage = useSettings((s) => s.nativeLanguage)
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
    }
  }, [result, analytics, previousScore, nativeLanguage])

  const { data, isLoading } = useCoach(request)
  if (!request) return null

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
          <p className="text-[17px] leading-relaxed font-medium">{data.summary}</p>
          {data.one_thing && (
            <div className="flex gap-3 rounded-2xl border border-primary/25 bg-primary-soft p-4">
              <TargetIcon size={22} weight="fill" className="mt-0.5 shrink-0 text-primary" />
              <div>
                <div className="text-xs font-semibold text-primary">Change this on your next try</div>
                <div className="mt-0.5 text-[15px] leading-relaxed font-medium">{data.one_thing}</div>
              </div>
            </div>
          )}
          {data.tips.length > 0 && (
            <ul className="space-y-3">
              {data.tips.map((tip, i) => (
                <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-muted-foreground">
                  {tip.phoneme && <span className="ipa mt-0.5 shrink-0 font-semibold text-foreground">/{tip.phoneme}/</span>}
                  <span>
                    {tip.word && <span className="font-medium text-foreground">{tip.word}: </span>}
                    {tip.tip}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {request.slips.length > 0 && (
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
