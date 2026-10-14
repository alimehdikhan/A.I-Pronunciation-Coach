import { ArrowRightIcon, CheckCircleIcon, MicrophoneIcon, SparkleIcon, XCircleIcon } from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Panel, Pill, SectionLabel } from '@/components/common'
import { PageHeader } from '@/components/layout/AppShell'
import { LazySiriOrb as SiriOrb } from '@/components/orb/LazySiriOrb'
import { PhonemeGuide } from '@/components/tutor/PhonemeGuide'
import { SpeakChip } from '@/components/tutor/SpeakButton'
import { Button } from '@/components/ui/button'
import { ScoreRing } from '@/components/ui/score-ring'
import { Skeleton } from '@/components/ui/skeleton'
import { useRecorder, type Recording } from '@/hooks/useRecorder'
import { api } from '@/lib/api'
import { createAnalyserReader, MIC_GAIN } from '@/lib/audio'
import { useStaggerIn } from '@/lib/gsap'
import { useHealth, usePhoneme, usePracticeDrills } from '@/lib/queries'
import type { PhonemeDetail } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'

interface PairResult {
  ok: boolean
  heard: string
}

function MicButton({
  recording,
  busy,
  disabled,
  onClick,
  analyserRef,
}: {
  recording: boolean
  busy: boolean
  disabled: boolean
  onClick: () => void
  analyserRef: React.RefObject<AnalyserNode | null>
}) {
  const readMic = useMemo(() => createAnalyserReader(analyserRef, MIC_GAIN, true), [analyserRef])
  if (recording || busy) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-label={recording ? 'Stop recording' : 'Checking'}
        className="shrink-0 rounded-full transition-transform active:scale-95"
      >
        <SiriOrb size={40} state={busy ? 'thinking' : 'listening'} getAudioFrame={busy ? undefined : readMic} glowIntensity={0.6} />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-label={recording ? 'Stop recording' : 'Record this word'}
      className={cn(
        'relative grid size-10 shrink-0 place-items-center rounded-full transition-all active:scale-95 disabled:opacity-40',
        'bg-primary text-white',
      )}
    >
      <MicrophoneIcon size={18} weight="fill" />
    </button>
  )
}

