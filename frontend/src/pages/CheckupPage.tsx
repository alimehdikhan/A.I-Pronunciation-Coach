import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  MicrophoneIcon,
  SpinnerGapIcon,
  StopIcon,
} from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { EmptyState, Panel } from '@/components/common'
import { SignInActions } from '@/components/auth/SignInGate'
import { PageHeader } from '@/components/layout/AppShell'
import { ListenButton } from '@/components/tutor/SpeakButton'
import { Button } from '@/components/ui/button'
import { CountUp, ScoreRing } from '@/components/ui/score-ring'
import { Skeleton } from '@/components/ui/skeleton'
import { useRecorder, type Recording } from '@/hooks/useRecorder'
import { api } from '@/lib/api'
import { errorLine } from '@/lib/errors'
import { keys } from '@/lib/queries'
import type { Level } from '@/lib/types'
import { cn, scoreTone, toneText } from '@/lib/utils'
import { useSettings } from '@/store/settings'

function levelFor(average: number): Level {
  return average < 60 ? 'beginner' : average < 80 ? 'intermediate' : 'advanced'
}

const LEVEL_TEXT: Record<Level, string> = {
  beginner: 'Beginner: short, common phrases with the sounds that matter most.',
  intermediate: 'Intermediate: fuller sentences and the sounds you still slip on.',
  advanced: 'Advanced: longer, richer sentences and the fine details.',
}

