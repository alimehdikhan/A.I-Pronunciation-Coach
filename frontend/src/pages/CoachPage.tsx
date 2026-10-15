import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  LockKeyIcon,
  MicrophoneIcon,
  QuestionIcon,
  SparkleIcon,
  StopIcon,
  TrendDownIcon,
  TrendUpIcon,
  XCircleIcon,
} from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { EmptyState, Pill, SectionLabel } from '@/components/common'
import { PageHeader } from '@/components/layout/AppShell'
import { SignInActions } from '@/components/auth/SignInGate'
import { SpeakChip } from '@/components/tutor/SpeakButton'
import { useSpeaker } from '@/lib/speech'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useRecorder, type Recording } from '@/hooks/useRecorder'
import { api, ApiError } from '@/lib/api'
import { keys, useCoachPlan } from '@/lib/queries'
import type { CoachPlan, EvaluationResult, SessionStep, SoundMastery } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'

// ---- outcomes ---------------------------------------------------------------

interface Outcome {
  /** true: the focus sound was clean; false: it slipped; null: it could not be judged (word not heard). */
  ok: boolean | null
  heard: string
  /** What the sound turned into, when it slipped. */
  became: string | null
}

/** Was the focus sound clean in this recording? */
function focusOutcome(result: EvaluationResult, phoneme: string): Outcome {
  const heard = result.transcription.trim()
  const detailed = result.words.flatMap((w) => (w.phonemes ?? []).filter((p) => p.phoneme === phoneme))
  if (detailed.length) {
    const bad = detailed.find((p) => p.flagged)
    return { ok: !bad, heard, became: bad?.alternative ?? null }
  }
  const ops = result.words.flatMap((w) => w.alignment.filter((op) => op.expected === phoneme && op.op !== 'insert'))
  if (ops.length) {
    const bad = ops.find((op) => op.op !== 'equal')
    return { ok: !bad, heard, became: bad ? bad.actual || null : null }
  }
  return { ok: null, heard, became: null }
}

function verdict(before: number | null, rate: number): 'baseline' | 'better' | 'worse' | 'same' {
  if (before === null) return 'baseline'
  if (rate >= before + 0.15) return 'better'
  if (rate <= before - 0.15) return 'worse'
  return 'same'
}

// ---- small pieces -----------------------------------------------------------

const TREND = {
  improving: { icon: <TrendUpIcon weight="bold" />, label: 'Improving', tone: 'good' as const },
  slipping: { icon: <TrendDownIcon weight="bold" />, label: 'Slipping', tone: 'bad' as const },
  steady: { icon: null, label: 'Steady', tone: 'neutral' as const },
  new: { icon: null, label: 'New', tone: 'neutral' as const },
}

function SoundChip({ sound }: { sound: SoundMastery }) {
  const pct = Math.round(sound.clean_rate * 100)
  const tone =
    sound.status === 'solid' ? 'bg-good-soft text-good' : sound.status === 'needs_work' ? 'bg-bad-soft text-bad' : 'bg-fill text-foreground'
  return (
    <div className={cn('flex min-w-[88px] flex-col items-center rounded-2xl px-3 py-2.5', tone)}>
      <span className="ipa text-[22px] leading-none font-semibold">{sound.phoneme}</span>
      <span className="mt-1.5 text-[13px] font-semibold tabular-nums">{sound.status === 'new' ? 'new' : `${pct}%`}</span>
      <span className="text-[11px] opacity-70">
        {sound.clean}/{sound.attempts} clean
      </span>
    </div>
  )
}

