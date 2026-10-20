import { ArrowsClockwiseIcon, ClockIcon, GaugeIcon, InfoIcon, MicrophoneIcon, SparkleIcon, SpinnerGapIcon, StopIcon, TimerIcon, WaveformIcon } from '@phosphor-icons/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LockedResults } from '@/components/auth/SignInGate'
import { Panel, Pill, Segmented, SectionLabel } from '@/components/common'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useRecorder, type Recording } from '@/hooks/useRecorder'
import { api } from '@/lib/api'
import { audioEngine } from '@/lib/audioEngine'
import { useSoundName } from '@/lib/soundNames'
import type { SpeakPrompt, SpeakResult } from '@/lib/types'
import { cn, formatDuration } from '@/lib/utils'
import { useSettings } from '@/store/settings'

type Kind = SpeakPrompt['kind']

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl bg-fill p-4">
      <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground [&_svg]:size-4 [&_svg]:text-primary">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-[24px] font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[12px] text-subtle">{hint}</div>}
    </div>
  )
}

function Answer({ result }: { result: SpeakResult }) {
  const soundName = useSoundName()
  const d = result.delivery
  if (result.no_speech || !d) {
    return <p className="text-[15px] text-muted-foreground">We didn’t hear any speech. Check your microphone and try again.</p>
  }
  const reported = new Map(result.slips.map((s) => [s.index, s]))
  return (
    <div className="space-y-5">
      <p className="flex gap-2 rounded-2xl bg-fill px-4 py-3 text-[13px] text-muted-foreground">
        <InfoIcon size={18} weight="fill" className="mt-px shrink-0 text-primary" />
        {result.note}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={<GaugeIcon weight="fill" />} label="Pace" value={d.wpm ?? '—'} hint="words a minute (conversation is about 120-160)" />
        <Stat
          icon={<ClockIcon weight="fill" />}
          label="Pauses over 1 s"
          value={d.long_pauses}
          hint={d.longest_pause ? `longest ${d.longest_pause.toFixed(1)} s` : 'none'}
        />
        <Stat
          icon={<WaveformIcon weight="fill" />}
          label="Fillers"
          value={<>≈{d.fillers.count}</>}
          hint={d.fillers.words.length ? `${d.fillers.words.join(', ')} · approximate` : 'approximate: some are missed'}
        />
        <Stat
          icon={<SparkleIcon weight="fill" />}
          label="Sounds"
          value={result.pronunciation != null ? Math.round(result.pronunciation) : '—'}
          hint={result.pronunciation != null ? 'sure slips only' : 'needs the sound model'}
        />
      </div>

      <div>
        <SectionLabel icon={<MicrophoneIcon weight="fill" />}>What you said</SectionLabel>
        <p className="text-[18px] leading-relaxed">
          {result.words.map((w) => {
            const slip = reported.get(w.index)
            return (
              <span key={w.index}>
                <span
                  className={cn(slip && 'rounded-md bg-bad-soft px-1 text-bad')}
                  title={slip ? `${soundName(slip.expected).spelled} sounded like ${slip.actual ? soundName(slip.actual).spelled : 'nothing'}` : undefined}
                >
                  {w.display}
                </span>{' '}
              </span>
            )
          })}
        </p>
        {result.slips.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-[14px] text-muted-foreground">
            {result.slips.map((s) => (
              <li key={`${s.index}-${s.expected}`}>
                <b className="text-foreground">{s.word}</b>: the {soundName(s.expected).spelled} sound came out as{' '}
                {s.actual && s.actual !== '?' ? soundName(s.actual).spelled : 'something unclear'}
                {s.changes_word ? `, so it sounded like “${s.changes_word}”` : ''}.
              </li>
            ))}
          </ul>
        )}
      </div>

      {result.feedback && (
        <div className="rounded-2xl border border-primary/25 bg-primary-soft p-4">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-primary">
            <SparkleIcon weight="fill" /> Clarity and structure <Pill tone="primary" className="h-5 text-[10px]">AI coach</Pill>
          </div>
          <p className="text-[15px] leading-relaxed">{result.feedback.text}</p>
        </div>
      )}
    </div>
  )
}

