import { ArrowClockwiseIcon, ArrowRightIcon } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { usePlayback } from '@/hooks/usePlayback'
import { useStaggerIn } from '@/lib/gsap'
import type { Attempt } from '@/store/practice'
import { CoachCard } from './CoachCard'
import { InsightsPanel } from './InsightsPanel'
import { RoomNotice } from './RoomNotice'
import { ScoreSummary } from './ScoreSummary'
import { AskListenersButton } from '@/components/listeners/AskListenersButton'
import { ShareButton } from './ShareButton'
import { TranscriptPanel } from './TranscriptPanel'
import { wordTier } from '@/lib/utils'
import { WordInspector } from './WordInspector'

function defaultWord(attempt: Attempt): number | null {
  const words = attempt.result.words
  const problem =
    words.find((w) => wordTier(w) === 'fix') ??
    words.find((w) => w.status === 'missing' || w.status === 'unclear') ??
    words.find((w) => wordTier(w) === 'check')
  return (problem ?? words[0])?.index ?? null
}

export function Results({
  attempt,
  previousScore,
  onRetry,
  onNext,
}: {
  attempt: Attempt
  previousScore?: number
  onRetry: () => void
  onNext: () => void
}) {
  const { result } = attempt
  const scope = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<number | null>(() => defaultWord(attempt))
  const timed = useMemo(() => result.words.map((w) => ({ index: w.index, start: w.start, end: w.end })), [result.words])
  const playback = usePlayback(attempt.audioUrl, timed)

  // Keyed on the recording, not the object: a word updated in place ("Say just this word") keeps the view.
  useEffect(() => {
    setSelected(defaultWord(attempt))
  }, [attempt.createdAt])

  useEffect(() => {
    scope.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [attempt.createdAt])

  useStaggerIn(scope, '.results-item', [attempt.createdAt])

  const word = result.words.find((w) => w.index === selected) ?? null

  return (
    <div ref={scope} className="scroll-mt-6 space-y-5">
      <ScoreSummary result={result} previous={previousScore} />
      <RoomNotice cleanup={result.audio_cleanup} />
      <TranscriptPanel result={result} blob={attempt.audioBlob} playback={playback} selected={selected} onSelect={setSelected} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <WordInspector word={word} playback={playback} recordId={result.record_id} />
        <InsightsPanel insights={result.insights} onSelect={setSelected} />
      </div>
      <CoachCard result={result} previousScore={previousScore} onSelect={setSelected} />
      <div className="results-item flex flex-col-reverse flex-wrap items-center justify-center gap-3 pt-4 sm:flex-row">
        <Button variant="secondary" size="lg" onClick={onRetry} className="h-12 px-6 text-[15px]">
          <ArrowClockwiseIcon weight="bold" /> Try again <Kbd className="ml-1 hidden sm:inline-flex">R</Kbd>
        </Button>
        <ShareButton attempt={attempt} />
        <AskListenersButton attempt={attempt} />
        <Button size="lg" onClick={onNext} className="h-12 px-6 text-[15px]">
          Next phrase <ArrowRightIcon weight="bold" /> <Kbd className="ml-1 hidden bg-white/20 text-white sm:inline-flex">N</Kbd>
        </Button>
      </div>
      {!result.saved && (
        <p className="results-item text-center text-xs text-subtle">Add your name in Settings to save attempts and track progress.</p>
      )}
    </div>
  )
}