/** Records one word or sentence and reports whether the focus sound was clean. */
function Practiser({
  text,
  phoneme,
  username,
  level,
  maxSeconds,
  previous,
  onOutcome,
}: {
  text: string
  phoneme: string
  username: string
  level: 'beginner' | 'intermediate' | 'advanced'
  maxSeconds: number
  previous?: Outcome
  onOutcome: (outcome: Outcome) => void
}) {
  const queryClient = useQueryClient()
  const evaluate = useMutation({
    mutationFn: api.evaluateRecording,
    meta: { silent: true },
    onSuccess: ({ result }) => {
      onOutcome(focusOutcome(result, phoneme))
      void queryClient.invalidateQueries({ queryKey: keys.analytics(username) })
      void queryClient.invalidateQueries({ queryKey: keys.history(username) })
    },
  })
  const onRecorded = useCallback(
    ({ blob, filename }: Recording) => evaluate.mutate({ audio: blob, filename, text, difficulty: level, username }),
    [evaluate, level, text, username],
  )
  const recorder = useRecorder({ maxSeconds, minSeconds: 0.3, onRecorded, onError: (m) => toast.error(m) })
  const recording = recorder.state === 'recording'
  const busy = evaluate.isPending || recorder.state === 'requesting'

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-fill p-3.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => recorder.toggle()}
        aria-label={recording ? 'Stop recording' : `Record “${text}”`}
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-full text-white transition-transform active:scale-95 disabled:opacity-50',
          recording ? 'bg-[#ff3b30]' : 'bg-primary',
        )}
      >
        {recording ? <StopIcon size={18} weight="fill" /> : <MicrophoneIcon size={20} weight="fill" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-semibold">{text}</div>
        <div className="text-xs text-muted-foreground">
          {recording
            ? 'Listening… tap to stop'
            : evaluate.isPending
              ? 'Checking the sound…'
              : evaluate.error
                ? evaluate.error instanceof ApiError
                  ? evaluate.error.message
                  : 'Something went wrong. Try again.'
                : previous
                  ? previous.heard
                    ? `Heard “${previous.heard}”`
                    : 'Nothing heard'
                  : 'Tap the mic and say it'}
        </div>
      </div>

      {previous && !busy && !recording && (
        <span className="flex items-center gap-1.5 text-[13px] font-semibold">
          {previous.ok === true && (
            <>
              <CheckCircleIcon size={20} weight="fill" className="text-good" /> <span className="text-good">Clean</span>
            </>
          )}
          {previous.ok === false && (
            <>
              <XCircleIcon size={20} weight="fill" className="text-bad" />
              <span className="text-bad">{previous.became ? `Came out as /${previous.became}/` : 'Slipped'}</span>
            </>
          )}
          {previous.ok === null && (
            <>
              <QuestionIcon size={20} weight="fill" className="text-warn" /> <span className="text-warn">Not heard clearly</span>
            </>
          )}
        </span>
      )}
      <SpeakChip text={text} rate={0.8}>
        Hear it
      </SpeakChip>
    </div>
  )
}

// ---- the session ----------------------------------------------------------------