export default function SpeakPage() {
  const signedIn = useSettings((s) => !!s.accountEmail)
  const { data: bank, isLoading } = useQuery({ queryKey: ['speak-prompts'], queryFn: api.speakPrompts, staleTime: Infinity })
  const [kind, setKind] = useState<Kind>('interview')
  const [index, setIndex] = useState(0)
  const [prepLeft, setPrepLeft] = useState<number | null>(null)
  const prompts = useMemo(() => (bank?.prompts ?? []).filter((p) => p.kind === kind), [bank, kind])
  const prompt = prompts.length ? prompts[index % prompts.length] : null
  const prepSeconds = bank?.kinds[kind]?.prep_seconds ?? 0

  const evaluate = useMutation({ mutationFn: api.speakEvaluate })
  const onRecorded = useCallback(
    ({ blob, filename }: Recording) => evaluate.mutate({ audio: blob, filename, promptId: prompt?.id ?? null }),
    [evaluate, prompt],
  )
  const recorder = useRecorder({ maxSeconds: bank?.max_seconds ?? 120, minSeconds: 2, onRecorded })
  const recording = recorder.state === 'recording'

  const next = () => {
    if (recording) return
    setIndex((i) => i + 1)
    setPrepLeft(null)
    evaluate.reset()
  }
  const startPrep = () => setPrepLeft(prepSeconds)
  const toggle = () => {
    if (evaluate.isPending) return
    setPrepLeft(null)
    if (recorder.state === 'idle') audioEngine.stop()
    recorder.toggle()
  }

  useEffect(() => {
    if (prepLeft == null || prepLeft <= 0) return
    const timer = window.setTimeout(() => setPrepLeft((s) => (s == null ? s : s - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [prepLeft])

  useHotkeys({ ' ': toggle, n: next, s: () => prepLeft != null && setPrepLeft(null) })

  return (
    <>
      <PageHeader
        eyebrow="Speak freely"
        title="Answer in your own words."
        description="Interview questions, IELTS-style cue cards and everyday situations. You get your pace, pauses, filler words and the sound slips the coach is sure about."
        actions={
          <Segmented<Kind>
            layoutId="speak-kind"
            value={kind}
            onChange={(k) => {
              setKind(k)
              setIndex(0)
              setPrepLeft(null)
              evaluate.reset()
            }}
            options={[
              { value: 'interview', label: 'Interview' },
              { value: 'ielts', label: 'IELTS' },
              { value: 'everyday', label: 'Everyday' },
            ]}
          />
        }
      />

      <Panel className="p-6 sm:p-8">
        {isLoading || !prompt ? (
          <Skeleton className="h-40 w-full rounded-2xl" />
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-primary">{bank?.kinds[kind].label}</div>
                <h2 className="headline mt-1 text-[26px] sm:text-[30px]">{prompt.title}</h2>
                {prompt.hint && <p className="mt-2 text-[15px] text-muted-foreground">{prompt.hint}</p>}
                {prompt.points && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-[15px] text-muted-foreground">
                    <li className="list-none -ml-5 font-medium text-foreground">You should say:</li>
                    {prompt.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                )}
              </div>
              <Button variant="secondary" size="sm" onClick={next} disabled={recording}>
                <ArrowsClockwiseIcon weight="bold" /> Another <Kbd className="ml-1 hidden sm:inline-flex">N</Kbd>
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {prepSeconds > 0 && prepLeft == null && !recording && !evaluate.data && (
                <Button variant="secondary" onClick={startPrep}>
                  <TimerIcon weight="fill" /> Prepare for {prepSeconds} s
                </Button>
              )}
              {prepLeft != null && prepLeft > 0 && (
                <span className="flex items-center gap-2 rounded-full bg-warn-soft px-4 py-2 text-[15px] font-semibold text-warn tabular-nums" role="timer" aria-live="polite">
                  <TimerIcon weight="fill" /> Preparing: {prepLeft} s
                  <button type="button" onClick={() => setPrepLeft(null)} className="ml-1 text-[13px] font-medium underline">
                    skip <Kbd className="ml-0.5 hidden sm:inline-flex">S</Kbd>
                  </button>
                </span>
              )}
              {prepLeft === 0 && <span className="text-[15px] font-semibold text-primary">Time’s up. Start speaking.</span>}
              <Button size="lg" onClick={toggle} disabled={evaluate.isPending} className={cn('h-12 px-6', recording && 'bg-bad hover:bg-bad/90')}>
                {evaluate.isPending ? (
                  <>
                    <SpinnerGapIcon className="motion-safe:animate-spin" /> Listening back…
                  </>
                ) : recording ? (
                  <>
                    <StopIcon weight="fill" /> Stop · {formatDuration(recorder.elapsed)} / {formatDuration(recorder.maxSeconds)}
                  </>
                ) : (
                  <>
                    <MicrophoneIcon weight="fill" /> {evaluate.data ? 'Answer again' : 'Start answering'}
                  </>
                )}
                <Kbd className="ml-1 hidden bg-white/20 text-white sm:inline-flex">Space</Kbd>
              </Button>
            </div>
            {evaluate.isError && <p className="text-[14px] text-bad">Could not score that answer. Try again.</p>}
          </div>
        )}
      </Panel>

      {evaluate.data && (
        <div className="mt-5">
          {signedIn ? (
            <Panel className="p-6 sm:p-8">
              <Answer result={evaluate.data} />
            </Panel>
          ) : (
            <LockedResults />
          )}
        </div>
      )}
    </>
  )
}
