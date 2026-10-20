import {
  ArrowBendDownRightIcon,
  ArrowCircleUpRightIcon,
  CheckCircleIcon,
  ClockIcon,
  GaugeIcon,
  MicrophoneIcon,
  SparkleIcon,
  WaveformIcon,
  XCircleIcon,
} from '@phosphor-icons/react'
import { Pill, SectionLabel } from '@/components/common'
import { ListenLong } from '@/components/interview/ListenLong'
import { speakable } from '@/lib/interviewer'
import { useSoundName } from '@/lib/soundNames'
import type {
  ContentKey,
  InterviewAnswerResult,
  InterviewCheck,
  InterviewQuestion,
  InterviewRubric,
  StoredInterviewAnswer,
} from '@/lib/types'
import { cn, formatDuration } from '@/lib/utils'
import { useUI } from '@/store/ui'

interface Delivery {
  wpm: number | null
  duration: number | null
  long_pauses: number
  longest_pause: number | null
  fillers: { count: number; words: string[] }
}

interface Slip {
  word: string
  expected: string
  actual: string
  changes_word: string | null
}

/** One answer as feedback needs it, whether it was just given or comes from a saved interview. */
export interface AnswerView {
  question: InterviewQuestion
  transcript: string
  delivery: Delivery
  checks: InterviewCheck[]
  rubric: InterviewRubric | null
  slips: Slip[]
  followUp: { text: string; transcript: string; checks: InterviewCheck[]; delivery: Delivery } | null
}

export function viewFromResult(result: InterviewAnswerResult, followUp?: InterviewAnswerResult | null): AnswerView {
  return {
    question: result.question,
    transcript: result.words.length ? result.words.map((w) => w.display).join(' ') : result.transcription,
    delivery: result.delivery!,
    checks: result.checks,
    rubric: result.rubric,
    slips: result.slips,
    followUp:
      followUp?.delivery
        ? { text: followUp.question.text, transcript: followUp.transcription, checks: followUp.checks, delivery: followUp.delivery }
        : null,
  }
}

export function viewFromStored(question: InterviewQuestion, stored: StoredInterviewAnswer): AnswerView {
  const follow = stored.follow_up
  return {
    question,
    transcript: stored.transcript,
    delivery: stored.delivery,
    checks: stored.checks,
    rubric: stored.rubric,
    slips: stored.slips,
    followUp: follow ? { text: follow.text, transcript: follow.transcript, checks: follow.checks, delivery: follow.delivery } : null,
  }
}

export const CONTENT_LABELS: Record<ContentKey, string> = {
  relevance: 'Answers the question',
  structure: 'Clear structure',
  specificity: 'Specific details',
  clarity: 'Easy to follow',
}

/** One sentence that sums the answer up: the model's, or the checks' own count. */
export function verdict(view: AnswerView): string {
  if (view.rubric?.summary) return view.rubric.summary
  const passed = view.checks.filter((c) => c.ok).length
  if (passed === view.checks.length) return 'A solid answer: it did everything the checks look for.'
  return `${passed} of ${view.checks.length} checks passed. The fixes below make the biggest difference.`
}

function unique(items: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  return items.filter((item): item is string => {
    if (!item || seen.has(item)) return false
    seen.add(item)
    return true
  })
}

export function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 text-[14px]">
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill" aria-hidden>
        <span
          className={cn('block h-full rounded-full', value >= 4 ? 'bg-good' : value >= 3 ? 'bg-primary' : 'bg-warn')}
          style={{ width: `${(value / 5) * 100}%` }}
        />
      </span>
      <span className="w-9 text-right font-semibold tabular-nums">
        {value}
        <span className="text-[12px] font-normal text-subtle">/5</span>
      </span>
    </div>
  )
}

function Stat({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint: string; tone?: 'warn' }) {
  return (
    <div className="rounded-2xl bg-fill p-3.5">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground [&_svg]:size-3.5 [&_svg]:text-primary">
        {icon}
        {label}
      </div>
      <div className={cn('mt-1 text-[20px] font-semibold tabular-nums', tone === 'warn' && 'text-warn')}>{value}</div>
      <div className="text-[12px] leading-snug text-subtle">{hint}</div>
    </div>
  )
}