function Session({ plan, username }: { plan: CoachPlan; username: string }) {
  const level = useSettings((s) => s.level)
  const [index, setIndex] = useState(0)
  const [results, setResults] = useState<Record<string, Outcome>>({})
  const step: SessionStep = plan.session[index]
  const focus = plan.focus
  const last = index === plan.session.length - 1
  const { prefetch } = useSpeaker()

  // The session knows every clip it will ask for. Fetch them now, in the order they are needed,
  // so each Listen press finds its audio ready instead of waiting for the voice to render it.
  useEffect(() => {
    plan.session.forEach((s) => (s.pairs ?? []).forEach((pair) => pair.forEach((word) => prefetch(word))))
    focus.words.forEach((word) => prefetch(word, 0.8))
    if (focus.sentence) prefetch(focus.sentence, 0.8)
  }, [plan, focus, prefetch])

  const record = (key: string) => (outcome: Outcome) => setResults((r) => ({ ...r, [key]: outcome }))

  const judged = Object.values(results).filter((o) => o.ok !== null)
  const clean = judged.filter((o) => o.ok).length
  const rate = judged.length ? clean / judged.length : 0
  const before = focus.stats && focus.stats.attempts >= 3 ? focus.stats.clean_rate : null

  return (
    <section className="surface p-6 sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <SectionLabel className="mb-0">Today&rsquo;s session</SectionLabel>
        <ol className="flex items-center gap-1.5" aria-label="Session progress">
          {plan.session.map((s, i) => (
            <li key={s.kind}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={s.title}
                aria-current={i === index}
                className={cn('h-2 rounded-full transition-all', i === index ? 'w-8 bg-primary' : i < index ? 'w-4 bg-primary/50' : 'w-4 bg-fill-strong')}
              />
            </li>
          ))}
        </ol>
      </div>

      <div className="mb-1 text-[13px] font-semibold text-primary">
        Step {index + 1} of {plan.session.length}
      </div>
      <h3 className="headline text-[28px]">{step.title}</h3>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{step.instruction}</p>

      <div className="mt-6 space-y-3">
        {step.kind === 'learn' && (
          <ol className="space-y-2.5">
            {(step.steps ?? []).map((line, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-white">
                  {i + 1}
                </span>
                {line}
              </li>
            ))}
            {(focus.why_wrong || focus.confused_with.length > 0) && (
              <li className="rounded-2xl bg-warn-soft p-4 text-[14px] leading-relaxed">
                {focus.why_wrong || (
                  <>
                    Learners often replace this sound with{' '}
                    <span className="ipa font-semibold">{focus.confused_with.map((c) => `/${c}/`).join(', ')}</span>.
                  </>
                )}
              </li>
            )}
          </ol>
        )}

        {step.kind === 'listen' &&
          (step.pairs ?? []).map(([a, b]) => (
            <div key={a + b} className="flex flex-wrap items-center gap-2">
              <SpeakChip text={a} tone="good">
                {a}
              </SpeakChip>
              <span className="text-xs text-subtle">not</span>
              <SpeakChip text={b}>{b}</SpeakChip>
            </div>
          ))}

        {step.kind === 'words' &&
          (step.words ?? []).map((word) => (
            <div key={word}>
              <Practiser
                text={word}
                phoneme={focus.phoneme}
                username={username}
                level={level}
                maxSeconds={5}
                previous={results[`w:${word}`]}
                onOutcome={record(`w:${word}`)}
              />
              {(step.your_words ?? []).includes(word) && (
                <div className="mt-1 ml-1 text-[11px] font-medium text-subtle">One of your tricky words</div>
              )}
            </div>
          ))}

        {step.kind === 'sentence' && step.sentence && (
          <Practiser
            text={step.sentence}
            phoneme={focus.phoneme}
            username={username}
            level={level}
            maxSeconds={14}
            previous={results.sentence}
            onOutcome={record('sentence')}
          />
        )}

        {step.kind === 'review' && (
          <div className="space-y-4">
            {judged.length === 0 ? (
              <p className="text-[15px] text-muted-foreground">
                You did not record anything this time. Go back to the word step and say a few, then come back for your review.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                  <div>
                    <div className="headline text-[44px] tabular-nums">
                      {clean}
                      <span className="text-[26px] text-muted-foreground">/{judged.length}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      times {focus.label || `/${focus.phoneme}/`} came out clean today
                    </div>
                  </div>
                  {before !== null && (
                    <div>
                      <div className="headline text-[44px] text-muted-foreground tabular-nums">{Math.round(before * 100)}%</div>
                      <div className="text-xs text-muted-foreground">your clean rate before today</div>
                    </div>
                  )}
                </div>
                <p className="rounded-2xl bg-fill p-4 text-[15px] leading-relaxed">
                  {
                    {
                      baseline: `That is your starting point for /${focus.phoneme}/: ${Math.round(rate * 100)}% clean. I will measure your next session against it.`,
                      better: `That is clearly better than before (${Math.round(rate * 100)}% against ${Math.round((before ?? 0) * 100)}%). Whatever you changed, keep it.`,
                      same: `About the same as your usual (${Math.round(rate * 100)}%). Go back to the mouth steps and exaggerate the movement on your next session.`,
                      worse: `Lower than your usual today (${Math.round(rate * 100)}% against ${Math.round((before ?? 0) * 100)}%). That happens. Rest, then try again slowly.`,
                    }[verdict(before, rate)]
                  }
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <ArrowLeftIcon weight="bold" /> Back
        </Button>
        {last ? (
          <Button asChild size="lg" className="rounded-xl">
            <Link to="/">
              Back to practice <ArrowRightIcon weight="bold" />
            </Link>
          </Button>
        ) : (
          <Button size="lg" className="rounded-xl" onClick={() => setIndex(index + 1)}>
            {step.kind === 'words' || step.kind === 'sentence' ? 'Continue' : 'Next'} <ArrowRightIcon weight="bold" />
          </Button>
        )}
      </div>
    </section>
  )
}

// ---- page --------------------------------------------------------------------------

export default function CoachPage() {
  const username = useSettings((s) => s.username)
  const signedIn = useSettings((s) => !!s.accountEmail)
  const queryClient = useQueryClient()
  const { data: plan, isLoading, error, isFetching } = useCoachPlan(signedIn ? username : '')
  const [round, setRound] = useState(0) // bumps to restart the session with a fresh plan

  const fresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: keys.coachPlan(username) })
    setRound((n) => n + 1)
  }, [queryClient, username])

  const strongest = useMemo(() => plan?.strengths[0], [plan])

  if (!signedIn) {
    return (
      <>
        <PageHeader eyebrow="Coach" title="Your coach" description="A short guided session built around the sound you need most." />
        <div className="surface">
          <EmptyState
            icon={<LockKeyIcon weight="fill" />}
            title="Sign in to start coaching"
            description="Your coach remembers every sound you attempt, so it needs an account to learn from."
            action={<SignInActions />}
          />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Coach"
        title="Your coach"
        description="One sound, one short session. I pick it from what you actually do."
        actions={
          <Button variant="secondary" onClick={fresh} disabled={isFetching}>
            <ArrowClockwiseIcon weight="bold" /> New session
          </Button>
        }
      />

      {isLoading && (
        <div className="space-y-5">
          <Skeleton className="h-44 w-full rounded-[30px]" />
          <Skeleton className="h-72 w-full rounded-[30px]" />
        </div>
      )}

      {error && !plan && (
        <div className="surface">
          {error instanceof ApiError && error.code === 'profile_locked' ? (
            <EmptyState
              icon={<LockKeyIcon weight="fill" />}
              title="Sign in again to continue"
              description="This browser is no longer signed in to your account. Sign in and your sounds and history will be right here."
              action={<SignInActions />}
            />
          ) : (
            <EmptyState
              icon={<QuestionIcon weight="fill" />}
              title="The coach could not be reached"
              description={error instanceof ApiError ? error.message : 'Check your connection and try again.'}
              action={<Button onClick={fresh}>Try again</Button>}
            />
          )}
        </div>
      )}

      {plan && (
        <div className="space-y-5" key={round}>
          <section className="surface p-6 sm:p-8">
            <div className="flex flex-wrap items-start gap-6">
              <div className="grid size-24 shrink-0 place-items-center rounded-[28px] bg-primary-soft">
                <span className="ipa text-[44px] leading-none font-semibold text-primary">{plan.focus.phoneme}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-primary">Today&rsquo;s focus</span>
                  <Pill tone="neutral">{plan.focus.name}</Pill>
                  {plan.focus.stats && TREND[plan.focus.stats.trend].icon && (
                    <Pill tone={TREND[plan.focus.stats.trend].tone}>
                      {TREND[plan.focus.stats.trend].icon} {TREND[plan.focus.stats.trend].label}
                    </Pill>
                  )}
                </div>
                <h2 className="headline mt-1 text-[26px]">{plan.focus.label || `/${plan.focus.phoneme}/`}</h2>
                <p className="mt-3 flex gap-2.5 text-[16px] leading-relaxed">
                  <SparkleIcon size={20} weight="fill" className="mt-0.5 shrink-0 text-primary" />
                  <span>{plan.briefing.text}</span>
                </p>
                {plan.briefing.source === 'template' && (
                  <p className="mt-1.5 ml-[30px] text-xs text-subtle">Written from your stats by the built-in coach.</p>
                )}
              </div>
            </div>
          </section>

          {plan.mastery.length > 0 && (
            <section className="surface p-6 sm:p-8">
              <SectionLabel>Your sounds</SectionLabel>
              <div className="flex flex-wrap gap-2.5">
                {plan.mastery.map((sound) => (
                  <SoundChip key={sound.phoneme} sound={sound} />
                ))}
              </div>
              <p className="mt-4 text-xs text-subtle">
                Clean rate over your recent attempts.
                {strongest && ` Your strongest sound is /${strongest.phoneme}/.`}
              </p>
            </section>
          )}

          <Session plan={plan} username={username} key={`${plan.focus.phoneme}-${round}`} />
        </div>
      )}
    </>
  )
}