function PairChallenge({ phoneme }: { phoneme: PhonemeDetail }) {
  const level = useSettings((s) => s.level)
  const { data: health } = useHealth()
  const [results, setResults] = useState<Record<string, PairResult>>({})
  const [active, setActive] = useState<string | null>(null)
  const activeRef = useRef<string | null>(null)

  useEffect(() => {
    setResults({})
    setActive(null)
  }, [phoneme.symbol])

  const evaluate = useMutation({ mutationFn: api.evaluateRecording })

  const onRecorded = useCallback(
    ({ blob, filename }: Recording) => {
      const word = activeRef.current
      if (!word) return
      evaluate.mutate(
        { audio: blob, filename, text: word, difficulty: level },
        {
          onSuccess: ({ result }) => {
            const entry = result.words.find((w) => w.reference)
            const ok = !!entry && (entry.status === 'correct' || entry.status === 'unclear')
            setResults((r) => ({ ...r, [word]: { ok, heard: result.transcription.replace(/[.!?]$/, '') || 'nothing' } }))
          },
          onSettled: () => setActive(null),
        },
      )
    },
    [evaluate, level],
  )
  const onError = useCallback((message: string) => {
    toast.error(message)
    setActive(null)
  }, [])
  const recorder = useRecorder({ maxSeconds: 4, minSeconds: 0.25, onRecorded, onError })

  const record = (word: string) => {
    if (recorder.state === 'recording') {
      if (activeRef.current === word) recorder.stop()
      return
    }
    activeRef.current = word
    setActive(word)
    void recorder.start()
  }

  const total = phoneme.minimal_pairs.length
  const passed = Object.values(results).filter((r) => r.ok).length
  const allDone = total > 0 && passed === total

  return (
    <Panel className="drill-item p-6 sm:p-8">
      <SectionLabel
        action={
          <ScoreRing value={total ? (passed / total) * 100 : 0} size={40} stroke={4.5}>
            <span className="text-[11px] font-semibold tabular-nums">
              {passed}/{total}
            </span>
          </ScoreRing>
        }
      >
        Minimal-pair challenge
      </SectionLabel>
      <p className="-mt-2 mb-6 text-[15px] text-muted-foreground">
        Listen to both words, then record the <span className="font-semibold text-good">green</span> one. The coach checks which word it heard.
      </p>

      <div className="space-y-3">
        {phoneme.minimal_pairs.map((pair) => {
          const result = results[pair.correct]
          const recording = recorder.state === 'recording' && active === pair.correct
          const busy = evaluate.isPending && active === pair.correct
          return (
            <div
              key={pair.correct}
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-2xl p-3 transition-colors sm:flex-nowrap',
                result ? (result.ok ? 'bg-good-soft' : 'bg-bad-soft') : 'bg-fill',
              )}
            >
              <MicButton
                recording={recording}
                busy={busy}
                disabled={!health?.models_loaded || (recorder.state !== 'idle' && !recording)}
                onClick={() => record(pair.correct)}
                analyserRef={recorder.analyserRef}
              />
              <SpeakChip text={pair.correct} tone="good" className="bg-card" />
              <span className="text-xs text-subtle">vs</span>
              <SpeakChip text={pair.incorrect} className="bg-card" />
              <div className="ml-auto min-w-0 text-right">
                <AnimatePresence mode="wait">
                  {recording ? (
                    <motion.span key="rec" className="text-[13px] font-medium text-ai" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      Listening…
                    </motion.span>
                  ) : result ? (
                    <motion.span
                      key={result.heard}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={cn('inline-flex items-center gap-1.5 text-[13px] font-medium', result.ok ? 'text-good' : 'text-bad')}
                    >
                      {result.ok ? <CheckCircleIcon size={18} weight="fill" /> : <XCircleIcon size={18} weight="fill" />}
                      Heard “{result.heard}”
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          )
        })}
      </div>

      <AnimatePresence>
        {allDone && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="ring-ai mt-6 flex items-center gap-3 rounded-2xl p-4"
          >
            <SparkleIcon size={24} weight="fill" className="shrink-0 text-[#c959dd]" />
            <div className="text-[15px]">
              <div className="font-semibold">All pairs clear!</div>
              <div className="text-muted-foreground">Lock it in by practising the full sentence.</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  )
}

export default function DrillsPage() {
  const username = useSettings((s) => s.username)
  const [params, setParams] = useSearchParams()
  const { data: practice, isLoading } = usePracticeDrills(username)
  const drills = practice?.practices ?? []
  const requested = params.get('sound')
  const symbol = requested ?? drills[0]?.target_phoneme ?? null
  const { data: phoneme } = usePhoneme(symbol)
  const scope = useRef<HTMLDivElement>(null)

  useStaggerIn(scope, '.drill-item', [symbol, !!phoneme])

  const focusList = drills.map((d) => ({ symbol: d.target_phoneme, label: d.focus, count: d.mistake_count }))
  if (requested && phoneme && !focusList.some((f) => f.symbol === requested)) {
    focusList.unshift({ symbol: requested, label: phoneme.label, count: null })
  }

  return (
    <div ref={scope}>
      <PageHeader
        eyebrow="Drills"
        title="Train your trouble sounds."
        description={
          practice?.personalized
            ? 'Built from the sounds you miss most often. Clear each pair, then practise the sentence.'
            : 'Start with the sounds English learners find hardest. Practise a few phrases and this list adapts to you.'
        }
        actions={
          <Button asChild variant="secondary">
            <Link to="/sounds">
              All sounds <ArrowRightIcon weight="bold" />
            </Link>
          </Button>
        }
      />

      <div className="-mx-4 mb-8 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="flex gap-3">
          {isLoading &&
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] w-44 shrink-0 rounded-[22px]" />)}
          {focusList.map((item) => {
            const active = item.symbol === symbol
            return (
              <button
                key={item.symbol}
                type="button"
                onClick={() => setParams({ sound: item.symbol })}
                className={cn(
                  'surface lift flex w-44 shrink-0 items-center gap-3 rounded-[22px] p-4 text-left',
                  active && 'ring-ai',
                )}
              >
                <span className="ipa text-[34px] leading-none font-medium">{item.symbol}</span>
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold">
                    {(item.label.split(' as in ')[1] ?? item.label).replace(/[“”"]/g, '')}
                  </div>
                  {item.count ? (
                    <Pill tone="bad" className="mt-1 h-5 px-2 text-[11px]">
                      {item.count} {item.count === 1 ? 'miss' : 'misses'}
                    </Pill>
                  ) : (
                    <div className="truncate text-xs text-muted-foreground">Focus sound</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {phoneme ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
          <PairChallenge phoneme={phoneme} />
          <Panel className="drill-item p-6 sm:p-8">
            <PhonemeGuide phoneme={phoneme} hidePairs />
          </Panel>
        </div>
      ) : (
        !isLoading && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Skeleton className="h-96 rounded-[30px]" />
            <Skeleton className="h-96 rounded-[30px]" />
          </div>
        )
      )}
    </div>
  )
}