/** Six short sentences, one at a time. At the end: where you are, and the level that suits you. */
export default function CheckupPage() {
  const username = useSettings((s) => s.username)
  const signedIn = useSettings((s) => !!s.accountEmail)
  const level = useSettings((s) => s.level)
  const setLevel = useSettings((s) => s.setLevel)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const reduce = useReducedMotion()
  const [step, setStep] = useState(0)
  const [scores, setScores] = useState<(number | null)[]>([])

  const { data, isLoading } = useQuery({ queryKey: ['checkup'], queryFn: api.checkup, staleTime: Infinity, enabled: signedIn })
  const items = data?.items ?? []
  const current = items[step]
  const done = items.length > 0 && step >= items.length

  const evaluate = useMutation({
    mutationFn: api.evaluateRecording,
    meta: { silent: true },
    onSuccess: ({ result }) => {
      setScores((s) => {
        const next = [...s]
        next[step] = result.transcription ? result.score : null
        return next
      })
      void queryClient.invalidateQueries({ queryKey: keys.journey(username) })
      void queryClient.invalidateQueries({ queryKey: keys.analytics(username) })
    },
  })

  const onRecorded = useCallback(
    ({ blob, filename }: Recording) =>
      evaluate.mutate({ audio: blob, filename, text: current?.text ?? '', difficulty: level, username }),
    [evaluate, current?.text, level, username],
  )
  const recorder = useRecorder({ maxSeconds: 15, minSeconds: 0.3, onRecorded, onError: (m) => toast.error(m) })
  const recording = recorder.state === 'recording'
  const busy = evaluate.isPending || recorder.state === 'requesting'
  const scored = scores[step]

  if (!signedIn) {
    return (
      <>
        <PageHeader eyebrow="Check-up" title="Find your starting point" />
        <div className="surface">
          <EmptyState
            icon={<ClipboardTextIcon weight="fill" />}
            title="Sign in to take the check-up"
            description="The result is saved to your account so your path starts in the right place."
            action={<SignInActions />}
          />
        </div>
      </>
    )
  }

  if (done) {
    const valid = scores.filter((s): s is number => s !== null)
    const average = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0
    const suggested = levelFor(average)
    return (
      <>
        <PageHeader eyebrow="Check-up" title="Here is where you are" description="Your journey now starts from this." />
        <Panel className="p-6 sm:p-8">
          <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
            <ScoreRing value={Math.round(average)} size={140} stroke={13}>
              <span className={cn('headline text-[40px] tabular-nums', toneText[scoreTone(average)])}>
                <CountUp value={Math.round(average)} />
              </span>
            </ScoreRing>
            <div className="min-w-0 flex-1">
              <div className="headline text-[24px]">
                {valid.length === 0 ? 'We could not hear you this time' : `Suggested level: ${suggested[0].toUpperCase()}${suggested.slice(1)}`}
              </div>
              <p className="mt-1 text-[15px] text-muted-foreground">
                {valid.length === 0 ? 'Check your microphone and try the check-up again.' : LEVEL_TEXT[suggested]}
              </p>
              <ul className="mt-4 grid gap-1.5 text-[14px]">
                {items.map((item, i) => (
                  <li key={item.text} className="flex items-center justify-between gap-3 rounded-xl bg-fill px-3 py-2">
                    <span className="truncate">{item.text}</span>
                    <span className={cn('shrink-0 font-semibold tabular-nums', scores[i] == null ? 'text-subtle' : toneText[scoreTone(scores[i]!)])}>
                      {scores[i] == null ? 'skipped' : Math.round(scores[i]!)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            {valid.length > 0 && (
              <Button
                size="lg"
                onClick={() => {
                  setLevel(suggested)
                  toast.success(`Level set to ${suggested}`)
                  navigate('/journey')
                }}
              >
                Use this level and see my path <ArrowRightIcon weight="bold" />
              </Button>
            )}
            <Button size="lg" variant="secondary" asChild>
              <Link to="/coach">Start coaching</Link>
            </Button>
          </div>
        </Panel>
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Check-up"
        title="Find your starting point"
        description="Six short sentences, about two minutes. There are no wrong answers: it just shows the coach where to begin."
      />
      {isLoading || !current ? (
        <Skeleton className="h-72 w-full rounded-[30px]" />
      ) : (
        <Panel className="p-6 sm:p-10">
          <div className="mb-6 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-muted-foreground tabular-nums">
              {step + 1} of {items.length}
            </span>
            <div className="flex gap-1.5" aria-hidden>
              {items.map((item, i) => (
                <span key={item.text} className={cn('h-1.5 w-8 rounded-full', i < step ? 'bg-primary' : i === step ? 'bg-primary/50' : 'bg-fill')} />
              ))}
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.p
              key={current.text}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="headline text-center text-[28px] leading-tight sm:text-[38px]"
            >
              {current.text}
            </motion.p>
          </AnimatePresence>

          <div className="mt-8 flex flex-col items-center gap-4">
            <ListenButton text={current.text} speakKey={`checkup-${step}`} label="Hear it first" />
            <button
              type="button"
              disabled={busy}
              onClick={() => recorder.toggle()}
              aria-label={recording ? 'Stop recording' : 'Record this sentence'}
              className={cn(
                'grid size-20 place-items-center rounded-full text-white shadow-lg transition-transform active:scale-95 disabled:opacity-60',
                recording ? 'bg-[#ff3b30]' : 'bg-primary',
              )}
            >
              {busy ? (
                <SpinnerGapIcon size={30} className="animate-spin" />
              ) : recording ? (
                <StopIcon size={30} weight="fill" />
              ) : (
                <MicrophoneIcon size={34} weight="fill" />
              )}
            </button>
            <div className="min-h-[24px] text-center text-[14px] text-muted-foreground" aria-live="polite">
              {recording
                ? 'Listening… tap to stop'
                : evaluate.isPending
                  ? 'Checking…'
                  : evaluate.error
                    ? errorLine(evaluate.error)
                    : scored != null
                      ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-good">
                            <CheckCircleIcon size={18} weight="fill" /> Got it. Score {Math.round(scored)}
                          </span>
                        )
                      : scores[step] === null
                        ? 'We did not hear anything. Try again, or skip.'
                        : 'Tap the microphone and say the sentence'}
            </div>
          </div>

          <div className="mt-6 flex justify-between">
            <Button variant="ghost" asChild>
              <Link to="/journey">Not now</Link>
            </Button>
            <Button
              size="lg"
              disabled={busy || recording}
              variant={scored != null ? 'default' : 'secondary'}
              onClick={() => setStep((s) => s + 1)}
            >
              {scored != null ? 'Next' : 'Skip'} <ArrowRightIcon weight="bold" />
            </Button>
          </div>
        </Panel>
      )}
    </>
  )
}