/** The clearer version of the answer; [placeholders] stand out as gaps the learner fills. */
function ClearerAnswer({ text, id }: { text: string; id: string }) {
  const parts = text.split(/(\[[^\]]+\])/g)
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary-soft/60 p-4 sm:p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-primary">
          <SparkleIcon weight="fill" /> A clearer version of your answer
        </div>
        <ListenLong text={speakable(text)} speakKey={`clearer:${id}`} label="Listen" />
      </div>
      <p className="text-[16px] leading-relaxed">
        {parts.map((part, i) =>
          part.startsWith('[') ? (
            <span key={i} className="rounded-md bg-warn-soft px-1 font-medium text-warn">
              {part.slice(1, -1)}
            </span>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>
      <p className="mt-2 text-[12px] text-muted-foreground">Built only from what you said. The highlighted gaps are yours to fill in.</p>
    </div>
  )
}

/** Everything about one answer: what to change, what worked, content, delivery and sounds. */
export function AnswerFeedback({ view, compact = false }: { view: AnswerView; compact?: boolean }) {
  const soundName = useSoundName()
  const openPhoneme = useUI((s) => s.openPhoneme)
  const { rubric, delivery, checks, question } = view
  const [low, high] = question.target_seconds
  const seconds = delivery.duration ?? 0
  const workOn = unique([...(rubric?.improvements ?? []), ...checks.filter((c) => !c.ok).map((c) => c.fix)]).slice(0, 4)
  const wentWell = unique([...(rubric?.strengths ?? []), ...checks.filter((c) => c.ok).map((c) => c.label.replace(/ \(.*\)$/, ''))]).slice(0, 4)
  const minutes = Math.max(seconds / 60, 0.5)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-[17px] leading-relaxed font-medium">{verdict(view)}</p>
        <Pill tone={rubric ? 'primary' : 'neutral'}>{rubric ? <><SparkleIcon weight="fill" /> AI feedback</> : 'Quick checks'}</Pill>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {workOn.length > 0 && (
          <div>
            <SectionLabel icon={<ArrowCircleUpRightIcon weight="fill" />} className="mb-2.5">
              Work on
            </SectionLabel>
            <ul className="space-y-2.5">
              {workOn.map((tip) => (
                <li key={tip} className="flex gap-2.5 text-[15px] leading-snug">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}
        {wentWell.length > 0 && (
          <div>
            <SectionLabel icon={<CheckCircleIcon weight="fill" />} className="mb-2.5">
              Went well
            </SectionLabel>
            <ul className="space-y-2.5">
              {wentWell.map((item) => (
                <li key={item} className="flex gap-2.5 text-[15px] leading-snug">
                  <CheckCircleIcon size={18} weight="fill" className="mt-px shrink-0 text-good" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {rubric && (
        <div className="space-y-2.5">
          {(Object.keys(CONTENT_LABELS) as ContentKey[]).map((key) => (
            <ScoreBar key={key} label={CONTENT_LABELS[key]} value={rubric.scores[key]} />
          ))}
          {rubric.star && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[12px] font-semibold">
              <span className="mr-1 text-[13px] font-medium text-muted-foreground">Story</span>
              {(['situation', 'task', 'action', 'result'] as const).map((part) => (
                <span
                  key={part}
                  className={cn(
                    'flex items-center gap-1 rounded-full px-2.5 py-1 capitalize',
                    rubric.star![part] ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad',
                  )}
                >
                  {rubric.star![part] ? <CheckCircleIcon weight="fill" /> : <XCircleIcon weight="fill" />} {part}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {view.followUp && (
        <div className="rounded-2xl bg-fill p-4">
          <div className="flex items-start gap-2 text-[14px] font-semibold">
            <ArrowBendDownRightIcon size={18} className="mt-px shrink-0 text-primary" /> Follow-up: “{view.followUp.text}”
          </div>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{view.followUp.transcript}</p>
          {view.followUp.checks.map((c) => (
            <p key={c.id} className={cn('mt-2 flex items-center gap-1.5 text-[13px] font-medium', c.ok ? 'text-good' : 'text-warn')}>
              {c.ok ? <CheckCircleIcon weight="fill" /> : <ArrowCircleUpRightIcon weight="fill" />} {c.ok ? c.label : c.fix}
            </p>
          ))}
        </div>
      )}

      {rubric?.stronger_answer && <ClearerAnswer text={rubric.stronger_answer} id={question.id} />}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat
          icon={<ClockIcon weight="fill" />}
          label="Length"
          value={formatDuration(seconds)}
          hint={`aim for ${formatDuration(low)}–${formatDuration(high)}`}
          tone={seconds < low * 0.6 || seconds > high * 1.4 ? 'warn' : undefined}
        />
        <Stat icon={<GaugeIcon weight="fill" />} label="Pace" value={delivery.wpm ?? '—'} hint="words a minute (aim 120–160)" />
        <Stat
          icon={<WaveformIcon weight="fill" />}
          label="Fillers"
          value={<>≈{delivery.fillers.count}</>}
          hint={`${(delivery.fillers.count / minutes).toFixed(1)} a minute · approximate`}
        />
        <Stat
          icon={<MicrophoneIcon weight="fill" />}
          label="Long pauses"
          value={delivery.long_pauses}
          hint={delivery.longest_pause ? `longest ${delivery.longest_pause.toFixed(1)} s` : 'over 1 second'}
        />
      </div>

      {view.slips.length > 0 && (
        <div>
          <SectionLabel icon={<WaveformIcon weight="fill" />} className="mb-2.5">
            Sounds that slipped
          </SectionLabel>
          <ul className="flex flex-wrap gap-2">
            {view.slips.map((s, i) => (
              <li key={`${s.word}-${s.expected}-${i}`}>
                <button
                  type="button"
                  onClick={() => openPhoneme(s.expected)}
                  className="rounded-full bg-bad-soft px-3 py-1.5 text-left text-[13px] text-bad transition-[filter] hover:brightness-110 active:scale-[0.97]"
                >
                  <b>{s.word}</b>: {soundName(s.expected).spelled} as{' '}
                  {s.actual && s.actual !== '?' ? soundName(s.actual).spelled : 'something unclear'}
                  {s.changes_word ? ` (sounded like “${s.changes_word}”)` : ''}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && (
        <details className="group rounded-2xl bg-fill px-4 py-3">
          <summary className="cursor-pointer text-[14px] font-medium text-muted-foreground select-none">What you said</summary>
          <p className="mt-2 text-[15px] leading-relaxed">{view.transcript}</p>
        </details>
      )}
    </div>
  )
}
